import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthRateLimiter, createTokenAuthMiddleware, isServerTokenAuthorized, tokenFromHandshake } from '../server/auth.js'
import { MAX_CLIENT_ID_LENGTH, createSocketIoOptions, normalizeClientId } from '../server/server.js'

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

test('extracts x-server-token header', () => {
  assert.equal(tokenFromHandshake({ headers: { 'x-server-token': 'secret' } }), 'secret')
})

test('keeps Socket.IO recovery behind auth middleware', () => {
  const options = createSocketIoOptions({ corsOrigin: '*' }, { hostGraceMs: 1234 })

  assert.equal(options.connectionStateRecovery.maxDisconnectionDuration, 1234)
  assert.equal(options.connectionStateRecovery.skipMiddlewares, false)
})

test('validates clientId length and emptiness', () => {
  assert.equal(normalizeClientId(' client-a '), 'client-a')
  assert.equal(normalizeClientId(''), null)
  assert.equal(normalizeClientId(' '.repeat(4)), null)
  assert.equal(normalizeClientId('a'.repeat(MAX_CLIENT_ID_LENGTH + 1)), null)
})

test('auth rate limiter bounds invalid attempts without storing raw tokens', () => {
  let time = 1000
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
