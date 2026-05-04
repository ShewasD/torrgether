// Abstract-chunk-store compatible RAM store with coherent LRU eviction.
//
// WebTorrent marks a piece as available after it verifies the hash. If a RAM
// store evicts that piece without telling WebTorrent, file streams can read a
// stale bitfield=true state, get a store error, and end the HTTP response early.
// This store keeps the cache bounded while marking evicted pieces unverified so
// later reads are downloaded again instead of turning into a fake EOF.

const DEFAULT_MAX_MEMORY_MB = 512
const DEFAULT_GET_TIMEOUT_MS = 45_000
const DEFAULT_MAX_PENDING_READS = 256
const DEFAULT_WARNING_INTERVAL_MS = 60_000
const DEFAULT_LOW_WATERMARK_RATIO = 0.85
const DEFAULT_RECENT_EVICTION_TTL_MS = 120_000
const DEFAULT_MAX_RECENT_EVICTIONS = 4096

function toPositiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function toRatio(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && number <= 1 ? number : fallback
}

function makeNotFoundError(index, message = `Chunk ${index} is not in RAM cache`) {
  const err = new Error(message)
  err.notFound = true
  return err
}

export default class LruMemoryChunkStore {
  constructor(chunkLength, opts = {}) {
    this.chunkLength = chunkLength
    this.length = opts.length || 0
    this.torrent = opts.torrent || null
    this.maxChunks = toPositiveNumber(opts.maxChunks || process.env.MAX_MEMORY_CHUNKS, Number.POSITIVE_INFINITY)

    const maxBytesFromEnv = Number(process.env.MAX_MEMORY_BYTES)
    const maxMb = toPositiveNumber(opts.maxMemoryMB || process.env.MAX_MEMORY_MB, DEFAULT_MAX_MEMORY_MB)
    this.maxBytes = toPositiveNumber(opts.maxBytes || maxBytesFromEnv, maxMb * 1024 * 1024)
    this.getTimeoutMs = toPositiveNumber(opts.getTimeoutMs || process.env.RAM_STORE_GET_TIMEOUT_MS, DEFAULT_GET_TIMEOUT_MS)
    this.maxPendingReads = toPositiveNumber(opts.maxPendingReads || process.env.MAX_PENDING_RAM_READS, DEFAULT_MAX_PENDING_READS)
    this.warningIntervalMs = toPositiveNumber(opts.warningIntervalMs || process.env.RAM_STORE_WARNING_INTERVAL_MS, DEFAULT_WARNING_INTERVAL_MS)
    this.lowWatermarkRatio = toRatio(opts.lowWatermarkRatio ?? process.env.RAM_STORE_LOW_WATERMARK_RATIO, DEFAULT_LOW_WATERMARK_RATIO)
    this.lowWatermarkBytes = Number.isFinite(this.maxBytes)
      ? Math.max(1, Math.floor(this.maxBytes * this.lowWatermarkRatio))
      : Number.POSITIVE_INFINITY
    this.lowWatermarkChunks = Number.isFinite(this.maxChunks)
      ? Math.max(1, Math.floor(this.maxChunks * this.lowWatermarkRatio))
      : Number.POSITIVE_INFINITY
    this.recentEvictionTtlMs = toPositiveNumber(opts.recentEvictionTtlMs ?? process.env.RAM_STORE_RECENT_EVICTION_TTL_MS, DEFAULT_RECENT_EVICTION_TTL_MS)
    this.maxRecentEvictions = toPositiveNumber(opts.maxRecentEvictions ?? process.env.RAM_STORE_MAX_RECENT_EVICTIONS, DEFAULT_MAX_RECENT_EVICTIONS)
    this.onWarning = typeof opts.onWarning === 'function' ? opts.onWarning : null

    this.closed = false
    this.chunks = new Map()
    this.recentEvictions = new Map()
    this.bytes = 0
    this.evictions = 0
    this.recoveries = 0
    this.recoveryWaits = 0
    this.staleMisses = 0
    this.unverifiedMarks = 0
    this.overLimitWarnings = 0
    this.lastOverLimitWarningAt = 0
    this.pendingReads = new Map()

    if (this.torrent) this.torrent._torrgetherRamStore = this
  }

  get pendingReadCount() {
    let count = 0
    for (const recovery of this.pendingReads.values()) count += recovery.waits.size
    return count
  }

