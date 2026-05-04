export function normalizeServerUrl(value) {
  const raw = String(value || '').trim() || 'http://localhost:3000'
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Signaling URL must start with http:// or https://')
  }
  return url.toString().replace(/\/$/, '')
}
