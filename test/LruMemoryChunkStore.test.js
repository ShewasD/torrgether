import test from 'node:test'
import assert from 'node:assert/strict'
import EventEmitter from 'node:events'
import LruMemoryChunkStore from '../desktop/LruMemoryChunkStore.js'

class FakeTorrent extends EventEmitter {
  constructor() {
    super()
    this.destroyed = false
    this.bits = new Set()
    this.unverified = []
    this.selections = []
    this.criticalPieces = []
    this.selectionUpdates = 0
    this.wireUpdates = 0
    this._reservations = []
    this.bitfield = {
      get: index => this.bits.has(index),
      set: (index, value) => {
        if (value) this.bits.add(index)
        else this.bits.delete(index)
      }
    }
  }

  _markUnverified(index) {
    this.unverified.push(index)
    this.bitfield.set(index, false)
  }

  select(start, end, priority) {
    this.selections.push({ start, end, priority })
  }

  critical(start, end) {
    this.criticalPieces.push({ start, end })
  }

  _updateSelections() {
    this.selectionUpdates += 1
  }

  _update() {
    this.wireUpdates += 1
  }
}

class CountingLruMemoryChunkStore extends LruMemoryChunkStore {
  constructor(...args) {
    super(...args)
    this.ensureReserveCalls = []
  }

  _ensurePieceCanBeReserved(index) {
    this.ensureReserveCalls.push(index)
    return super._ensurePieceCanBeReserved(index)
  }
}

class OrderingTorrent extends FakeTorrent {
  constructor() {
    super()
    this.listenerCountsAtUnverify = []
  }

  _markUnverified(index) {
    this.listenerCountsAtUnverify.push(this.listenerCount('verified'))
    super._markUnverified(index)
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

test('stores and reads full and partial chunks from RAM', async () => {
  const store = new LruMemoryChunkStore(8, { maxBytes: 64 })

  await put(store, 0, 'abcdefgh')

  assert.equal((await get(store, 0)).toString(), 'abcdefgh')
  assert.equal((await get(store, 0, { offset: 2, length: 3 })).toString(), 'cde')
  assert.equal(store.bytes, 8)
  assert.equal(store.chunks.size, 1)
})

test('eviction marks the removed verified piece as unavailable in WebTorrent', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 8, maxChunks: 2 })

  torrent.bitfield.set(0, true)
  torrent._reservations[0] = null
  await put(store, 0, 'aaaa')
  torrent.bitfield.set(1, true)
  await put(store, 1, 'bbbb')
  torrent.bitfield.set(2, true)
  await put(store, 2, 'cccc')

  assert.equal(store.evictions, 2)
  assert.equal(store.bytes, 4)
  assert.equal(store.chunks.has(0), false)
  assert.deepEqual(torrent.unverified, [0, 1])
  assert.equal(torrent.bitfield.get(0), false)
  assert.deepEqual(torrent._reservations[0], [])
  assert.equal(torrent.selectionUpdates > 0, true)
})

test('eviction repairs reservations once per removed piece', async () => {
  const torrent = new FakeTorrent()
  const store = new CountingLruMemoryChunkStore(4, { torrent, maxBytes: 4, maxChunks: 1 })

  torrent.bitfield.set(0, true)
  torrent._reservations[0] = null
  await put(store, 0, 'aaaa')
  torrent.bitfield.set(1, true)
  await put(store, 1, 'bbbb')

  assert.equal(store.evictions, 1)
  assert.deepEqual(store.ensureReserveCalls, [0])
  assert.deepEqual(torrent._reservations[0], [])
})

test('stale bitfield read waits for the piece to be verified again', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 200 })

  torrent.bitfield.set(5, true)
  torrent._reservations[5] = null
  const pending = get(store, 5)

  assert.equal(store.staleMisses, 1)
  assert.equal(store.pendingReadCount, 1)
  assert.equal(torrent.bitfield.get(5), false)
  assert.deepEqual(torrent._reservations[5], [])
  assert.deepEqual(torrent.unverified, [5])
  assert.deepEqual(torrent.selections, [{ start: 5, end: 5, priority: 2 }])
  assert.deepEqual(torrent.criticalPieces, [{ start: 5, end: 5 }])

  await put(store, 5, 'done')
  torrent.bitfield.set(5, true)
  torrent.emit('verified', 5)

  assert.equal((await pending).toString(), 'done')
  assert.equal(store.recoveries, 1)
  assert.equal(store.pendingReadCount, 0)
})

test('registers stale recovery listener before requesting the piece again', async () => {
  const torrent = new OrderingTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 200 })

  torrent.bitfield.set(3, true)
  const pending = get(store, 3)

  assert.deepEqual(torrent.listenerCountsAtUnverify, [1])
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

  assert.equal(store.pendingReads.size, 1)
  assert.equal(store.pendingReadCount, 2)
  assert.equal(torrent.listenerCount('verified'), 1)
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

test('bounds total pending stale reads', async () => {
  const torrent = new FakeTorrent()
  const store = new LruMemoryChunkStore(4, { torrent, maxBytes: 16, getTimeoutMs: 200, maxPendingReads: 1 })

  torrent.bitfield.set(1, true)
  torrent.bitfield.set(2, true)
  const first = get(store, 1)

  await assert.rejects(
    get(store, 2),
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
  assert.deepEqual(torrent.unverified, [0, 1])
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

  assert.equal(torrent.bitfield.get(0), false)
  assert.equal(store.getStats().recentEvictions, 2)

  const pending = get(store, 0)

  assert.equal(store.pendingReadCount, 1)
  assert.deepEqual(torrent.selections.at(-1), { start: 0, end: 0, priority: 2 })
  assert.deepEqual(torrent.criticalPieces.at(-1), { start: 0, end: 0 })

  await put(store, 0, 'done')
  torrent.bitfield.set(0, true)
  torrent.emit('verified', 0)

  assert.equal((await pending).toString(), 'done')
  assert.equal(store.recoveries, 1)
  assert.equal(store.recoveryWaits, 1)
})