  getStats() {
    this._pruneRecentEvictions()
    return {
      chunks: this.chunks.size,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
      maxChunks: this.maxChunks,
      fillPercent: Number.isFinite(this.maxBytes) && this.maxBytes > 0 ? (this.bytes / this.maxBytes) * 100 : null,
      lowWatermarkRatio: this.lowWatermarkRatio,
      lowWatermarkBytes: this.lowWatermarkBytes,
      lowWatermarkChunks: this.lowWatermarkChunks,
      overLimitBytes: Math.max(0, this.bytes - this.maxBytes),
      overLimitChunks: Math.max(0, this.chunks.size - this.maxChunks),
      evictions: this.evictions,
      recoveries: this.recoveries,
      recoveryWaits: this.recoveryWaits,
      staleMisses: this.staleMisses,
      recentEvictions: this.recentEvictions.size,
      unverifiedMarks: this.unverifiedMarks,
      pendingReads: this.pendingReadCount,
      pendingReadCount: this.pendingReadCount,
      maxPendingReads: this.maxPendingReads,
      overLimitWarnings: this.overLimitWarnings
    }
  }

  put(index, buffer, cb = () => {}) {
    if (this.closed) return queueMicrotask(() => cb(new Error('Store is closed')))
    this._setChunk(index, Buffer.from(buffer))
    queueMicrotask(() => cb(null))
  }

  get(index, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    cb ||= () => {}
    opts ||= {}

    if (this.closed) return queueMicrotask(() => cb(new Error('Store is closed')))

    const hit = this._readChunk(index, opts)
    if (hit) return queueMicrotask(() => cb(null, hit))

    if (this.pendingReads.has(index)) {
      this._recoverStaleMiss(index, opts, cb)
      return
    }

    if (!this._hasStaleVerifiedBit(index) && !this._isRecentlyEvicted(index)) {
      return queueMicrotask(() => cb(makeNotFoundError(index)))
    }

    this._recoverStaleMiss(index, opts, cb)
  }

  close(cb = () => {}) {
    this._close()
    queueMicrotask(() => cb(null))
  }

  destroy(cb = () => {}) {
    this._close()
    queueMicrotask(() => cb(null))
  }

  _close() {
    this.closed = true
    this.chunks.clear()
    this.recentEvictions.clear()
    this.bytes = 0
    this._failPending(new Error('Store is closed'))
    if (this.torrent?._torrgetherRamStore === this) delete this.torrent._torrgetherRamStore
  }

  _setChunk(index, buffer) {
    const previous = this.chunks.get(index)
    if (previous) {
      this.bytes -= previous.length
      this.chunks.delete(index)
    }

    this.chunks.set(index, buffer)
    this.recentEvictions.delete(index)
    this.bytes += buffer.length
    this._evictUntilWithinLimits(index)
    this._warnIfOverLimit(index)
  }

  _readChunk(index, opts = {}) {
    const chunk = this.chunks.get(index)
    if (!chunk) return null

    this.chunks.delete(index)
    this.chunks.set(index, chunk)

    const offset = Math.max(0, Number(opts.offset) || 0)
    const length = Number.isFinite(Number(opts.length))
      ? Math.max(0, Number(opts.length))
      : Math.max(0, chunk.length - offset)
    return chunk.subarray(offset, offset + length)
  }

  _evictUntilWithinLimits(protectedIndex) {
    if (this.chunks.size <= this.maxChunks && this.bytes <= this.maxBytes) return

    while ((this.chunks.size > this.lowWatermarkChunks || this.bytes > this.lowWatermarkBytes) && this.chunks.size > 1) {
      const oldest = this._oldestEvictableIndex(protectedIndex)
      if (oldest == null) return

      const oldBuffer = this.chunks.get(oldest)
      this._markPieceUnavailable(oldest, false)
      this.chunks.delete(oldest)
      this._rememberEviction(oldest)
      this.bytes -= oldBuffer?.length || 0
      this.evictions += 1
    }
  }

  _oldestEvictableIndex(protectedIndex) {
    for (const index of this.chunks.keys()) {
      if (index !== protectedIndex) return index
    }
    return null
  }

  _hasStaleVerifiedBit(index) {
    try {
      return Boolean(this.torrent?.bitfield?.get?.(index))
    } catch {
      return false
    }
  }

