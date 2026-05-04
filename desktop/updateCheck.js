export const DEFAULT_UPDATE_REPO = 'ShewasD/torrgether'

export function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return match.slice(1).map(Number)
}

export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1
    if (left[i] < right[i]) return -1
  }
  return 0
}

export function normalizeUpdateRepo(value = DEFAULT_UPDATE_REPO) {
  const repo = String(value || DEFAULT_UPDATE_REPO).trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return DEFAULT_UPDATE_REPO
  return repo
}

export function selectReleaseAssets(assets = []) {
  const result = {
    windows: null,
    appImage: null,
    deb: null
  }

  for (const asset of assets || []) {
    const name = String(asset?.name || '')
    const item = {
      name,
      size: asset?.size || 0,
      url: asset?.browser_download_url || asset?.url || ''
    }
    if (!result.windows && /setup.*\.exe$/i.test(name)) result.windows = item
    else if (!result.appImage && /\.AppImage$/i.test(name)) result.appImage = item
    else if (!result.deb && /\.deb$/i.test(name)) result.deb = item
  }

  return result
}

export function platformAssetKey(platform = process.platform) {
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'appImage'
  return null
}

export async function checkForUpdates({
  currentVersion,
  repo = DEFAULT_UPDATE_REPO,
  fetchImpl = globalThis.fetch,
  platform = process.platform
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, updateAvailable: false, error: 'fetch is not available' }
  }

  const normalizedRepo = normalizeUpdateRepo(repo)
  const releaseUrl = `https://api.github.com/repos/${normalizedRepo}/releases/latest`
  const response = await fetchImpl(releaseUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Torrgether update checker'
    }
  })

  if (response.status === 404) {
    return {
      ok: true,
      repo: normalizedRepo,
      currentVersion,
      updateAvailable: false,
      releaseUrl: `https://github.com/${normalizedRepo}/releases`,
      message: 'No releases published yet.'
    }
  }

  if (!response.ok) {
    return { ok: false, repo: normalizedRepo, updateAvailable: false, error: `GitHub returned HTTP ${response.status}` }
  }

  const release = await response.json()
  const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '')
  const assets = selectReleaseAssets(release.assets || [])
  const preferredAsset = assets[platformAssetKey(platform)] || null
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0

  return {
    ok: true,
    repo: normalizedRepo,
    currentVersion,
    latestVersion,
    tagName: release.tag_name,
    name: release.name || release.tag_name,
    body: release.body || '',
    publishedAt: release.published_at || null,
    prerelease: Boolean(release.prerelease),
    updateAvailable,
    assets,
    preferredAsset,
    releaseUrl: release.html_url || `https://github.com/${normalizedRepo}/releases/latest`
  }
}
