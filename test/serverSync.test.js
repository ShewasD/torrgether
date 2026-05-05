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
