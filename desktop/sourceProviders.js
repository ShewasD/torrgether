export const DEFAULT_CONTENT_LANGUAGE = 'any'

export const MEDIA_TYPES = ['all', 'movie', 'series', 'anime']

export const AUDIO_LANGUAGE_OPTIONS = [
  { code: 'any', label: 'Any language' },
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'id', label: 'Indonesian' },
  { code: 'vi', label: 'Vietnamese' }
]

const DEFAULT_CATALOG_LIMIT = Number(process.env.CATALOG_MAX_RESULTS || 24)
const DEFAULT_SEARCH_TIMEOUT_MS = Number(process.env.CATALOG_SEARCH_TIMEOUT_MS || 15_000)

const OPEN_CATALOG = [
  {
    id: 'sintel',
    title: 'Sintel',
    year: 2010,
    description: 'Open movie from Blender Foundation.',
    mediaType: 'movie',
    language: 'en',
    quality: '1080p',
    sizeBytes: 0,
    seeders: 0,
    leechers: 0,
    posterUrl: 'https://archive.org/services/img/Sintel',
    backdropUrl: 'https://archive.org/services/img/Sintel',
    torrentUrl: 'https://archive.org/download/Sintel/Sintel_archive.torrent'
  },
  {
    id: 'big-buck-bunny',
    title: 'Big Buck Bunny',
    year: 2008,
    description: 'Open animated short film from Blender Foundation.',
    mediaType: 'movie',
    language: 'en',
    quality: '1080p',
    sizeBytes: 0,
    seeders: 0,
    leechers: 0,
    posterUrl: 'https://archive.org/services/img/BigBuckBunny_328',
    backdropUrl: 'https://archive.org/services/img/BigBuckBunny_328',
    torrentUrl: 'https://archive.org/download/BigBuckBunny_328/BigBuckBunny_328_archive.torrent'
  },
  {
    id: 'night-of-the-living-dead',
    title: 'Night of the Living Dead',
    year: 1968,
    description: 'Public-domain horror film hosted by Internet Archive.',
    mediaType: 'movie',
    language: 'en',
    quality: '720p',
    sizeBytes: 0,
    seeders: 0,
    leechers: 0,
    posterUrl: 'https://archive.org/services/img/night_of_the_living_dead',
    backdropUrl: 'https://archive.org/services/img/night_of_the_living_dead',
    torrentUrl: 'https://archive.org/download/night_of_the_living_dead/night_of_the_living_dead_archive.torrent'
  }
]

function cleanText(value, fallback = '') {
  return String(value || fallback).trim()
}

