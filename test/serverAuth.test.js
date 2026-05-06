import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthRateLimiter, createTokenAuthMiddleware, isServerTokenAuthorized, safeTokenEqual, tokenFromHandshake } from '../server/auth.js'
import { MAX_CLIENT_ID_LENGTH, createSocketIoOptions, decodedBase64Bytes, normalizeClientId, normalizeDisplayName, normalizeRoomId } from '../server/server.js'

test('allows all sockets when server token is not configured', () => {
  assert.equal(isServerTokenAuthorized('', {}), true)
})

test('accepts token from auth, query, or bearer header', () => {
  assert.equal(isServerTokenAuthorized('secret', { auth: { serverToken: 'secret' } }), true)
  assert.equal(isServerTokenAuthorized('secret', { query: { token: 'secret' } }), true)
  assert.equal(isServerTokenAuthorized('secret', { headers: { authorization: 'Bearer secret' } }), true)
})

test('rejects missing or wrong server token', () => {
  assert.equal(isServerTokenAuthorized('secret', {}), false)
  assert.equal(isServerTokenAuthorized('secret', { auth: { serverToken: 'wrong' } }), false)
})

test('safe token comparison accepts different input lengths without throwing', () => {
  assert.equal(safeTokenEqual('secret', 'secret'), true)
  assert.equal(safeTokenEqual('x', 'secret'), false)
  assert.equal(safeTokenEqual('', 'secret'), false)
})

test('extracts x-server-token header', () => {
  assert.equal(tokenFromHandshake({ headers: { 'x-server-token': 'secret' } }), 'secret')
})

test('keeps Socket.IO recovery disabled by default', () => {
  const options = createSocketIoOptions({ corsOrigin: '*' }, { hostGraceMs: 1234 })

  assert.equal(options.connectionStateRecovery, undefined)
})

test('keeps Socket.IO recovery behind auth middleware when enabled', () => {
  const options = createSocketIoOptions({ corsOrigin: '*' }, { hostGraceMs: 1234, connectionStateRecovery: true })

  assert.equal(options.connectionStateRecovery.maxDisconnectionDuration, 1234)
  assert.equal(options.connectionStateRecovery.skipMiddlewares, false)
})

test('exposes Socket.IO ping options', () => {
  const options = createSocketIoOptions({ corsOrigin: '*' }, { pingInterval: 30000, pingTimeout: 60000 })

  assert.equal(options.pingInterval, 30000)
  assert.equal(options.pingTimeout, 60000)
})

test('validates clientId length and emptiness', () => {
  assert.equal(normalizeClientId(' client-a '), 'client-a')
  assert.equal(normalizeClientId(''), null)
  assert.equal(normalizeClientId(' '.repeat(4)), null)
  assert.equal(normalizeClientId('a'.repeat(MAX_CLIENT_ID_LENGTH + 1)), null)
})

test('validates room ids and display names', () => {
  assert.equal(normalizeRoomId(' room_a-1 '), 'room_a-1')
  assert.equal(normalizeRoomId('bad room'), null)
  assert.equal(normalizeRoomId('../bad'), null)
  assert.equal(normalizeDisplayName(' Alice\u0000\n Bob '), 'Alice Bob')
})

test('estimates decoded base64 payload bytes without allocating decoded buffers', () => {
  assert.equal(decodedBase64Bytes(Buffer.from([1, 2, 3, 4]).toString('base64')), 4)
  assert.equal(decodedBase64Bytes(''), 0)
})

test('auth rate limiter bounds invalid attempts without storing raw tokens', () => {
  const previousTrustProxy = process.env.TRUST_PROXY
  delete process.env.TRUST_PROXY
  let time = 1000
  try {
    const limiter = createAuthRateLimiter({
      maxAttempts: 2,
      windowMs: 100,
      now: () => time
    })
    const handshake = { address: '127.0.0.1', auth: { serverToken: 'wrong-secret' } }

    assert.equal(limiter.isLimited(handshake), false)
    assert.equal(limiter.recordFailure(handshake).count, 1)
    assert.equal(limiter.recordFailure(handshake).limited, true)
    assert.equal(limiter.isLimited(handshake), true)
    assert.equal(limiter.size(), 1)

    time += 101
    assert.equal(limiter.isLimited(handshake), false)
  } finally {
    if (previousTrustProxy == null) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = previousTrustProxy
  }
})

test('auth rate limiter trusts x-forwarded-for only when TRUST_PROXY is enabled', () => {
  const previousTrustProxy = process.env.TRUST_PROXY
  try {
    delete process.env.TRUST_PROXY
    const directLimiter = createAuthRateLimiter({ maxAttempts: 1, windowMs: 1000 })
    const first = { address: '10.0.0.10', headers: { 'x-forwarded-for': '198.51.100.1' }, auth: { serverToken: 'wrong' } }
    const second = { address: '10.0.0.10', headers: { 'x-forwarded-for': '198.51.100.2' }, auth: { serverToken: 'wrong' } }
    directLimiter.recordFailure(first)
    assert.equal(directLimiter.isLimited(second), true)

    process.env.TRUST_PROXY = '1'
    const proxyLimiter = createAuthRateLimiter({ maxAttempts: 1, windowMs: 1000 })
    proxyLimiter.recordFailure(first)
    assert.equal(proxyLimiter.isLimited(second), false)
  } finally {
    if (previousTrustProxy == null) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = previousTrustProxy
  }
})

test('auth rate limiter cleans expired entries and caps total keys', () => {
  let time = 1000
  const limiter = createAuthRateLimiter({
    maxAttempts: 2,
    maxEntries: 2,
    windowMs: 100,
    now: () => time
  })

  limiter.recordFailure({ address: '1.1.1.1', auth: { serverToken: 'a' } })
  limiter.recordFailure({ address: '1.1.1.2', auth: { serverToken: 'b' } })
  limiter.recordFailure({ address: '1.1.1.3', auth: { serverToken: 'c' } })
  assert.equal(limiter.size(), 2)

  time += 101
  assert.equal(limiter.cleanup(), 0)
})

test('token auth middleware rate limits repeated invalid tokens', async () => {
  const warnings = []
  const middleware = createTokenAuthMiddleware('secret', { warn: (message, data) => warnings.push({ message, data }) }, {
    maxAttempts: 1,
    windowMs: 1000
  })
  const makeSocket = token => ({
    id: 'socket-1',
    handshake: { address: '127.0.0.1', auth: { serverToken: token } }
  })
  const run = socket => new Promise(resolve => middleware(socket, err => resolve(err)))

  const first = await run(makeSocket('wrong-token'))
  const second = await run(makeSocket('wrong-token'))
  const valid = await run(makeSocket('secret'))

  assert.equal(first.message, 'Invalid server token')
  assert.equal(second.message, 'Too many invalid server token attempts')
  assert.equal(valid, undefined)
  assert.equal(warnings.some(entry => JSON.stringify(entry).includes('wrong-token')), false)
  assert.equal(warnings.some(entry => entry.data?.tokenFingerprint), true)
})
