export const DEFAULT_CONTENT_LANGUAGE = 'any'

export const AUDIO_LANGUAGE_OPTIONS = [
  { code: 'any', label: 'Any language' },
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pl', label: 'Polski' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'vi', label: 'Tiếng Việt' }
]

const OPEN_CATALOG = [
  {
    id: 'sintel',
    title: 'Sintel',
    year: 2010,
    description: 'Open movie from Blender Foundation.',
    language: 'en',
    quality: '1080p',
    sizeBytes: 1_200_000_000,
    seeders: 0,
    leechers: 0,
    posterUrl: 'https://archive.org/services/img/Sintel',
    torrentUrl: 'https://archive.org/download/Sintel/Sintel_archive.torrent'
  },
  {
    id: 'big-buck-bunny',
    title: 'Big Buck Bunny',
    year: 2008,
    description: 'Open animated short film from Blender Foundation.',
    language: 'en',
    quality: '1080p',
    sizeBytes: 900_000_000,
    seeders: 0,
    leechers: 0,
    posterUrl: 'https://archive.org/services/img/BigBuckBunny_328',
    torrentUrl: 'https://archive.org/download/BigBuckBunny_328/BigBuckBunny_328_archive.torrent'
  },
  {
    id: 'night-of-the-living-dead',
    title: 'Night of the Living Dead',
    year: 1968,
    description: 'Public-domain horror film hosted by Internet Archive.',
    language: 'en',
    quality: '720p',
    sizeBytes: 750_000_000,
    seeders: 0,
    leechers: 0,
    posterUrl: 'https://archive.org/services/img/night_of_the_living_dead',
    torrentUrl: 'https://archive.org/download/night_of_the_living_dead/night_of_the_living_dead_archive.torrent'
  }
]

function cleanText(value, fallback = '') {
  return String(value || fallback).trim()
}

function normalizeLanguage(value) {
  const raw = cleanText(Array.isArray(value) ? value[0] : value).toLowerCase()
  if (!raw) return 'und'
  if (raw.startsWith('jpn') || raw.startsWith('ja')) return 'ja'
  if (raw.startsWith('rus') || raw.startsWith('ru')) return 'ru'
  if (raw.startsWith('eng') || raw.startsWith('en')) return 'en'
  if (raw.startsWith('spa') || raw.startsWith('es')) return 'es'
  if (raw.startsWith('fre') || raw.startsWith('fra') || raw.startsWith('fr')) return 'fr'
  if (raw.startsWith('ger') || raw.startsWith('de')) return 'de'
  if (raw.startsWith('chi') || raw.startsWith('zho') || raw.startsWith('zh')) return 'zh'
  return raw.slice(0, 12)
}

export function normalizeContentLanguage(value = DEFAULT_CONTENT_LANGUAGE) {
  const raw = cleanText(value || DEFAULT_CONTENT_LANGUAGE).toLowerCase()
  if (!raw || raw === 'any') return DEFAULT_CONTENT_LANGUAGE
  const known = AUDIO_LANGUAGE_OPTIONS.find(item => item.code === raw || raw.startsWith(`${item.code}-`))
  return known?.code || raw.slice(0, 12)
}

export function resultDedupKey(result = {}) {
  const infoHash = cleanText(result.infoHash).toLowerCase()
  if (infoHash) return `hash:${infoHash}`

  const magnet = cleanText(result.magnetURI)
  const btih = magnet.match(/(?:xt=urn:btih:)([a-z0-9]+)/i)?.[1]
  if (btih) return `hash:${btih.toLowerCase()}`

  return [
    'meta',
    cleanText(result.title).toLowerCase().replace(/\s+/g, ' '),
    result.year || '',
    cleanText(result.quality).toLowerCase(),
    Number(result.sizeBytes) || 0
  ].join(':')
}

export function dedupeSourceResults(results = []) {
  const byKey = new Map()
  for (const raw of results) {
    const result = normalizeSourceResult(raw)
    if (!result) continue
    const key = resultDedupKey(result)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...result, variants: [{ providerId: result.providerId, id: result.id }] })
      continue
    }
    existing.seeders = Math.max(Number(existing.seeders) || 0, Number(result.seeders) || 0)
    existing.leechers = Math.max(Number(existing.leechers) || 0, Number(result.leechers) || 0)
    existing.variants.push({ providerId: result.providerId, id: result.id })
    if (!existing.magnetURI && result.magnetURI) existing.magnetURI = result.magnetURI
    if (!existing.torrentUrl && result.torrentUrl) existing.torrentUrl = result.torrentUrl
  }
  return [...byKey.values()]
}