function stripHtml(value) {
  return cleanText(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeMediaType(value = 'all') {
  const mediaType = cleanText(value || 'all').toLowerCase()
  return MEDIA_TYPES.includes(mediaType) ? mediaType : 'all'
}

function normalizeLanguage(value) {
  const raw = cleanText(Array.isArray(value) ? value[0] : value).toLowerCase()
  if (!raw) return 'und'
  if (raw.startsWith('jpn') || raw.startsWith('ja')) return 'ja'
  if (raw.startsWith('rus') || raw.startsWith('ru')) return 'ru'
  if (raw.startsWith('ukr') || raw.startsWith('uk')) return 'uk'
  if (raw.startsWith('eng') || raw.startsWith('en')) return 'en'
  if (raw.startsWith('spa') || raw.startsWith('es')) return 'es'
  if (raw.startsWith('por') || raw.startsWith('pt')) return 'pt'
  if (raw.startsWith('fre') || raw.startsWith('fra') || raw.startsWith('fr')) return 'fr'
  if (raw.startsWith('ger') || raw.startsWith('de')) return 'de'
  if (raw.startsWith('ita') || raw.startsWith('it')) return 'it'
  if (raw.startsWith('pol') || raw.startsWith('pl')) return 'pl'
  if (raw.startsWith('tur') || raw.startsWith('tr')) return 'tr'
  if (raw.startsWith('chi') || raw.startsWith('zho') || raw.startsWith('zh')) return 'zh'
  if (raw.startsWith('kor') || raw.startsWith('ko')) return 'ko'
  return raw.slice(0, 12)
}

export function normalizeContentLanguage(value = DEFAULT_CONTENT_LANGUAGE) {
  const raw = cleanText(value || DEFAULT_CONTENT_LANGUAGE).toLowerCase()
  if (!raw || raw === 'any') return DEFAULT_CONTENT_LANGUAGE
  const known = AUDIO_LANGUAGE_OPTIONS.find(item => item.code === raw || raw.startsWith(`${item.code}-`))
  return known?.code || raw.slice(0, 12)
}

function parseYear(...values) {
  for (const value of values) {
    const match = cleanText(value).match(/\b(19|20)\d{2}\b/)
    if (match) return Number(match[0])
  }
  return null
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function imageUrl(value) {
  const raw = cleanText(value)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : ''
  } catch {
    return ''
  }
}

export function resultDedupKey(result = {}) {
  const mediaType = normalizeMediaType(result.mediaType || 'movie')
  const infoHash = cleanText(result.infoHash).toLowerCase()
  if (infoHash) return `${mediaType}:hash:${infoHash}`

  const magnet = cleanText(result.magnetURI || result.playableSource?.magnetURI)
  const btih = magnet.match(/(?:xt=urn:btih:)([a-z0-9]+)/i)?.[1]
  if (btih) return `${mediaType}:hash:${btih.toLowerCase()}`

  return [
    mediaType,
    cleanText(result.providerId).toLowerCase(),
    cleanText(result.id).toLowerCase(),
    cleanText(result.title).toLowerCase().replace(/\s+/g, ' '),
    result.year || ''
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
    if (!existing.playableSource && result.playableSource) existing.playableSource = result.playableSource
  }
  return [...byKey.values()]
}

export function normalizeSourceResult(raw = {}) {
  const title = cleanText(raw.title)
  if (!title) return null
  const providerId = cleanText(raw.providerId, 'open-catalog')
  const id = cleanText(raw.id, `${providerId}:${title}`)
  const playableSource = raw.playableSource || (raw.torrentUrl || raw.magnetURI || raw.torrentBytes
    ? {
        torrentUrl: cleanText(raw.torrentUrl),
        magnetURI: cleanText(raw.magnetURI),
        torrentBytes: raw.torrentBytes || null
      }
    : null)

  return {
    id,
    providerId,
    mediaType: normalizeMediaType(raw.mediaType || 'movie'),
    title,
    year: Number(raw.year) || null,
    description: stripHtml(raw.description),
    posterUrl: imageUrl(raw.posterUrl),
    backdropUrl: imageUrl(raw.backdropUrl || raw.posterUrl),
    genres: Array.isArray(raw.genres) ? raw.genres.map(item => cleanText(item)).filter(Boolean).slice(0, 8) : [],
    quality: cleanText(raw.quality, playableSource ? 'torrent' : ''),
    sizeBytes: Number(raw.sizeBytes) || 0,
    seeders: Number(raw.seeders) || 0,
    leechers: Number(raw.leechers) || 0,
    language: normalizeLanguage(raw.language),
    rating: numberOrNull(raw.rating),
    ratingSource: cleanText(raw.ratingSource),
    infoHash: cleanText(raw.infoHash),
    magnetURI: cleanText(raw.magnetURI || playableSource?.magnetURI),
    torrentUrl: cleanText(raw.torrentUrl || playableSource?.torrentUrl),
    torrentBytes: raw.torrentBytes || playableSource?.torrentBytes || null,
    playableSource
  }
}

function matchesQuery(item, query) {
  const needle = cleanText(query).toLowerCase()
  if (!needle) return true
  return `${item.title} ${item.description || ''} ${(item.genres || []).join(' ')}`.toLowerCase().includes(needle)
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

function limitedRows(options = {}) {
  const value = Number(options.limit || DEFAULT_CATALOG_LIMIT)
  return Math.max(1, Math.min(50, Number.isFinite(value) ? value : DEFAULT_CATALOG_LIMIT))
}

function archiveSearchUrl(query, rows = 12) {
  const terms = cleanText(query, 'public domain movie').replace(/"/g, '')
  const params = new URLSearchParams({
    q: `mediatype:movies AND (${terms})`,
    fl: 'identifier,title,year,description,language,downloads,subject',
    rows: String(rows),
    page: '1',
    output: 'json'
  })
  return `https://archive.org/advancedsearch.php?${params}`
}

function tvMazeSearchUrl(query) {
  const params = new URLSearchParams({ q: cleanText(query, 'the office') })
  return `https://api.tvmaze.com/search/shows?${params}`
}

function jikanSearchUrl(query, limit) {
  const params = new URLSearchParams({
    q: cleanText(query, 'one piece'),
    limit: String(Math.min(limit, 25)),
    sfw: 'true'
  })
  return `https://api.jikan.moe/v4/anime?${params}`
}

function timeoutSignal(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || typeof AbortController !== 'function') return { signal: undefined, cancel: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_SEARCH_TIMEOUT_MS) {
  const timeout = timeoutSignal(timeoutMs)
  try {
    return await fetchImpl(url, { ...options, signal: timeout.signal })
  } finally {
    timeout.cancel()
  }
}

async function readResponseBodyLimited(response, maxBytes) {
  const chunks = []
  let received = 0

  if (response.body?.getReader) {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      received += chunk.length
      if (received > maxBytes) {
        try { await reader.cancel() } catch {}
        throw new Error(`Torrent file is too large: ${received} bytes`)
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > maxBytes) throw new Error(`Torrent file is too large: ${arrayBuffer.byteLength} bytes`)
  return Buffer.from(arrayBuffer)
}

export async function searchArchiveOrg(query = '', filters = {}, fetchImpl = globalThis.fetch, options = {}) {
  if (typeof fetchImpl !== 'function') return []
  const rows = limitedRows(options)
  const response = await fetchWithTimeout(fetchImpl, archiveSearchUrl(query, rows), {
    headers: { 'User-Agent': 'Torrgether source search' }
  }, options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS)
  if (!response.ok) throw new Error(`Archive.org search returned HTTP ${response.status}`)
  const payload = await response.json()
  const docs = payload?.response?.docs || []
  return docs
    .map(doc => normalizeSourceResult({
      id: `archive:${doc.identifier}`,
      providerId: 'archive.org',
      mediaType: 'movie',
      title: doc.title || doc.identifier,
      year: doc.year,
      description: Array.isArray(doc.description) ? doc.description[0] : doc.description,
      language: doc.language,
      genres: Array.isArray(doc.subject) ? doc.subject.slice(0, 6) : [],
      quality: 'archive',
      posterUrl: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
      backdropUrl: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
      torrentUrl: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(doc.identifier)}_archive.torrent`,
      playableSource: {
        torrentUrl: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(doc.identifier)}_archive.torrent`
      }
    }))
    .filter(item => item && matchesLanguage(item, filters.language))
}

export async function searchTvMaze(query = '', filters = {}, fetchImpl = globalThis.fetch, options = {}) {
  if (typeof fetchImpl !== 'function') return []
  const response = await fetchWithTimeout(fetchImpl, tvMazeSearchUrl(query), {
    headers: { 'User-Agent': 'Torrgether catalog search' }
  }, options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS)
  if (!response.ok) throw new Error(`TVmaze search returned HTTP ${response.status}`)
  const rows = limitedRows(options)
  const payload = await response.json()
  return (Array.isArray(payload) ? payload : [])
    .slice(0, rows)
    .map(entry => {
      const show = entry.show || entry
      return normalizeSourceResult({
        id: `tvmaze:${show.id}`,
        providerId: 'tvmaze',
        mediaType: 'series',
        title: show.name,
        year: parseYear(show.premiered, show.ended),
        description: show.summary,
        language: show.language,
        genres: show.genres,
        posterUrl: show.image?.original || show.image?.medium,
        backdropUrl: show.image?.original || show.image?.medium,
        rating: show.rating?.average,
        ratingSource: show.rating?.average ? 'TVmaze' : ''
      })
    })
    .filter(Boolean)
    .filter(item => matchesLanguage(item, filters.language))
}

export async function searchJikanAnime(query = '', filters = {}, fetchImpl = globalThis.fetch, options = {}) {
  if (typeof fetchImpl !== 'function') return []
  const rows = limitedRows(options)
  const response = await fetchWithTimeout(fetchImpl, jikanSearchUrl(query, rows), {
    headers: { 'User-Agent': 'Torrgether catalog search' }
  }, options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS)
  if (!response.ok) throw new Error(`Jikan search returned HTTP ${response.status}`)
  const payload = await response.json()
  return (Array.isArray(payload?.data) ? payload.data : [])
    .slice(0, rows)
    .map(item => normalizeSourceResult({
      id: `jikan:${item.mal_id}`,
      providerId: 'jikan',
      mediaType: 'anime',
      title: item.title_english || item.title,
      year: item.year || parseYear(item.aired?.from),
      description: item.synopsis,
      language: 'ja',
      genres: (item.genres || []).map(genre => genre.name),
      posterUrl: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url,
      backdropUrl: item.trailer?.images?.maximum_image_url || item.images?.jpg?.large_image_url,
      rating: item.score,
      ratingSource: Number.isFinite(Number(item.score)) ? 'MAL' : ''
    }))
    .filter(Boolean)
    .filter(item => matchesLanguage(item, filters.language))
}

export async function searchCatalog(query = '', filters = {}, fetchImpl = globalThis.fetch, options = {}) {
  const requestedLanguage = normalizeContentLanguage(filters.language)
  const mediaType = normalizeMediaType(filters.mediaType)
  const warnings = []
  const providerOptions = {
    limit: options.limit ?? DEFAULT_CATALOG_LIMIT,
    timeoutMs: options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
  }
  const tasks = []

  if (mediaType === 'all' || mediaType === 'movie') tasks.push(['archive.org', () => searchArchiveOrg(query, filters, fetchImpl, providerOptions)])
  if (mediaType === 'all' || mediaType === 'series') tasks.push(['tvmaze', () => searchTvMaze(query, filters, fetchImpl, providerOptions)])
  if (mediaType === 'all' || mediaType === 'anime') tasks.push(['jikan', () => searchJikanAnime(query, filters, fetchImpl, providerOptions)])

  const results = []
  await Promise.all(tasks.map(async ([providerId, task]) => {
    try {
      results.push(...await task())
    } catch (err) {
      warnings.push({ providerId, message: err.message || String(err) })
    }
  }))

  let normalized = dedupeSourceResults([...searchOpenCatalog(query, filters), ...results])
  let languageFallback = false

  if (requestedLanguage !== DEFAULT_CONTENT_LANGUAGE && normalized.length === 0) {
    languageFallback = true
    return searchCatalog(query, { ...filters, language: DEFAULT_CONTENT_LANGUAGE, mediaType }, fetchImpl, options)
      .then(response => ({ ...response, requestedLanguage, languageFallback: true, providerWarnings: [...warnings, ...(response.providerWarnings || [])] }))
  }

  normalized = normalized.slice(0, limitedRows(providerOptions))

  return {
    ok: true,
    query,
    mediaType,
    requestedLanguage,
    languageFallback,
    providerWarnings: warnings,
    results: normalized
  }
}

export async function searchSources(query = '', filters = {}, fetchImpl = globalThis.fetch, options = {}) {
  return searchCatalog(query, filters, fetchImpl, options)
}

export async function fetchSourceTorrent(result, fetchImpl = globalThis.fetch, { maxBytes = 10 * 1024 * 1024, timeoutMs = 30_000 } = {}) {
  const normalized = normalizeSourceResult(result)
  if (!normalized) throw new Error('Invalid source result')
  const playable = normalized.playableSource || normalized
  if (playable.magnetURI) return { kind: 'magnet', name: normalized.title, magnetURI: playable.magnetURI }
  if (playable.torrentBytes) {
    return { kind: 'torrent-file', name: `${normalized.title}.torrent`, base64: Buffer.from(playable.torrentBytes).toString('base64') }
  }
  if (!playable.torrentUrl) throw new Error('This catalog result does not expose a legal torrent or magnet source')
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available')
  const response = await fetchWithTimeout(fetchImpl, playable.torrentUrl, {
    headers: { 'User-Agent': 'Torrgether torrent importer' }
  }, timeoutMs)
  if (!response.ok) throw new Error(`Torrent download returned HTTP ${response.status}`)
  const rawLength = response.headers?.get?.('content-length')
  const length = rawLength == null || rawLength === '' ? null : Number(rawLength)
  if (Number.isFinite(length) && length > maxBytes) throw new Error(`Torrent file is too large: ${length} bytes`)
  const buffer = await readResponseBodyLimited(response, maxBytes)
  return {
    kind: 'torrent-file',
    name: `${normalized.title}.torrent`,
    base64: buffer.toString('base64')
  }
}
