import test from 'node:test'
import assert from 'node:assert/strict'
import EventEmitter from 'node:events'
import fs from 'node:fs/promises'
import LruMemoryChunkStore from '../desktop/LruMemoryChunkStore.js'

class FakeTorrent extends EventEmitter {
  constructor({ autoRescan = true } = {}) {
    super()
    this.destroyed = false
    this.bits = new Set()
    this.selections = []
    this.criticalPieces = []
    this.rescans = 0
    this.rescanCallbacks = []
    this.listenerCountsAtRescan = []
    this.autoRescan = autoRescan
    this.bitfield = {
      get: index => this.bits.has(index),
      set: (index, value) => {
        if (value) this.bits.add(index)
        else this.bits.delete(index)
      }
    }
  }

  select(start, end, priority) {
    this.selections.push({ start, end, priority })
  }

  critical(start, end) {
    this.criticalPieces.push({ start, end })
  }

  rescanFiles(cb) {
    this.rescans += 1
    this.listenerCountsAtRescan.push(this.listenerCount('verified'))
    this.rescanCallbacks.push(cb)
    if (this.autoRescan) queueMicrotask(() => this.finishRescan())
  }

  finishRescan(err = null) {
    const callbacks = this.rescanCallbacks.splice(0)
    if (!err) {
      for (const index of [...this.bits]) this.bitfield.set(index, false)
    }
    for (const cb of callbacks) cb(err)
  }
}

function put(store, index, value) {
  return new Promise((resolve, reject) => {
    store.put(index, Buffer.isBuffer(value) ? value : Buffer.from(value), err => err ? reject(err) : resolve())
  })
}

function get(store, index, opts) {
  return new Promise((resolve, reject) => {
    store.get(index, opts || {}, (err, buffer) => err ? reject(err) : resolve(buffer))
  })
}

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

test('RAM store source avoids WebTorrent private recovery APIs', async () => {
  const source = await fs.readFile(new URL('../desktop/LruMemoryChunkStore.js', import.meta.url), 'utf8')
  assert.equal(source.includes('_markUnverified'), false)
  assert.equal(source.includes('_reservations'), false)
  assert.match(source, /rescanFiles/)
})

test('stores and reads full and partial chunks from RAM', async () => {
  const store = new LruMemoryChunkStore(8, { maxBytes: 64 })

  await put(store, 0, 'abcdefgh')

  assert.equal((await get(store, 0)).toString(), 'abcdefgh')
  assert.equal((await get(store, 0, { offset: 2, length: 3 })).toString(), 'cde')
  assert.equal(store.bytes, 8)
  assert.equal(store.chunks.size, 1)
})

test('eviction records removed pieces without touching WebTorrent internals', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 8, maxChunks: 2 })

  torrent.bitfield.set(0, true)
  await put(store, 0, 'aaaa')
  torrent.bitfield.set(1, true)
  await put(store, 1, 'bbbb')
  torrent.bitfield.set(2, true)
  await put(store, 2, 'cccc')

  assert.equal(store.evictions, 2)
  assert.equal(store.bytes, 4)
  assert.equal(store.chunks.has(0), false)
  assert.equal(torrent.bitfield.get(0), true)
  assert.equal(torrent.rescans, 0)
  assert.deepEqual(torrent.selections, [])
})

test('reads refresh LRU recency before eviction', async () => {
  const store = new LruMemoryChunkStore(4, { maxBytes: 8, maxChunks: 2, lowWatermarkRatio: 1 })

  await put(store, 0, 'aaaa')
  await put(store, 1, 'bbbb')
  assert.equal((await get(store, 0)).toString(), 'aaaa')
  await put(store, 2, 'cccc')

  assert.equal(store.chunks.has(0), true)
  assert.equal(store.chunks.has(1), false)
  assert.equal(store.chunks.has(2), true)
})

test('stale bitfield read rescans and waits for the piece to be verified again', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 200 })

  torrent.bitfield.set(5, true)
  const pending = get(store, 5)
  await tick()

  assert.equal(store.staleMisses, 1)
  assert.equal(store.pendingReadCount, 1)
  assert.equal(torrent.rescans, 1)
  assert.equal(torrent.bitfield.get(5), false)
  assert.deepEqual(torrent.selections, [{ start: 5, end: 5, priority: 2 }])
  assert.deepEqual(torrent.criticalPieces, [{ start: 5, end: 5 }])

  await put(store, 5, 'done')
  torrent.bitfield.set(5, true)
  torrent.emit('verified', 5)

  assert.equal((await pending).toString(), 'done')
  assert.equal(store.recoveries, 1)
  assert.equal(store.pendingReadCount, 0)
})

