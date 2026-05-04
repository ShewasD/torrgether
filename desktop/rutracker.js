export const RUTRACKER_HOME_URL = 'https://rutracker.org/forum/index.php'
export const RUTRACKER_PARTITION = 'persist:torrgether-rutracker'
export const MAX_RUTRACKER_TORRENT_BYTES = 10 * 1024 * 1024

const TORRENT_MIME_TYPES = new Set([
  'application/x-bittorrent',
  'application/download'
])

export function toSafeUrl(value) {
  try {
    return new URL(String(value || ''))
  } catch {
    return null
  }
}

export function isRutrackerTopLevelUrl(value) {
  const url = toSafeUrl(value)
  if (!url) return false
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const hostname = url.hostname.toLowerCase()
  return hostname === 'rutracker.org' || hostname.endsWith('.rutracker.org')
}

export function isMagnetUrl(value) {
  return String(value || '').trim().toLowerCase().startsWith('magnet:?')
}

export function torrentNameFromUrl(value) {
  const url = toSafeUrl(value)
  if (!url) return null
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '')
  return last || null
}

export function isTorrentFilename(value) {
  return /\.torrent(?:$|[?#])/i.test(String(value || '').trim())
}

export function isTorrentDownload({ url, mimeType, filename } = {}) {
  const cleanMime = String(mimeType || '').split(';')[0].trim().toLowerCase()
  if (isTorrentFilename(filename) || isTorrentFilename(url)) return true
  return TORRENT_MIME_TYPES.has(cleanMime) && isTorrentFilename(torrentNameFromUrl(url))
}

export function validateTorrentDownloadSize(bytes, maxBytes = MAX_RUTRACKER_TORRENT_BYTES) {
  const size = Number(bytes)
  if (!Number.isFinite(size)) return true
  if (size < 0) return false
  return size <= maxBytes
}

export function importNameForTorrent({ filename, url } = {}) {
  const cleanName = String(filename || '').trim()
  if (cleanName) return cleanName
  return torrentNameFromUrl(url) || 'rutracker.torrent'
}
