export const WINDOWS_MPV_REPO = 'zhongfly/mpv-winbuild'

const WINDOWS_MPV_ASSET_RE = /^mpv-x86_64-\d{8}-git-[A-Za-z0-9]+\.7z$/i
const SHA256_ASSET_RE = /^sha256(?:sums)?\.txt$/i

export function selectWindowsMpvAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const mpvAsset = assets.find(asset => WINDOWS_MPV_ASSET_RE.test(String(asset?.name || '')))
  if (!mpvAsset?.browser_download_url) {
    throw new Error('Could not find a compatible mpv-x86_64 release asset')
  }

  const checksumAsset = assets.find(asset => SHA256_ASSET_RE.test(String(asset?.name || '')))
  return {
    name: mpvAsset.name,
    url: mpvAsset.browser_download_url,
    checksumName: checksumAsset?.name || null,
    checksumUrl: checksumAsset?.browser_download_url || null
  }
}

export function parseSha256Entries(text) {
  const entries = new Map()
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line)
    if (!match) continue
    const fileName = match[2].trim().replace(/^\.\/+/, '')
    entries.set(fileName, match[1].toLowerCase())
  }
  return entries
}

export function findSha256ForAsset(text, assetName) {
  const entries = parseSha256Entries(text)
  if (entries.has(assetName)) return entries.get(assetName)

  const normalizedName = String(assetName || '').replace(/\\/g, '/').split('/').pop()
  for (const [fileName, hash] of entries) {
    if (fileName.replace(/\\/g, '/').split('/').pop() === normalizedName) return hash
  }

  return null
}