  _isRecentlyEvicted(index) {
    this._pruneRecentEvictions()
    return this.recentEvictions.has(index)
  }

  _rememberEviction(index) {
    this.recentEvictions.set(index, Date.now() + this.recentEvictionTtlMs)
    while (this.recentEvictions.size > this.maxRecentEvictions) {
      const oldest = this.recentEvictions.keys().next().value
      this.recentEvictions.delete(oldest)
    }
  }

  _pruneRecentEvictions() {
    if (this.recentEvictions.size === 0) return
    const now = Date.now()
    for (const [index, expiresAt] of this.recentEvictions) {
      if (expiresAt > now) continue
      this.recentEvictions.delete(index)
    }
  }

  _recoverStaleMiss(index, opts, cb) {
    this.staleMisses += 1

    if (this.pendingReadCount >= this.maxPendingReads) {
      queueMicrotask(() => cb(new Error(`Too many pending RAM reads (${this.pendingReadCount}/${this.maxPendingReads})`)))
      return
    }

    let recovery = this.pendingReads.get(index)
    if (recovery) {
      this.recoveryWaits += 1
      recovery.waits.add({ cb, opts, done: false })
      return
    }

    this.recoveryWaits += 1
    recovery = {
      waits: new Set([{ cb, opts, done: false }]),
      timer: null,
      listener: null
    }

    const finishAll = err => {
      clearTimeout(recovery.timer)
      this.torrent?.removeListener?.('verified', recovery.listener)
      this.pendingReads.delete(index)

      for (const pending of recovery.waits) {
        if (pending.done) continue
        pending.done = true
        if (err) {
          pending.cb(err)
          continue
        }
        const chunk = this._readChunk(index, pending.opts)
        if (!chunk) pending.cb(makeNotFoundError(index, `Chunk ${index} was verified but is still missing from RAM cache`))
        else {
          this.recoveries += 1
          pending.cb(null, chunk)
        }
      }
    }

    recovery.listener = verifiedIndex => {
      if (verifiedIndex !== index) return
      finishAll(null)
    }

    recovery.timer = setTimeout(() => {
      finishAll(makeNotFoundError(index, `Timed out waiting for chunk ${index} to be downloaded into RAM again`))
    }, this.getTimeoutMs)
    recovery.timer.unref?.()

    this.pendingReads.set(index, recovery)
    this.torrent?.on?.('verified', recovery.listener)
    this._markPieceUnavailable(index, true)
  }

  _failPending(err) {
    for (const [index, recovery] of this.pendingReads) {
      clearTimeout(recovery.timer)
      this.torrent?.removeListener?.('verified', recovery.listener)
      for (const pending of recovery.waits) {
        if (pending.done) continue
        pending.done = true
        pending.cb(err)
      }
      this.pendingReads.delete(index)
    }
  }

  _markPieceUnavailable(index, requestNow) {
    const torrent = this.torrent
    if (!torrent || torrent.destroyed) return

    try {
      if (torrent.bitfield?.get?.(index) && typeof torrent._markUnverified === 'function') {
        torrent._markUnverified(index)
        this.unverifiedMarks += 1
      }
    } catch {}

    this._ensurePieceCanBeReserved(index)

    if (requestNow) {
      try {
        if (typeof torrent.select === 'function') torrent.select(index, index, 2)
      } catch {}
      try { torrent.critical?.(index, index) } catch {}
    }

    try { torrent._updateSelections?.() } catch {}
    try { torrent._update?.() } catch {}
  }

  _ensurePieceCanBeReserved(index) {
    const reservations = this.torrent?._reservations
    if (Array.isArray(reservations) && !Array.isArray(reservations[index])) {
      reservations[index] = []
    }
  }

  _warnIfOverLimit(protectedIndex) {
    if (this.bytes <= this.maxBytes && this.chunks.size <= this.maxChunks) return

    const now = Date.now()
    if (now - this.lastOverLimitWarningAt < this.warningIntervalMs) return
    this.lastOverLimitWarningAt = now
    this.overLimitWarnings += 1

    try {
      this.onWarning?.({
        message: 'RAM chunk store is above configured limits; the protected chunk may be larger than the cache budget.',
        protectedIndex,
        stats: this.getStats()
      })
    } catch {}
  }
}