export function normalizeSourceResult(raw = {}) {
  const title = cleanText(raw.title)
  if (!title) return null
  const providerId = cleanText(raw.providerId, 'open-catalog')
  const id = cleanText(raw.id, `${providerId}:${title}`)
  return {
    id,
    providerId,
    title,
    year: Number(raw.year) || null,
    description: cleanText(raw.description),
    posterUrl: cleanText(raw.posterUrl),
    quality: cleanText(raw.quality, 'torrent'),
    sizeBytes: Number(raw.sizeBytes) || 0,
    seeders: Number(raw.seeders) || 0,
    leechers: Number(raw.leechers) || 0,
    language: normalizeLanguage(raw.language),
    infoHash: cleanText(raw.infoHash),
    magnetURI: cleanText(raw.magnetURI),
    torrentUrl: cleanText(raw.torrentUrl),
    torrentBytes: raw.torrentBytes || null
  }
}

function matchesQuery(item, query) {
  const needle = cleanText(query).toLowerCase()
  if (!needle) return true
  return `${item.title} ${item.description || ''}`.toLowerCase().includes(needle)
}

function matchesLanguage(item, language) {
  const wanted = normalizeContentLanguage(language)
  return wanted === DEFAULT_CONTENT_LANGUAGE || normalizeLanguage(item.language) === wanted
}

export function searchOpenCatalog(query = '', filters = {}) {
  return OPEN_CATALOG
    .filter(item => matchesQuery(item, query))
    .filter(item => matchesLanguage(item, filters.language))
    .map(item => normalizeSourceResult({ ...item, providerId: 'open-catalog' }))
}

function archiveSearchUrl(query, rows = 12) {
  const terms = cleanText(query, 'public domain movie').replace(/"/g, '')
  const params = new URLSearchParams({
    q: `mediatype:movies AND (${terms})`,
    fl: 'identifier,title,year,description,language',
    rows: String(rows),
    page: '1',
    output: 'json'
  })
  return `https://archive.org/advancedsearch.php?${params}`
}

export async function searchArchiveOrg(query = '', filters = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return []
  const response = await fetchImpl(archiveSearchUrl(query), {
    headers: { 'User-Agent': 'Torrgether source search' }
  })
  if (!response.ok) throw new Error(`Archive.org search returned HTTP ${response.status}`)
  const payload = await response.json()
  const docs = payload?.response?.docs || []
  return docs
    .map(doc => normalizeSourceResult({
      id: `archive:${doc.identifier}`,
      providerId: 'archive.org',
      title: doc.title || doc.identifier,
      year: doc.year,
      description: Array.isArray(doc.description) ? doc.description[0] : doc.description,
      language: doc.language,
      quality: 'archive',
      posterUrl: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
      torrentUrl: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(doc.identifier)}_archive.torrent`
    }))
    .filter(item => item && matchesLanguage(item, filters.language))
}

export async function searchSources(query = '', filters = {}, fetchImpl = globalThis.fetch) {
  const requestedLanguage = normalizeContentLanguage(filters.language)
  const local = searchOpenCatalog(query, filters)
  const remoteResult = await searchArchiveOrg(query, filters, fetchImpl).catch(() => [])
  let results = dedupeSourceResults([...local, ...remoteResult])
  let languageFallback = false

  if (requestedLanguage !== DEFAULT_CONTENT_LANGUAGE && results.length === 0) {
    languageFallback = true
    const fallbackLocal = searchOpenCatalog(query, { ...filters, language: DEFAULT_CONTENT_LANGUAGE })
    const fallbackRemote = await searchArchiveOrg(query, { ...filters, language: DEFAULT_CONTENT_LANGUAGE }, fetchImpl).catch(() => [])
    results = dedupeSourceResults([...fallbackLocal, ...fallbackRemote])
  }

  return {
    ok: true,
    query,
    requestedLanguage,
    languageFallback,
    results
  }
}

export async function fetchSourceTorrent(result, fetchImpl = globalThis.fetch, { maxBytes = 10 * 1024 * 1024 } = {}) {
  const normalized = normalizeSourceResult(result)
  if (!normalized) throw new Error('Invalid source result')
  if (normalized.magnetURI) return { kind: 'magnet', name: normalized.title, magnetURI: normalized.magnetURI }
  if (normalized.torrentBytes) {
    return { kind: 'torrent-file', name: `${normalized.title}.torrent`, base64: Buffer.from(normalized.torrentBytes).toString('base64') }
  }
  if (!normalized.torrentUrl) throw new Error('This source result does not expose a torrent or magnet link')
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available')
  const response = await fetchImpl(normalized.torrentUrl, {
    headers: { 'User-Agent': 'Torrgether torrent importer' }
  })
  if (!response.ok) throw new Error(`Torrent download returned HTTP ${response.status}`)
  const length = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(length) && length > maxBytes) throw new Error(`Torrent file is too large: ${length} bytes`)
  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > maxBytes) throw new Error(`Torrent file is too large: ${arrayBuffer.byteLength} bytes`)
  return {
    kind: 'torrent-file',
    name: `${normalized.title}.torrent`,
    base64: Buffer.from(arrayBuffer).toString('base64')
  }
}