test('registers stale recovery listener before rescanning pieces', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 200 })

  torrent.bitfield.set(3, true)
  const pending = get(store, 3)
  await tick()

  assert.deepEqual(torrent.listenerCountsAtRescan, [1])
  assert.equal(torrent.listenerCount('verified'), 1)

  store.close()
  await assert.rejects(pending, /Store is closed/)
})

test('coalesces pending stale reads by chunk index', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(8, { torrent, maxBytes: 64, getTimeoutMs: 200 })

  torrent.bitfield.set(7, true)
  const full = get(store, 7)
  const partial = get(store, 7, { offset: 2, length: 3 })
  await tick()

  assert.equal(store.pendingReads.size, 1)
  assert.equal(store.pendingReadCount, 2)
  assert.equal(torrent.listenerCount('verified'), 1)
  assert.equal(torrent.rescans, 1)
  assert.deepEqual(torrent.selections, [{ start: 7, end: 7, priority: 2 }])

  await put(store, 7, 'abcdefgh')
  torrent.bitfield.set(7, true)
  torrent.emit('verified', 7)

  assert.equal((await full).toString(), 'abcdefgh')
  assert.equal((await partial).toString(), 'cde')
  assert.equal(store.recoveries, 2)
  assert.equal(store.pendingReadCount, 0)
  assert.equal(torrent.listenerCount('verified'), 0)
})

test('coalesces concurrent stale misses behind one WebTorrent rescan', async () => {
  const torrent = new FakeTorrent({ autoRescan: false })
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 200 })

  torrent.bitfield.set(1, true)
  torrent.bitfield.set(2, true)
  const first = get(store, 1, { offset: 0, length: 4 })
  const second = get(store, 2, { offset: 0, length: 4 })

  assert.equal(torrent.rescans, 1)
  assert.equal(store.pendingReadCount, 2)
  torrent.finishRescan()
  await tick()

  assert.deepEqual(torrent.selections, [
    { start: 1, end: 1, priority: 2 },
    { start: 2, end: 2, priority: 2 }
  ])

  store.close()
  await assert.rejects(first, /Store is closed/)
  await assert.rejects(second, /Store is closed/)
})

test('bounds total pending stale reads', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 200, maxPendingReads: 1 })

  torrent.bitfield.set(1, true)
  torrent.bitfield.set(2, true)
  const first = get(store, 1)

  await assert.rejects(
    get(store, 2, { offset: 0, length: 4 }),
    /Too many pending RAM reads/
  )

  store.close()
  await assert.rejects(first, /Store is closed/)
})

test('missing unverified chunk returns notFound instead of waiting forever', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 20 })

  await assert.rejects(
    get(store, 9),
    err => err.notFound === true && /not in RAM cache/.test(err.message)
  )
})

test('close clears chunks and rejects pending recovery reads', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 200 })

  await put(store, 1, 'data')
  torrent.bitfield.set(2, true)
  const pending = get(store, 2)
  store.close()

  await assert.rejects(pending, /Store is closed/)
  assert.equal(store.bytes, 0)
  assert.equal(store.chunks.size, 0)
  assert.equal(store.pendingReadCount, 0)
})

test('stress eviction keeps chunks and bytes within configured limits', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(16, { torrent, maxBytes: 16 * 32, maxChunks: 32 })

  for (let i = 0; i < 2000; i += 1) {
    torrent.bitfield.set(i, true)
    await put(store, i, Buffer.alloc(16, i % 255))
    assert.equal(store.chunks.size <= store.maxChunks, true)
    assert.equal(store.bytes <= store.maxBytes, true)
  }

  assert.equal(store.chunks.size <= 32, true)
  assert.equal(store.bytes <= 16 * 32, true)
  assert.equal(store.evictions > 0, true)

  for (let i = 1995; i < 2000; i += 1) {
    assert.equal((await get(store, i)).length, 16)
  }
})

test('stress overwrites account for byte totals without leaking chunks', async () => {
  const store = new LruMemoryChunkStore(8, { maxBytes: 8 * 10, maxChunks: 10 })

  for (let i = 0; i < 1000; i += 1) {
    await put(store, i % 10, Buffer.alloc(8, i % 255))
    assert.equal(store.chunks.size <= 10, true)
    assert.equal(store.bytes <= 80, true)
  }

  assert.equal(store.chunks.size, 10)
  assert.equal(store.bytes, 80)
})

