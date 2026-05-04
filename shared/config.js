function parsePositiveInt(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

export function normalizePublicUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `http://${raw}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported public URL protocol: ${url.protocol}`)
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export function parseCorsOrigin(value = '', publicUrl = null) {
  const raw = String(value || '').trim()
  if (!raw) return publicUrl ? [publicUrl] : []
  if (raw === '*') return '*'
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

export function getServerConfig(env = process.env) {
  const port = parsePositiveInt(env.PORT, 3000)
  const host = String(env.HOST || '0.0.0.0').trim() || '0.0.0.0'
  return {
    port,
    host,
    publicUrl: normalizePublicUrl(env.PUBLIC_URL),
    corsOrigin: parseCorsOrigin(env.CORS_ORIGIN, normalizePublicUrl(env.PUBLIC_URL)),
    serverToken: String(env.SERVER_TOKEN || ''),
    logDir: env.LOG_DIR || null,
    logLevel: env.LOG_LEVEL || 'info'
  }
}

export function formatServerUrls({ host, port, publicUrl }) {
  const localUrl = `http://localhost:${port}`
  const bindUrl = `http://${host}:${port}`
  return {
    localUrl,
    bindUrl,
    publicUrl: publicUrl || null,
    displayUrl: publicUrl || localUrl
  }
}
