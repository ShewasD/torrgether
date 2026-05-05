export const DEFAULT_UPDATE_REPO = 'ShewasD/torrgether'

export function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return match.slice(1).map(Number)
}

export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1
    if (left[i] < right[i]) return -1
  }
  return 0
}

export function normalizeUpdateRepo(value = DEFAULT_UPDATE_REPO) {
  const repo = String(value || DEFAULT_UPDATE_REPO).trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, '')
  const parts = repo.split('/')
  if (parts.length !== 2) return DEFAULT_UPDATE_REPO
  const [owner, name] = parts
  const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
  const repoPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
  if (!ownerPattern.test(owner) || !repoPattern.test(name) || name.includes('..')) return DEFAULT_UPDATE_REPO
  return repo
}

function timeoutSignal(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || typeof AbortController !== 'function') return { signal: undefined, cancel: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
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
  platform = process.platform,
  timeoutMs = Number(process.env.UPDATE_CHECK_TIMEOUT_MS || 10_000)
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, updateAvailable: false, error: 'fetch is not available' }
  }

  const normalizedRepo = normalizeUpdateRepo(repo)
  const releaseUrl = `https://api.github.com/repos/${normalizedRepo}/releases/latest`
  const timeout = timeoutSignal(timeoutMs)
  let response
  try {
    response = await fetchImpl(releaseUrl, {
      signal: timeout.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Torrgether update checker'
      }
    })
  } finally {
    timeout.cancel()
  }

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
  const comparison = compareVersions(latestVersion, currentVersion)
  if (comparison == null) {
    return {
      ok: false,
      repo: normalizedRepo,
      currentVersion,
      latestVersion,
      updateAvailable: false,
      error: `Could not compare versions: latest=${latestVersion || 'unknown'}, current=${currentVersion || 'unknown'}`
    }
  }
  const updateAvailable = comparison > 0

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
