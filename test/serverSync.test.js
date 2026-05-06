import test from 'node:test'
import assert from 'node:assert/strict'
import { io as createSocket } from 'socket.io-client'
import { startSignalingServer } from '../server/server.js'

function silentLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
    close: async () => {}
  }
}

async function createTestServer(options = {}) {
  return startSignalingServer({
    host: '127.0.0.1',
    port: 0,
    serverToken: 'secret',
    logger: silentLogger(),
    roomMaintenanceIntervalMs: 1000,
    ...options
  })
}

function connectSocket(serverUrl) {
  return connectSocketWithToken(serverUrl, 'secret')
}

function connectSocketWithToken(serverUrl, token) {
  return new Promise((resolve, reject) => {
    const socket = createSocket(serverUrl, {
      auth: { serverToken: token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 1000
    })
    const timer = setTimeout(() => {
      socket.disconnect()
      reject(new Error('Timed out connecting test socket'))
    }, 1500)

    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('connect_error', err => {
      clearTimeout(timer)
      socket.disconnect()
      reject(err)
    })
  })
}

async function connectError(serverUrl, token) {
  try {
    const socket = await connectSocketWithToken(serverUrl, token)
    socket.disconnect()
    return null
  } catch (err) {
    return err
  }
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(1000).emit(event, payload, (err, response) => {
      if (err) reject(err)
      else resolve(response)
    })
  })
}

function serverUrl(server) {
  return `http://127.0.0.1:${server.config.port}`
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = predicate()
    if (result) return result
    await delay(20)
  }
  return null
}

test('room:join returns snapshot through ACK only', async t => {
  const server = await createTestServer()
  const socket = await connectSocket(serverUrl(server))
  t.after(async () => {
    socket.disconnect()
    await server.close()
  })

  const snapshots = []
  socket.on('room:snapshot', snapshot => snapshots.push(snapshot))

  const ack = await emitAck(socket, 'room:join', {
    roomId: 'join-once',
    clientId: 'client-a',
    name: 'A'
  })

  assert.equal(ack.ok, true)
  assert.equal(ack.snapshot.isHost, true)
  await delay(50)
  assert.equal(snapshots.length, 0)
})

test('host failover emits per-client snapshot with correct isHost', async t => {
  const server = await createTestServer({ hostGraceMs: 20 })
  const host = await connectSocket(serverUrl(server))
  const viewer = await connectSocket(serverUrl(server))
  t.after(async () => {
    host.disconnect()
    viewer.disconnect()
    await server.close()
  })

  const hostAck = await emitAck(host, 'room:join', {
    roomId: 'failover',
    clientId: 'host-client',
    name: 'Host'
  })
  assert.equal(hostAck.snapshot.isHost, true)

  const viewerAck = await emitAck(viewer, 'room:join', {
    roomId: 'failover',
    clientId: 'viewer-client',
    name: 'Viewer'
  })
  assert.equal(viewerAck.snapshot.isHost, false)

  const viewerSnapshots = []
  viewer.on('room:snapshot', snapshot => viewerSnapshots.push(snapshot))
  host.disconnect()

  const failoverSnapshot = await waitFor(
    () => viewerSnapshots.find(snapshot => snapshot.hostClientId === 'viewer-client' && snapshot.isHost),
    1000
  )

  assert.ok(failoverSnapshot)
  assert.equal(failoverSnapshot.members.find(member => member.clientId === 'viewer-client')?.isHost, true)
})

test('host reconnecting during grace keeps host role', async t => {
  const server = await createTestServer({ hostGraceMs: 120 })
  const host = await connectSocket(serverUrl(server))
  const viewer = await connectSocket(serverUrl(server))
  let hostReconnect = null
  t.after(async () => {
    host.disconnect()
    hostReconnect?.disconnect()
    viewer.disconnect()
    await server.close()
  })

  const hostAck = await emitAck(host, 'room:join', {
    roomId: 'failover-reconnect',
    clientId: 'host-client',
    name: 'Host'
  })
  assert.equal(hostAck.snapshot.isHost, true)

  const viewerAck = await emitAck(viewer, 'room:join', {
    roomId: 'failover-reconnect',
    clientId: 'viewer-client',
    name: 'Viewer'
  })
  assert.equal(viewerAck.snapshot.isHost, false)

  const viewerSnapshots = []
  viewer.on('room:snapshot', snapshot => viewerSnapshots.push(snapshot))
  host.disconnect()

  hostReconnect = await connectSocket(serverUrl(server))
  const reconnectAck = await emitAck(hostReconnect, 'room:join', {
    roomId: 'failover-reconnect',
    clientId: 'host-client',
    name: 'Host'
  })
  assert.equal(reconnectAck.snapshot.isHost, true)

  const failoverSnapshot = await waitFor(
    () => viewerSnapshots.find(snapshot => snapshot.hostClientId === 'viewer-client' && snapshot.isHost),
    250
  )
  assert.equal(failoverSnapshot, null)
})

