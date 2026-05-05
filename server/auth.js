import { createHash, timingSafeEqual } from 'crypto'

const DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS = 60_000
const DEFAULT_AUTH_RATE_LIMIT_MAX_ATTEMPTS = 20
const DEFAULT_AUTH_RATE_LIMIT_MAX_ENTRIES = 5000

function tokenValue(value) {
  if (Array.isArray(value)) return tokenValue(value[0])
  return value == null ? '' : String(value)
}

export function tokenFromHandshake(handshake = {}) {
  const authorization = tokenValue(handshake.headers?.['authorization'])
  const bearerMatch = /^Bearer\s+(\S+)$/i.exec(authorization)
  const bearerToken = bearerMatch ? bearerMatch[1] : ''
  return (
    tokenValue(handshake.auth?.serverToken) ||
    tokenValue(handshake.auth?.token) ||
    tokenValue(handshake.query?.serverToken) ||
    tokenValue(handshake.query?.token) ||
    tokenValue(handshake.headers?.['x-server-token']) ||
    bearerToken ||
    ''
  )
}

export function safeTokenEqual(actual, expected) {
  const actualDigest = createHash('sha256').update(String(actual || '')).digest()
  const expectedDigest = createHash('sha256').update(String(expected || '')).digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

export function isServerTokenAuthorized(serverToken, handshake = {}) {
  if (!serverToken) return true
  return safeTokenEqual(tokenFromHandshake(handshake), serverToken)
}

function tokenFingerprint(handshake) {
  const token = tokenFromHandshake(handshake)
  return createHash('sha256').update(token || '[missing]').digest('hex').slice(0, 16)
}

function handshakeAddress(handshake = {}) {
  const trustProxy = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase())
  const source = trustProxy
    ? (handshake.headers?.['x-forwarded-for'] || handshake.address)
    : handshake.address
  return String(source || 'unknown').split(',')[0].trim()
}

export function createAuthRateLimiter({
  maxAttempts = DEFAULT_AUTH_RATE_LIMIT_MAX_ATTEMPTS,
  windowMs = DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS,
  maxEntries = DEFAULT_AUTH_RATE_LIMIT_MAX_ENTRIES,
  now = () => Date.now()
} = {}) {
  const attempts = new Map()

  function keyFor(handshake) {
    return `${handshakeAddress(handshake)}:${tokenFingerprint(handshake)}`
  }

  function cleanupExpired(current = now()) {
    for (const [entryKey, entry] of attempts) {
      if (current >= entry.resetAt) attempts.delete(entryKey)
    }
  }

  function trimOldest() {
    while (attempts.size > maxEntries) {
      const oldest = attempts.keys().next().value
      if (oldest == null) break
      attempts.delete(oldest)
    }
  }

  function getEntry(key) {
    const current = now()
    if (attempts.size >= maxEntries) cleanupExpired(current)
    const existing = attempts.get(key)
    if (!existing || current >= existing.resetAt) {
      const next = { count: 0, resetAt: current + windowMs }
      attempts.set(key, next)
      trimOldest()
      return next
    }
    return existing
  }

  return {
    isLimited(handshake) {
      const entry = getEntry(keyFor(handshake))
      return entry.count >= maxAttempts
    },
    recordFailure(handshake) {
      const entry = getEntry(keyFor(handshake))
      entry.count += 1
      return { count: entry.count, resetAt: entry.resetAt, limited: entry.count >= maxAttempts }
    },
    recordSuccess(handshake) {
      attempts.delete(keyFor(handshake))
    },
    size() {
      cleanupExpired()
      return attempts.size
    },
    cleanup() {
      cleanupExpired()
      trimOldest()
      return attempts.size
    }
  }
}

export function createTokenAuthMiddleware(serverToken, logger, options = {}) {
  const limiter = options.rateLimiter || createAuthRateLimiter({
    maxAttempts: options.maxAttempts,
    windowMs: options.windowMs
  })

  return (socket, next) => {
    if (isServerTokenAuthorized(serverToken, socket.handshake)) {
      limiter.recordSuccess(socket.handshake)
      return next()
    }

    if (serverToken && limiter.isLimited(socket.handshake)) {
      logger?.warn?.('Socket auth rate limited', {
        socketId: socket.id,
        address: socket.handshake?.address,
        tokenFingerprint: tokenFingerprint(socket.handshake)
      })
      return next(new Error('Too many invalid server token attempts'))
    }

    const attempt = serverToken ? limiter.recordFailure(socket.handshake) : null

    logger?.warn?.('Socket auth rejected', {
      socketId: socket.id,
      address: socket.handshake?.address,
      hasToken: Boolean(tokenFromHandshake(socket.handshake)),
      tokenFingerprint: tokenFingerprint(socket.handshake),
      failedAttempts: attempt?.count,
      rateLimited: attempt?.limited
    })
    next(new Error('Invalid server token'))
  }
}