test('reports and warns when one protected chunk is larger than byte budget', async () => {
  const warnings = []
  const store = new LruMemoryChunkStore(32, {
    maxBytes: 8,
    maxChunks: 1,
    warningIntervalMs: 1,
    onWarning: warning => warnings.push(warning)
  })

  await put(store, 1, Buffer.alloc(32))
  const stats = store.getStats()

  assert.equal(store.chunks.size, 1)
  assert.equal(store.bytes, 32)
  assert.equal(stats.overLimitBytes, 24)
  assert.equal(stats.overLimitWarnings, 1)
  assert.equal(warnings.length, 1)
})

test('eviction clears down to the configured low watermark', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(40, {
    torrent,
    maxBytes: 100,
    maxChunks: 100,
    lowWatermarkRatio: 0.5
  })

  for (let index = 0; index < 3; index += 1) {
    torrent.bitfield.set(index, true)
    await put(store, index, Buffer.alloc(40, index))
  }

  const stats = store.getStats()
  assert.equal(stats.lowWatermarkBytes, 50)
  assert.equal(store.bytes, 40)
  assert.equal(store.getStats().recentEvictions, 2)
  assert.equal(torrent.rescans, 0)
  assert.equal(store.chunks.has(2), true)
})

test('recently evicted missing chunks wait for reverify instead of ending the stream', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, {
    torrent,
    maxBytes: 8,
    maxChunks: 2,
    getTimeoutMs: 200,
    recentEvictionTtlMs: 60_000
  })

  for (let index = 0; index < 3; index += 1) {
    torrent.bitfield.set(index, true)
    await put(store, index, String(index).repeat(4))
  }

  assert.equal(torrent.bitfield.get(0), true)
  assert.equal(store.getStats().recentEvictions, 2)

  const pending = get(store, 0)
  await tick()

  assert.equal(store.pendingReadCount, 1)
  assert.equal(torrent.rescans, 1)
  assert.deepEqual(torrent.selections.at(-1), { start: 0, end: 0, priority: 2 })
  assert.deepEqual(torrent.criticalPieces.at(-1), { start: 0, end: 0 })

  await put(store, 0, 'done')
  torrent.bitfield.set(0, true)
  torrent.emit('verified', 0)

  assert.equal((await pending).toString(), 'done')
  assert.equal(store.recoveries, 1)
  assert.equal(store.recoveryWaits, 1)
})

test('playback window protects nearby chunks from eviction', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, {
    torrent,
    maxBytes: 16,
    maxChunks: 4,
    windowBehindPieces: 1,
    windowAheadPieces: 2,
    lowWatermarkRatio: 0.5
  })
  store.setPlaybackHead(5)

  for (const index of [0, 4, 5, 6, 7]) {
    torrent.bitfield.set(index, true)
    await put(store, index, String(index).repeat(4))
  }

  assert.equal(store.chunks.has(0), false)
  assert.equal(store.chunks.has(4), true)
  assert.equal(store.chunks.has(5), true)
  assert.equal(store.chunks.has(6), true)
})

test('active reads are temporarily protected during forced eviction', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, {
    torrent,
    maxBytes: 16,
    maxChunks: 4,
    activeReadTtlMs: 50
  })

  for (let index = 0; index < 4; index += 1) {
    torrent.bitfield.set(index, true)
    await put(store, index, String(index).repeat(4))
  }

  assert.equal((await get(store, 0)).toString(), '0000')
  store.forceEvictTo(0.25)

  assert.equal(store.chunks.has(0), true)
  assert.equal(store.chunks.size, 1)
})

test('closing store removes stale recovery listeners', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 200 })
  torrent.bitfield.set(8, true)
  const pending = get(store, 8)

  assert.equal(torrent.listenerCount('verified'), 1)
  store.close()
  assert.equal(torrent.listenerCount('verified'), 0)
  await assert.rejects(pending, /Store is closed/)
})

test('forceEvictTo returns pressure stats and refetches evicted pieces with priority', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, maxChunks: 4 })

  for (let index = 0; index < 4; index += 1) {
    torrent.bitfield.set(index, true)
    await put(store, index, String(index).repeat(4))
  }

  const stats = store.forceEvictTo(0.5)
  assert.equal(stats.bytes <= 8, true)
  assert.equal(store.evictions > 0, true)

  const evicted = [...store.recentEvictions.keys()][0]
  const pending = get(store, evicted)
  await tick()
  assert.deepEqual(torrent.selections.at(-1), { start: evicted, end: evicted, priority: 2 })
  assert.deepEqual(torrent.criticalPieces.at(-1), { start: evicted, end: evicted })
  store.close()
  await assert.rejects(pending, /Store is closed/)
})