test('auth rate limiting rejects repeated invalid Socket.IO connections', async t => {
  const server = await createTestServer({
    authRateLimitMaxAttempts: 1,
    authRateLimitWindowMs: 1000
  })
  t.after(async () => {
    await server.close()
  })

  const first = await connectError(serverUrl(server), 'wrong-token')
  const second = await connectError(serverUrl(server), 'wrong-token')

  assert.equal(first.message, 'Invalid server token')
  assert.equal(second.message, 'Too many invalid server token attempts')
})

test('server rejects oversized torrent-file signaling payloads', async t => {
  const server = await createTestServer()
  const socket = await connectSocket(serverUrl(server))
  t.after(async () => {
    socket.disconnect()
    await server.close()
  })

  const joinAck = await emitAck(socket, 'room:join', {
    roomId: 'oversized-payload',
    clientId: 'host-client',
    name: 'Host'
  })
  assert.equal(joinAck.snapshot.isHost, true)

  const ack = await emitAck(socket, 'torrent:set', {
    torrent: {
      kind: 'torrent-file',
      name: 'too-large.torrent',
      base64: Buffer.alloc(7 * 1024 * 1024 + 1).toString('base64')
    }
  })

  assert.equal(ack.ok, false)
  assert.match(ack.error, /too large/)
})

test('server keeps torrent-file base64 out of room snapshots and serves it on demand', async t => {
  const server = await createTestServer()
  const host = await connectSocket(serverUrl(server))
  const viewer = await connectSocket(serverUrl(server))
  t.after(async () => {
    host.disconnect()
    viewer.disconnect()
    await server.close()
  })

  const hostAck = await emitAck(host, 'room:join', {
    roomId: 'payload-ref',
    clientId: 'host-client',
    name: 'Host'
  })
  assert.equal(hostAck.snapshot.isHost, true)

  const viewerAck = await emitAck(viewer, 'room:join', {
    roomId: 'payload-ref',
    clientId: 'viewer-client',
    name: 'Viewer'
  })
  assert.equal(viewerAck.ok, true)

  const updates = []
  viewer.on('torrent:update', torrent => updates.push(torrent))
  const base64 = Buffer.from([1, 2, 3, 4]).toString('base64')
  const setAck = await emitAck(host, 'torrent:set', {
    torrent: {
      kind: 'torrent-file',
      name: 'demo.torrent',
      base64
    }
  })
  assert.equal(setAck.ok, true)

  const update = await waitFor(() => updates[0], 1000)
  assert.ok(update)
  assert.equal(update.base64, undefined)
  assert.equal(typeof update.payloadId, 'string')
  assert.equal(update.base64Bytes, 4)

  const payloadAck = await emitAck(viewer, 'torrent:get-payload', {
    version: update.version,
    payloadId: update.payloadId
  })
  assert.equal(payloadAck.ok, true)
  assert.equal(payloadAck.torrent.base64, base64)

  const late = await connectSocket(serverUrl(server))
  t.after(() => late.disconnect())
  const lateAck = await emitAck(late, 'room:join', {
    roomId: 'payload-ref',
    clientId: 'late-client',
    name: 'Late'
  })
  assert.equal(lateAck.ok, true)
  assert.equal(lateAck.snapshot.torrent.base64, undefined)
  assert.equal(lateAck.snapshot.torrent.payloadId, update.payloadId)
})

test('server enforces member and playback control limits', async t => {
  const server = await createTestServer({
    maxMembersPerRoom: 1,
    controlRateLimitMax: 1,
    controlRateLimitWindowMs: 1000
  })
  const host = await connectSocket(serverUrl(server))
  const blocked = await connectSocket(serverUrl(server))
  t.after(async () => {
    host.disconnect()
    blocked.disconnect()
    await server.close()
  })

  const joinAck = await emitAck(host, 'room:join', {
    roomId: 'limits',
    clientId: 'host-client',
    name: 'Host'
  })
  assert.equal(joinAck.ok, true)

  const blockedAck = await emitAck(blocked, 'room:join', {
    roomId: 'limits',
    clientId: 'blocked-client',
    name: 'Blocked'
  })
  assert.equal(blockedAck.ok, false)
  assert.match(blockedAck.error, /member limit/i)

  const firstControl = await emitAck(host, 'control:set', { playing: true, time: 1, reason: 'test' })
  const secondControl = await emitAck(host, 'control:set', { playing: true, time: 2, reason: 'test' })
  assert.equal(firstControl.ok, true)
  assert.equal(secondControl.ok, false)
  assert.match(secondControl.error, /rate limit/i)
})

test('server enforces room capacity', async t => {
  const server = await createTestServer({ maxRooms: 1 })
  const first = await connectSocket(serverUrl(server))
  const second = await connectSocket(serverUrl(server))
  t.after(async () => {
    first.disconnect()
    second.disconnect()
    await server.close()
  })

  const firstAck = await emitAck(first, 'room:join', {
    roomId: 'room-one',
    clientId: 'client-a',
    name: 'A'
  })
  assert.equal(firstAck.ok, true)

  const secondAck = await emitAck(second, 'room:join', {
    roomId: 'room-two',
    clientId: 'client-b',
    name: 'B'
  })
  assert.equal(secondAck.ok, false)
  assert.match(secondAck.error, /Room limit reached/)
})
