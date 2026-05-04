export function parseByteSize(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null

  const u = String(unit || '').toUpperCase()
  if (u === 'KB') return Math.round(n * 1024)
  if (u === 'MB') return Math.round(n * 1024 * 1024)
  if (u === 'GB') return Math.round(n * 1024 * 1024 * 1024)
  return Math.round(n)
}

export function parseTimecode(value) {
  const parts = String(value || '').split(':').map(part => Number(part))
  if (parts.some(part => !Number.isFinite(part))) return null

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return null
}

export function parseMpvStdoutStatus(text) {
  const result = {
    cacheSeconds: null,
    cacheBytes: null,
    cacheText: null,
    timePos: null
  }

  let match
  const cacheRe = /Cache:\s*([0-9.]+)s(?:\/([0-9.]+)(B|KB|MB|GB))?/gi
  while ((match = cacheRe.exec(String(text))) !== null) {
    const seconds = Number(match[1])
    result.cacheSeconds = Number.isFinite(seconds) ? seconds : null
    result.cacheBytes = match[2] ? parseByteSize(match[2], match[3]) : null
    result.cacheText = match[0]
  }

  const avRe = /\bAV:\s*([0-9]+(?::[0-9]{2}){0,2}(?:\.[0-9]+)?)/g
  while ((match = avRe.exec(String(text))) !== null) {
    const seconds = parseTimecode(match[1])
    if (Number.isFinite(seconds)) result.timePos = seconds
  }

  return result
}
