import { normalizeServerUrl } from '../shared/clientUrl.js'
import { applyTranslations, normalizeLocale, resolveInitialLocale, translate } from './i18n.js'

const $ = id => document.getElementById(id)
const RUTRACKER_BOUNDS_MIN_SIZE = 24

const els = {
  languageSelect: $('languageSelect'),
  contentLanguageSelect: $('contentLanguageSelect'),
  updateBanner: $('updateBanner'),
  updateText: $('updateText'),
  updateActionBtn: $('updateActionBtn'),
  updateDismissBtn: $('updateDismissBtn'),
  sourceSearchInput: $('sourceSearchInput'),
  sourceSearchBtn: $('sourceSearchBtn'),
  sourceResults: $('sourceResults'),
  sourceCount: $('sourceCount'),
  languageNotice: $('languageNotice'),
  themeToggleBtn: $('themeToggleBtn'),
  detailBackdrop: $('detailBackdrop'),
  detailTitle: $('detailTitle'),
  detailMeta: $('detailMeta'),
  detailDescription: $('detailDescription'),
  detailPoster: $('detailPoster'),
  catalogBadges: $('catalogBadges'),
  appEyebrow: $('appEyebrow'),
  detailImportBtn: $('detailImportBtn'),
  detailFavoriteBtn: $('detailFavoriteBtn'),
  torrentList: $('torrentList'),
  serverUrl: $('serverUrl'),
  serverToken: $('serverToken'),
  roomId: $('roomId'),
  displayName: $('displayName'),
  joinBtn: $('joinBtn'),
  catalogSourceTab: $('catalogSourceTab'),
  catalogSourcePanel: $('catalogSourcePanel'),
  manualSourceTab: $('manualSourceTab'),
  rutrackerSourceTab: $('rutrackerSourceTab'),
  manualSourcePanel: $('manualSourcePanel'),
  rutrackerPanel: $('rutrackerPanel'),
  rutrackerViewport: $('rutrackerViewport'),
  rutrackerOpenBtn: $('rutrackerOpenBtn'),
  rutrackerCloseBtn: $('rutrackerCloseBtn'),
  rutrackerBackBtn: $('rutrackerBackBtn'),
  rutrackerForwardBtn: $('rutrackerForwardBtn'),
  rutrackerReloadBtn: $('rutrackerReloadBtn'),
  rutrackerStatus: $('rutrackerStatus'),
  chooseTorrentBtn: $('chooseTorrentBtn'),
  setMagnetBtn: $('setMagnetBtn'),
  magnetInput: $('magnetInput'),
  hostControls: $('hostControls'),
  fileSelect: $('fileSelect'),
  members: $('members'),
  log: $('log'),
  connectionStatus: $('connectionStatus'),
  mpvPreflightStatus: $('mpvPreflightStatus'),
  roleStatus: $('roleStatus'),
  peerStatus: $('peerStatus'),
  speedStatus: $('speedStatus'),
  progressPercent: $('progressPercent'),
  progressBar: $('progressBar'),
  ramBar: $('ramBar'),
  ramShortStatus: $('ramShortStatus'),
  bufferStatus: $('bufferStatus'),
  cachePressureStatus: $('cachePressureStatus'),
  evictionStatus: $('evictionStatus'),
  refetchStatus: $('refetchStatus'),
  pendingStatus: $('pendingStatus'),
  seqStatus: $('seqStatus'),
  timeStatus: $('timeStatus'),
  mpvStatus: $('mpvStatus'),
  mkvHint: $('mkvHint'),
  openMpvBtn: $('openMpvBtn'),
  mpvToggleBtn: $('mpvToggleBtn'),
  mpvBackBtn: $('mpvBackBtn'),
  mpvForwardBtn: $('mpvForwardBtn'),
  mpvStopBtn: $('mpvStopBtn'),
  showMpvLogsBtn: $('showMpvLogsBtn'),
  openLogsFolderBtn: $('openLogsFolderBtn'),
  mpvLogPath: $('mpvLogPath'),
  mpvLog: $('mpvLog'),
  videoTitle: $('videoTitle')
}

const state = {
  locale: resolveInitialLocale({
    storedLocale: localStorage.getItem('torrgether.locale'),
    systemLocale: navigator.language
  }),
  clientId: localStorage.getItem('torrgether.clientId') || crypto.randomUUID(),
  roomId: null,
  isHost: false,
  members: [],
  torrentPayloadKey: null,
  torrentLoadGeneration: 0,
  currentTorrent: null,
  suppressHostPoll: false,
  lastRemoteSeq: 0,
  joined: false,
  roomPlaybackState: null,
  mpvAvailable: false,
  mpvDetails: null,
  mpvActive: false,
  externalStatus: null,
  externalStatusRequest: null,
  launchInFlight: false,
  lastHostBroadcast: { playing: false, time: 0, at: 0 },
  lastExternalPoll: null,
  heartbeatInFlight: false,
  torrentStatusInFlight: false,
  externalStatusIntervalInFlight: false,
  connectionStatus: { key: 'status.offline', params: {}, kind: 'danger' },
  sourceTab: 'catalog',
  rutrackerVisible: false,
  rutrackerBoundsRequest: null,
  contentLanguage: localStorage.getItem('torrgether.contentLanguage') || 'any',
  mediaType: localStorage.getItem('torrgether.mediaType') || 'all',
  theme: localStorage.getItem('torrgether.theme') || 'dark',
  appVersion: null,
  sourceResults: [],
  selectedSourceResult: null,
  updateReleaseUrl: null
}

localStorage.setItem('torrgether.clientId', state.clientId)
const busyButtons = new Set()
const intervalHandles = new Set()
const rendererLogLines = []
let rendererLogFlush = null
let sourceSearchGeneration = 0
let sourceSearchTimer = null

function registerInterval(callback, ms) {
  const id = setInterval(callback, ms)
  intervalHandles.add(id)
  return id
}

window.addEventListener('beforeunload', () => {
  for (const id of intervalHandles) clearInterval(id)
  intervalHandles.clear()
})

function applyTheme(theme = state.theme) {
  state.theme = theme === 'light' ? 'light' : 'dark'
  localStorage.setItem('torrgether.theme', state.theme)
  document.documentElement.dataset.theme = state.theme
  if (els.themeToggleBtn) els.themeToggleBtn.textContent = state.theme === 'dark' ? '☾' : '☀'
}

applyTheme(state.theme)

function t(key, params = {}) {
  return translate(state.locale, key, params)
}

function setLocale(locale) {
  state.locale = normalizeLocale(locale)
  localStorage.setItem('torrgether.locale', state.locale)
  if (els.languageSelect) els.languageSelect.value = state.locale
  applyTranslations(document, state.locale)
  renderConnectionStatus()
  renderRole()
  renderMembers(state.members)
  updateVideoInfo()
  setMpvPreflight(state.mpvDetails)
  updateSourceTabs()
  renderSourceResults(state.sourceResults)
  renderSelectedSource(state.selectedSourceResult)
  updateAppVersionLabel()
}

function updateAppVersionLabel() {
  if (els.appEyebrow) els.appEyebrow.textContent = state.appVersion ? `Torrgether ${state.appVersion}` : t('app.eyebrow')
}

function setContentLanguage(language) {
  state.contentLanguage = String(language || 'any')
  localStorage.setItem('torrgether.contentLanguage', state.contentLanguage)
  if (els.contentLanguageSelect) els.contentLanguageSelect.value = state.contentLanguage
  scheduleSearchCatalog()
}

function setMediaType(mediaType) {
  state.mediaType = ['all', 'movie', 'series', 'anime'].includes(mediaType) ? mediaType : 'all'
  localStorage.setItem('torrgether.mediaType', state.mediaType)
  document.querySelectorAll('[data-media-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.mediaFilter === state.mediaType)
  })
  scheduleSearchCatalog(0)
}

function flushRendererLog() {
  rendererLogFlush = null
  if (!els.log) return
  els.log.textContent = rendererLogLines.slice().reverse().join('\n').slice(-6000)
  els.log.scrollTop = els.log.scrollHeight
}

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`
  rendererLogLines.push(line)
  if (rendererLogLines.length > 120) rendererLogLines.splice(0, rendererLogLines.length - 120)
  if (!rendererLogFlush) rendererLogFlush = requestAnimationFrame(flushRendererLog)
  window.torrgether?.writeAppLog?.({ level: 'info', source: 'renderer', message })
}

function logT(key, params = {}) {
  log(t(key, params))
}

function mib(bytes) {
  if (!Number.isFinite(Number(bytes))) return 'n/a'
  return `${(Number(bytes) / 1024 / 1024).toFixed(0)} MiB`
}

function setConnectionKey(key, params = {}, kind = 'danger') {
  state.connectionStatus = { key, params, kind }
  renderConnectionStatus()
}

function renderConnectionStatus() {
  const { key, params, kind } = state.connectionStatus
  els.connectionStatus.textContent = t(key, params)
  els.connectionStatus.classList.remove('ok', 'warn', 'danger')
  els.connectionStatus.classList.add(kind)
}

function renderRole() {
  els.roleStatus.textContent = state.joined ? (state.isHost ? t('status.host') : t('status.viewer')) : '-'
}

function setMpvPreflight(mpv) {
  state.mpvDetails = mpv || null
  state.mpvAvailable = Boolean(mpv?.ok)
  els.mpvPreflightStatus.textContent = state.mpvAvailable ? t('mpv.ready') : t('mpv.missing')
  els.mpvPreflightStatus.classList.remove('ok', 'warn', 'danger')
  els.mpvPreflightStatus.classList.add(state.mpvAvailable ? 'ok' : 'danger')
  if (!state.mpvAvailable && mpv) {
    els.mpvStatus.textContent = t('mpv.required')
  }
  updateActionState()
}

async function refreshMpvPreflight({ announce = false } = {}) {
  try {
    const result = await window.torrgether.mpvPreflight()
    setMpvPreflight(result.mpv)
    if (announce && !result.mpv?.ok) logT('log.mpvMissing')
    return result.mpv
  } catch (err) {
    setMpvPreflight({ ok: false, error: err.message || String(err), candidates: [] })
    if (announce) logT('log.mpvPreflightFailed', { error: err.message || err })
    return null
  }
}

function setBar(el, value) {
  if (!el) return
  const percent = Math.max(0, Math.min(100, Number(value) || 0))
  el.style.width = percent + '%'
}

function prettySpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond) || 0
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB/s`
  if (value > 1024) return `${(value / 1024).toFixed(0)} KB/s`
  return `${value.toFixed(0)} B/s`
}

function logLocationLabel(value) {
  return value || '-'
}

async function applyClientConfig() {
  try {
    const config = await window.torrgether.clientConfig()
    state.appVersion = config.version || state.appVersion
    updateAppVersionLabel()
    if (config.serverUrl && els.serverUrl.value === 'http://localhost:3000') els.serverUrl.value = config.serverUrl
    if (config.serverToken && els.serverToken) els.serverToken.value = config.serverToken
    if (config.mpvLogPath) els.mpvLogPath.textContent = logLocationLabel(config.mpvLogPath)
    if (config.mpv) setMpvPreflight(config.mpv)
    else await refreshMpvPreflight()
    if (config.logDir) logT('log.logsAt', { path: config.logDir })
    if (!config.updateCheckDisabled && Number(config.updateCheckIntervalMs) > 0) {
      registerInterval(() => checkForUpdates({ quiet: true }).catch(() => {}), Number(config.updateCheckIntervalMs))
    }
  } catch (err) {
    logT('log.configFailed', { error: err.message || err })
  }
}

function isMpvConnected() {
  return Boolean(state.externalStatus?.connected)
}

function clearCurrentTorrentState() {
  state.currentTorrent = null
  state.torrentPayloadKey = null
  state.mpvActive = false
  state.externalStatus = null
  state.lastExternalPoll = null
  if (els.fileSelect) els.fileSelect.innerHTML = ''
  updateVideoInfo()
}

function updateActionState() {
  const hasTorrent = Boolean(state.currentTorrent)
  const hasMpv = state.mpvAvailable
  if (els.chooseTorrentBtn) els.chooseTorrentBtn.disabled = !state.isHost || !hasMpv
  if (els.setMagnetBtn) els.setMagnetBtn.disabled = !state.isHost || !hasMpv
  if (els.fileSelect) els.fileSelect.disabled = !state.isHost || !hasTorrent
  if (els.openMpvBtn) els.openMpvBtn.disabled = !hasTorrent || !hasMpv || state.launchInFlight
  if (els.mpvToggleBtn) els.mpvToggleBtn.disabled = !isMpvConnected()
  if (els.mpvBackBtn) els.mpvBackBtn.disabled = !isMpvConnected()
  if (els.mpvForwardBtn) els.mpvForwardBtn.disabled = !isMpvConnected()
  if (els.mpvStopBtn) els.mpvStopBtn.disabled = !state.mpvActive && !state.externalStatus?.running
  if (els.detailImportBtn) els.detailImportBtn.disabled = !state.isHost || !state.selectedSourceResult || !isPlayableResult(state.selectedSourceResult) || !hasMpv
  for (const button of busyButtons) button.disabled = true
}

async function withButtonBusy(button, busyKey, task) {
  const defaultKey = button?.dataset.i18n || ''
  const defaultText = defaultKey ? t(defaultKey) : button?.textContent
  if (button) {
    button.dataset.defaultText = defaultText
    busyButtons.add(button)
    button.disabled = true
    button.textContent = t(busyKey)
  }
  try {
    return await task()
  } catch (err) {
    logT('log.actionFailed', { error: err.message || err })
  } finally {
    if (button) {
      busyButtons.delete(button)
      button.textContent = defaultKey ? t(defaultKey) : defaultText
    }
    updateActionState()
  }
}

function renderMpvLogs(payload) {
  if (!payload) return
  if (payload.logPath) els.mpvLogPath.textContent = logLocationLabel(payload.logPath)
  const lines = payload.lines || (payload.line ? [payload.line] : [])
  if (lines.length) {
    els.mpvLog.textContent = lines.slice(-120).join('\n')
    els.mpvLog.scrollTop = els.mpvLog.scrollHeight
  }
}

async function refreshMpvLogs() {
  const result = await window.torrgether.externalPlayerLogs()
  if (!result.ok) {
    logT('log.mpvLogFailed', { error: result.error })
    if (result.lines) renderMpvLogs(result)
    return
  }
  renderMpvLogs(result)
  if (result.status?.lastStderr) logT('log.latestMpvStderr', { stderr: result.status.lastStderr })
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value || ''))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function torrentKey(payload) {
  if (!payload) return null
  const selected = payload.selectedFileIndex ?? ''
  if (payload.kind === 'magnet') return `magnet:${payload.magnetURI}:${selected}`
  if (payload.kind === 'torrent-file') return `file:${payload.name}:${await sha256Hex(payload.base64)}:${selected}`
  return `payload:${await sha256Hex(JSON.stringify(payload))}`
}

function expectedRoomTime(roomState) {
  if (!roomState) return 0
  if (!roomState.playing) return Number(roomState.time) || 0
  return (Number(roomState.time) || 0) + Math.max(0, Date.now() - roomState.updatedAt) / 1000
}

function renderFileOptions(torrent) {
  els.fileSelect.innerHTML = ''
  for (const file of torrent.files) {
    const option = document.createElement('option')
    option.value = String(file.index)
    option.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`
    if (file.index === torrent.selectedFileIndex) option.selected = true
    els.fileSelect.appendChild(option)
  }
}

function updateVideoInfo() {
  if (!state.currentTorrent) {
    els.videoTitle.textContent = t('player.noVideo')
    els.mkvHint.textContent = state.mpvAvailable ? t('player.chooseHint') : t('player.mpvMissingHint')
    updateActionState()
    return
  }

  const title = state.currentTorrent.selectedFileName || state.currentTorrent.name || t('player.selectedVideo')
  els.videoTitle.textContent = title
  els.mkvHint.textContent = t('player.selectedHint', { name: state.currentTorrent.selectedFileName || title })
  updateActionState()
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0
  if (!size) return '-'
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(0)} MB`
  return `${(size / 1024).toFixed(0)} KB`
}

function isPlayableResult(result) {
  return Boolean(result?.playableSource || result?.torrentUrl || result?.magnetURI || result?.torrentBytes)
}

function resultMeta(result) {
  return [
    result.year || '',
    result.mediaType || '',
    result.quality || '',
    result.language || ''
  ].filter(Boolean).join(' · ')
}

function ratingLabel(result) {
  const rating = Number(result?.rating)
  if (!Number.isFinite(rating)) return '-'
  return `${rating.toFixed(1)}${result?.ratingSource ? ` ${result.ratingSource}` : ''}`
}

function safePosterUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.href)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  } catch {}
  return 'https://archive.org/services/img/Sintel'
}

function isValidMagnetURI(value) {
  const magnetURI = String(value || '').trim()
  if (!magnetURI.startsWith('magnet:?') || magnetURI.length > 2048) return false
  try {
    const params = new URLSearchParams(magnetURI.slice('magnet:?'.length))
    return /^urn:btih:[a-z0-9]{32,40}$/i.test(params.get('xt') || '')
  } catch {
    return false
  }
}

function renderSelectedSource(result) {
  state.selectedSourceResult = result || null
  const title = result?.title || 'Torrgether'
  els.detailTitle.textContent = title
  els.detailMeta.textContent = result ? resultMeta(result) : 'RAM-only streaming'
  els.detailDescription.textContent = result?.description || t('app.subtitle')
  if (els.detailPoster) els.detailPoster.src = safePosterUrl(result?.posterUrl)
  if (els.detailBackdrop) els.detailBackdrop.src = safePosterUrl(result?.backdropUrl || result?.posterUrl)
  if (els.catalogBadges) {
    els.catalogBadges.innerHTML = ''
    for (const label of [
      result?.mediaType,
      result?.rating != null ? `${t('catalog.rating')}: ${ratingLabel(result)}` : null,
      result?.providerId,
      ...(result?.genres || []).slice(0, 3)
    ].filter(Boolean)) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = label
      els.catalogBadges.appendChild(badge)
    }
  }
  if (els.detailFavoriteBtn) {
    const favorite = result?.id ? localStorage.getItem(`torrgether.favorite.${result.id}`) === '1' : false
    els.detailFavoriteBtn.classList.toggle('active', favorite)
  }
  renderTorrentList(result)
  updateActionState()
}

function renderTorrentList(result) {
  if (!els.torrentList) return
  els.torrentList.innerHTML = ''
  if (!result) {
    const empty = document.createElement('p')
    empty.className = 'muted small'
    empty.textContent = t('sources.noResults')
    els.torrentList.appendChild(empty)
    return
  }

  const row = document.createElement('article')
  row.className = 'torrent-row'
  const info = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = isPlayableResult(result)
    ? `${result.providerId} · ${result.quality || 'torrent'}`
    : `${result.providerId} · metadata`
  const meta = document.createElement('span')
  meta.textContent = isPlayableResult(result)
    ? `${t('catalog.size')}: ${formatBytes(result.sizeBytes)} · ${t('catalog.seeders')}: ${result.seeders ?? 0} · ${t('sources.duplicates', { count: result.variants?.length || 1 })}`
    : t('sources.notPlayable')
  info.append(title, meta)

  const button = document.createElement('button')
  button.className = 'primary'
  button.type = 'button'
  button.textContent = t('buttons.import')
  button.disabled = !isPlayableResult(result)
  button.addEventListener('click', () => importSelectedSource(result))
  row.append(info, button)
  els.torrentList.appendChild(row)
}

function renderSourceResults(results = []) {
  state.sourceResults = results
  if (els.sourceCount) els.sourceCount.textContent = String(results.length)
  if (!els.sourceResults) return
  els.sourceResults.innerHTML = ''
  if (results.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted small'
    empty.textContent = t('sources.noResults')
    els.sourceResults.appendChild(empty)
    renderSelectedSource(null)
    return
  }

  for (const result of results) {
    const button = document.createElement('button')
    button.className = 'poster-card'
    button.type = 'button'
    const thumb = document.createElement('span')
    thumb.className = 'poster-thumb'
    const img = document.createElement('img')
    img.loading = 'lazy'
    img.alt = ''
    img.src = safePosterUrl(result.posterUrl)
    img.addEventListener('error', () => { img.src = safePosterUrl(null) }, { once: true })
    const score = document.createElement('span')
    score.className = 'poster-score'
    score.textContent = result.rating != null ? `★ ${ratingLabel(result)}` : (isPlayableResult(result) ? `↑ ${result.seeders ?? 0}` : '-')
    thumb.append(img, score)
    const title = document.createElement('strong')
    title.className = 'poster-title'
    title.textContent = result.title
    const meta = document.createElement('span')
    meta.className = 'poster-meta'
    meta.textContent = resultMeta(result)
    button.append(thumb, title, meta)
    button.addEventListener('click', () => renderSelectedSource(result))
    els.sourceResults.appendChild(button)
  }

  const selected = results.find(result => result.id === state.selectedSourceResult?.id) || null
  renderSelectedSource(selected)
}

async function searchCatalog() {
  if (!window.torrgether?.searchCatalog && !window.torrgether?.searchSources) return
  const generation = ++sourceSearchGeneration
  const query = els.sourceSearchInput?.value || ''
  const search = window.torrgether.searchCatalog || window.torrgether.searchSources
  const response = await search({
    query,
    mediaType: state.mediaType,
    language: state.contentLanguage,
    filters: { language: state.contentLanguage, mediaType: state.mediaType }
  })
  if (generation !== sourceSearchGeneration) return
  if (!response.ok) throw new Error(response.error || 'source search failed')
  renderSourceResults(response.results || [])
  if (els.languageNotice) {
    const warningText = (response.providerWarnings || []).map(item => `${item.providerId}: ${item.message}`).join(' · ')
    els.languageNotice.classList.toggle('hidden', !response.languageFallback && !warningText)
    els.languageNotice.textContent = response.languageFallback
      ? t('sources.languageFallback', { language: state.contentLanguage })
      : warningText
  }
}

function scheduleSearchCatalog(delay = 250) {
  if (sourceSearchTimer) clearTimeout(sourceSearchTimer)
  sourceSearchTimer = setTimeout(() => {
    sourceSearchTimer = null
    searchCatalog().catch(err => logT('sources.importFailed', { error: err.message || err }))
  }, delay)
}

async function importSelectedSource(result = state.selectedSourceResult) {
  if (!result) return
  if (!state.isHost) return logT('log.hostOnly')
  if (!isPlayableResult(result)) return logT('sources.importFailed', { error: t('sources.notPlayable') })
  const imported = await window.torrgether.importSourceResult(result.id)
  if (!imported.ok) return logT('sources.importFailed', { error: imported.error })
  await hostSetTorrentPayload(imported.payload)
}

async function checkForUpdates({ quiet = false } = {}) {
  if (!window.torrgether?.checkForUpdates || !els.updateBanner) return
  const result = await window.torrgether.checkForUpdates()
  if (!result.ok) {
    if (!quiet) {
      els.updateText.textContent = t('updates.error', { error: result.error || 'unknown' })
      els.updateBanner.classList.remove('hidden')
    }
    return
  }
  if (!result.updateAvailable) {
    if (!quiet && !result.disabled) {
      els.updateText.textContent = t('updates.none')
      els.updateBanner.classList.remove('hidden')
    }
    return
  }
  state.updateReleaseUrl = result.releaseUrl
  els.updateText.textContent = t('updates.available', { version: result.latestVersion || result.tagName })
  els.updateBanner.classList.remove('hidden')
}

async function pollExternalPlayerStatus() {
  if (state.externalStatusRequest) return state.externalStatusRequest
  state.externalStatusRequest = window.torrgether.externalPlayerStatus()
    .finally(() => { state.externalStatusRequest = null })
  return state.externalStatusRequest
}

async function getActivePlayback() {
  const result = await pollExternalPlayerStatus()
  if (result.ok) {
    state.externalStatus = result.status
    if (result.status.connected) {
      return {
        playing: !result.status.pause,
        time: Number(result.status.timePos) || 0
      }
    }
  }

  return {
    playing: false,
    time: expectedRoomTime(state.roomPlaybackState)
  }
}

async function applyPlayback(roomState, hard = false) {
  if (!state.currentTorrent) return
  if (!roomState || roomState.seq < state.lastRemoteSeq) return

  state.roomPlaybackState = roomState
  state.lastRemoteSeq = roomState.seq
  els.seqStatus.textContent = String(roomState.seq)
  els.timeStatus.textContent = expectedRoomTime(roomState).toFixed(1)

  if (!isMpvConnected()) return

  const target = expectedRoomTime(roomState)
  const driftThreshold = roomState.reason === 'heartbeat' ? 2.0 : 0.75
  const statusResult = await pollExternalPlayerStatus()
  const localTime = statusResult.ok ? Number(statusResult.status.timePos) || 0 : 0
  const drift = Math.abs(localTime - target)

  state.suppressHostPoll = true
  try {
    const result = await window.torrgether.controlExternalPlayer({
      playing: Boolean(roomState.playing),
      time: target,
      hard: hard || drift > driftThreshold
    })
    if (result.ok) state.externalStatus = result.status
  } finally {
    state.suppressHostPoll = false
  }
}

async function reportTorrentReady(torrentPayload, torrentResult) {
  if (!torrentPayload?.version || !window.torrgether.socketConnected()) return
  const ack = await window.torrgether.socketEmitAck('torrent:ready', {
    version: torrentPayload.version,
    infoHash: torrentResult.infoHash,
    selectedFileIndex: torrentResult.selectedFileIndex
  })

  if (!ack.ok) {
    logT('log.reportReadyFailed', { error: ack.error })
    return
  }

  if (typeof ack.isHost === 'boolean') {
    state.isHost = ack.isHost
    renderRole()
    els.hostControls.classList.toggle('hidden', !state.isHost)
    updateActionState()
  }
}

async function launchMpv(reason = 'manual') {
  if (state.launchInFlight) return
  if (!state.currentTorrent) return logT('log.chooseTorrentFirst')

  if (!state.mpvAvailable) {
    const mpv = await refreshMpvPreflight({ announce: true })
    if (!mpv?.ok) return
  }

  state.launchInFlight = true
  updateActionState()
  try {
    const target = expectedRoomTime(state.roomPlaybackState)
    const playing = Boolean(state.roomPlaybackState?.playing)
    const result = await window.torrgether.launchExternalPlayer({ startTime: target, playing })
    if (!result.ok) {
      state.mpvActive = false
      logT('log.mpvDidNotStart', { error: result.error })
      await refreshMpvLogs()
      return
    }

    state.mpvActive = true
    state.externalStatus = result.status
    state.lastExternalPoll = null
    renderMpvLogs({ logPath: result.status?.logPath, lines: result.status?.recentLogs })
    logT('log.mpvStarted', { reason })
    if (state.isHost) await emitHostControl('mpv:open', { playing, time: target })
  } finally {
    state.launchInFlight = false
    updateActionState()
  }
}

async function autoLaunchMpv(reason) {
  if (!state.currentTorrent || state.mpvActive || state.launchInFlight) return
  await launchMpv(reason)
}

async function loadTorrentFromRoom(torrentPayload) {
  if (!torrentPayload) return
  const key = await torrentKey(torrentPayload)
  if (key === state.torrentPayloadKey && state.currentTorrent) {
    await autoLaunchMpv('torrent already loaded')
    return
  }

  const generation = ++state.torrentLoadGeneration
  state.torrentPayloadKey = key
  state.mpvActive = false
  state.lastExternalPoll = null
  state.currentTorrent = null
  updateVideoInfo()
  logT('log.loadingTorrent', { name: torrentPayload.name || torrentPayload.kind })

  const result = await window.torrgether.loadTorrent({
    payload: torrentPayload,
    selectedFileIndex: torrentPayload.selectedFileIndex
  })

  if (generation !== state.torrentLoadGeneration) return

  if (!result.ok) {
    logT('log.torrentError', { error: result.error })
    updateActionState()
    return
  }

  state.currentTorrent = result.torrent
  renderFileOptions(result.torrent)
  updateVideoInfo()
  await reportTorrentReady(torrentPayload, result.torrent)

  logT('log.readyForStreaming', { name: result.torrent.selectedFileName })
  await autoLaunchMpv('torrent loaded')
}

async function applySnapshot(snapshot) {
  state.isHost = Boolean(snapshot.isHost)
  state.roomPlaybackState = snapshot.state || state.roomPlaybackState
  renderRole()
  els.hostControls.classList.toggle('hidden', !state.isHost)
  updateActionState()
  renderMembers(snapshot.members || [])
  if (snapshot.torrent) await loadTorrentFromRoom(snapshot.torrent)
  else clearCurrentTorrentState()
  await applyPlayback(snapshot.state, true)
}

function renderMembers(members) {
  state.members = members || []
  els.members.innerHTML = ''
  for (const member of state.members) {
    const li = document.createElement('li')
    li.classList.toggle('offline', !member.online)
    const role = member.isHost ? t('status.host') : t('status.viewer')
    const ready = member.hasCurrentTorrent ? t('status.ready') : t('status.loadingTorrent')
    li.textContent = `${member.name} - ${role} - ${member.online ? t('status.onlineWord') : t('status.offlineWord')} - ${ready}`
    els.members.appendChild(li)
  }
}

async function joinRoom() {
  state.roomId = els.roomId.value.trim() || 'demo-room'
  let url
  try {
    url = normalizeServerUrl(els.serverUrl.value)
    els.serverUrl.value = url
  } catch (err) {
    setConnectionKey('status.badUrl', {}, 'danger')
    logT('log.badSignalingUrl', { message: err.message })
    return
  }
  const serverToken = els.serverToken?.value.trim() || ''

  window.torrgether.connectSocket(url, {
    auth: { clientId: state.clientId, serverToken }
  })

  let joinedSocketId = null
  const joinCurrentSocket = async () => {
    setConnectionKey('status.online', { id: window.torrgether.socketId() }, 'ok')
    const socketId = window.torrgether.socketId()
    if (joinedSocketId === socketId) return
    joinedSocketId = socketId
    const ack = await window.torrgether.socketEmitAck('room:join', {
      roomId: state.roomId,
      clientId: state.clientId,
      name: els.displayName.value.trim() || t('room.defaultName')
    })
    if (ack.ok) {
      state.joined = true
      await applySnapshot(ack.snapshot)
      logT('log.joinedRoom', { room: state.roomId })
    } else {
      joinedSocketId = null
      logT('log.joinFailed', { error: ack.error })
    }
  }

  window.torrgether.socketOn('connect', joinCurrentSocket)

  window.torrgether.socketOn('disconnect', reason => {
    setConnectionKey('status.offlineReason', { reason }, 'warn')
    logT('log.connectionLost', { reason })
  })

  window.torrgether.socketOn('connect_error', err => {
    setConnectionKey('status.connectError', { message: err.message }, 'danger')
    logT('log.signalingError', { message: err.message })
  })

  window.torrgether.socketOn('room:snapshot', async snapshot => applySnapshot(snapshot))
  window.torrgether.socketOn('room:members', members => renderMembers(members))
  window.torrgether.socketOn('torrent:update', async torrent => {
    await loadTorrentFromRoom(torrent)
  })
  window.torrgether.socketOn('control:state', async roomState => {
    state.roomPlaybackState = roomState
    if (!state.isHost) await applyPlayback(roomState)
  })

  if (window.torrgether.socketConnected()) await joinCurrentSocket()
}

async function hostSetTorrentPayload(payload) {
  if (!state.isHost) return logT('log.hostOnly')
  if (!state.mpvAvailable) {
    await refreshMpvPreflight({ announce: true })
    if (!state.mpvAvailable) return
  }

  state.mpvActive = false
  state.lastExternalPoll = null
  state.currentTorrent = null
  updateVideoInfo()

  const roomPayload = { ...payload }
  const localLoad = await window.torrgether.loadTorrent({ payload: roomPayload })
  if (!localLoad.ok) {
    logT('log.torrentError', { error: localLoad.error })
    updateActionState()
    return
  }

  roomPayload.selectedFileIndex = localLoad.torrent.selectedFileIndex
  roomPayload.name = roomPayload.name || localLoad.torrent.name

  state.currentTorrent = localLoad.torrent
  state.torrentPayloadKey = await torrentKey(roomPayload)
  renderFileOptions(localLoad.torrent)
  updateVideoInfo()

  const ack = await window.torrgether.socketEmitAck('torrent:set', { torrent: roomPayload })
  if (!ack.ok) return logT('log.serverRejected', { error: ack.error })

  if (ack.torrentVersion) {
    state.roomPlaybackState = { seq: state.lastRemoteSeq + 1, playing: false, time: 0, updatedAt: Date.now(), reason: 'torrent:set' }
    await window.torrgether.socketEmitAck('torrent:ready', {
      version: ack.torrentVersion,
      infoHash: localLoad.torrent.infoHash,
      selectedFileIndex: localLoad.torrent.selectedFileIndex
    })
  }

  logT('log.torrentSent')
  await autoLaunchMpv('host torrent set')
}

async function emitHostControl(reason, override = {}) {
  if (!state.isHost || state.suppressHostPoll || !state.currentTorrent) return

  const active = await getActivePlayback()
  const playing = typeof override.playing === 'boolean' ? override.playing : active.playing
  const time = Number.isFinite(Number(override.time)) ? Number(override.time) : active.time

  const ack = await window.torrgether.socketEmitAck('control:set', {
    playing,
    time,
    reason
  })

  if (!ack.ok) {
    logT('log.controlFailed', { error: ack.error })
    return
  }

  const confirmed = ack.state || { playing, time, updatedAt: Date.now() }
  state.lastHostBroadcast = {
    playing: Boolean(confirmed.playing),
    time: Number(confirmed.time) || time,
    at: Date.now()
  }
}

async function controlMpvRelative(delta) {
  if (!isMpvConnected()) return logT('log.mpvNotRunning')
  const statusResult = await pollExternalPlayerStatus()
  if (!statusResult.ok) return log(statusResult.error)
  const nextTime = Math.max(0, (Number(statusResult.status.timePos) || 0) + delta)
  const result = await window.torrgether.controlExternalPlayer({
    time: nextTime,
    playing: !statusResult.status.pause,
    seek: true
  })
  if (!result.ok) return log(result.error)
  state.externalStatus = result.status
  if (state.isHost) await emitHostControl('mpv:seek', { playing: !result.status.pause, time: result.status.timePos })
}

async function toggleMpv() {
  if (!isMpvConnected()) return logT('log.mpvNotRunning')
  const statusResult = await pollExternalPlayerStatus()
  if (!statusResult.ok) return log(statusResult.error)
  const nextPlaying = Boolean(statusResult.status.pause)
  const result = await window.torrgether.controlExternalPlayer({ playing: nextPlaying })
  if (!result.ok) return log(result.error)
  state.externalStatus = result.status
  if (state.isHost) await emitHostControl(nextPlaying ? 'mpv:play' : 'mpv:pause', {
    playing: nextPlaying,
    time: result.status.timePos
  })
}

function updateSourceTabs() {
  const showRutracker = state.sourceTab === 'rutracker'
  const showManual = state.sourceTab === 'manual'
  const showCatalog = state.sourceTab === 'catalog'
  els.catalogSourceTab?.classList.toggle('active', showCatalog)
  els.manualSourceTab?.classList.toggle('active', showManual)
  els.rutrackerSourceTab?.classList.toggle('active', showRutracker)
  els.catalogSourcePanel?.classList.toggle('hidden', !showCatalog)
  els.manualSourcePanel?.classList.toggle('hidden', !showManual)
  els.rutrackerPanel?.classList.toggle('hidden', !showRutracker)
  if (showRutracker && state.rutrackerVisible) scheduleRutrackerBoundsUpdate()
  if (!showRutracker && els.rutrackerPanel) hideRutrackerView()
}

function setSourceTab(tab) {
  state.sourceTab = tab === 'rutracker' ? 'rutracker' : tab === 'manual' ? 'manual' : 'catalog'
  updateSourceTabs()
}

function viewportBounds() {
  const rect = els.rutrackerViewport?.getBoundingClientRect()
  if (!rect || rect.width < RUTRACKER_BOUNDS_MIN_SIZE || rect.height < RUTRACKER_BOUNDS_MIN_SIZE) return null
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  }
}

function scheduleRutrackerBoundsUpdate() {
  if (!state.rutrackerVisible) return
  if (state.rutrackerBoundsRequest) return
  state.rutrackerBoundsRequest = requestAnimationFrame(async () => {
    state.rutrackerBoundsRequest = null
    const bounds = viewportBounds()
    if (bounds) await window.torrgether.setRutrackerBounds(bounds)
  })
}

async function showRutrackerView() {
  state.sourceTab = 'rutracker'
  state.rutrackerVisible = true
  updateSourceTabs()
  const result = await window.torrgether.showRutracker()
  if (!result.ok) {
    els.rutrackerStatus.textContent = t('rutracker.error', { error: result.error })
    return
  }
  els.rutrackerStatus.textContent = t('rutracker.ready')
  scheduleRutrackerBoundsUpdate()
}

async function hideRutrackerView() {
  if (!state.rutrackerVisible) return
  state.rutrackerVisible = false
  await window.torrgether.hideRutracker()
  els.rutrackerStatus.textContent = t('rutracker.hidden')
}

async function importFromRutracker(imported) {
  const payload = imported?.payload
  if (!payload) return
  logT('rutracker.importing')
  if (payload.kind === 'magnet') logT('rutracker.importedMagnet')
  if (payload.kind === 'torrent-file') logT('rutracker.importedTorrent')
  await hostSetTorrentPayload(payload)
}

els.languageSelect?.addEventListener('change', () => setLocale(els.languageSelect.value))
els.contentLanguageSelect?.addEventListener('change', () => setContentLanguage(els.contentLanguageSelect.value))
document.querySelectorAll('[data-i18n-value]').forEach(el => {
  el.addEventListener('input', () => { el.dataset.userEdited = 'true' })
})

els.joinBtn.addEventListener('click', joinRoom)
els.catalogSourceTab?.addEventListener('click', () => setSourceTab('catalog'))
els.manualSourceTab?.addEventListener('click', () => setSourceTab('manual'))
els.rutrackerSourceTab?.addEventListener('click', () => showRutrackerView())
els.themeToggleBtn?.addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'))
document.querySelectorAll('[data-media-filter]').forEach(button => {
  button.classList.toggle('active', button.dataset.mediaFilter === state.mediaType)
  button.addEventListener('click', () => setMediaType(button.dataset.mediaFilter))
})
document.querySelectorAll('[data-panel-tab]').forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.panelTab
    document.querySelectorAll('[data-panel-tab]').forEach(item => item.classList.toggle('active', item === button))
    document.getElementById('rightTorrentsPanel')?.classList.toggle('hidden', target !== 'torrents')
    document.getElementById('rightInfoPanel')?.classList.toggle('hidden', target !== 'info')
  })
})
els.sourceSearchBtn?.addEventListener('click', () => scheduleSearchCatalog(0))
els.sourceSearchInput?.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault()
    scheduleSearchCatalog(0)
  }
})
els.detailImportBtn?.addEventListener('click', () => importSelectedSource())
els.detailFavoriteBtn?.addEventListener('click', () => {
  if (!state.selectedSourceResult) return
  const key = `torrgether.favorite.${state.selectedSourceResult.id}`
  const next = localStorage.getItem(key) !== '1'
  localStorage.setItem(key, next ? '1' : '0')
  els.detailFavoriteBtn.classList.toggle('active', next)
})
els.updateActionBtn?.addEventListener('click', () => {
  if (state.updateReleaseUrl) window.torrgether.openReleasePage(state.updateReleaseUrl)
})
els.updateDismissBtn?.addEventListener('click', () => els.updateBanner?.classList.add('hidden'))
els.rutrackerOpenBtn.addEventListener('click', showRutrackerView)
els.rutrackerCloseBtn.addEventListener('click', hideRutrackerView)
els.rutrackerBackBtn.addEventListener('click', () => window.torrgether.rutrackerBack())
els.rutrackerForwardBtn.addEventListener('click', () => window.torrgether.rutrackerForward())
els.rutrackerReloadBtn.addEventListener('click', () => window.torrgether.rutrackerReload())

els.chooseTorrentBtn.addEventListener('click', async () => {
  await withButtonBusy(els.chooseTorrentBtn, 'buttons.choosing', async () => {
    let result
    try {
      result = await window.torrgether.openTorrentDialog()
    } catch (err) {
      logT('log.openTorrentFailed', { error: err.message || err })
      return
    }
    if (!result || result.canceled) return
    await hostSetTorrentPayload(result.payload)
  })
})

els.setMagnetBtn.addEventListener('click', async () => {
  await withButtonBusy(els.setMagnetBtn, 'buttons.loading', async () => {
    const magnetURI = els.magnetInput.value.trim()
    if (!isValidMagnetURI(magnetURI)) return logT('log.validMagnet')
    await hostSetTorrentPayload({ kind: 'magnet', name: 'magnet', magnetURI })
  })
})

els.fileSelect.addEventListener('change', async () => {
  if (!state.isHost) return
  els.fileSelect.disabled = true
  state.mpvActive = false
  state.lastExternalPoll = null
  const selectedFileIndex = Number(els.fileSelect.value)
  if (!Number.isInteger(selectedFileIndex) || selectedFileIndex < 0) {
    logT('log.invalidFileIndex')
    updateActionState()
    return
  }

  const local = await window.torrgether.selectTorrentFile(selectedFileIndex)
  if (!local.ok) {
    log(local.error)
    updateActionState()
    return
  }
  state.currentTorrent = {
    ...state.currentTorrent,
    selectedFileIndex,
    selectedFileName: local.selectedFileName,
    selectedFileExt: local.selectedFileExt,
    streamURL: local.streamURL
  }
  updateVideoInfo()

  const ack = await window.torrgether.socketEmitAck('torrent:file-selected', { selectedFileIndex })
  if (!ack.ok) return log(ack.error)
  if (ack.torrentVersion) {
    state.roomPlaybackState = { seq: state.lastRemoteSeq + 1, playing: false, time: 0, updatedAt: Date.now(), reason: 'torrent:file-selected' }
    await window.torrgether.socketEmitAck('torrent:ready', {
      version: ack.torrentVersion,
      infoHash: state.currentTorrent.infoHash,
      selectedFileIndex
    })
  }
  await autoLaunchMpv('file selected')
  updateActionState()
})

els.openMpvBtn.addEventListener('click', () => withButtonBusy(els.openMpvBtn, 'buttons.opening', () => launchMpv('manual restart')))
els.mpvToggleBtn.addEventListener('click', toggleMpv)
els.mpvBackBtn.addEventListener('click', () => controlMpvRelative(-10))
els.mpvForwardBtn.addEventListener('click', () => controlMpvRelative(10))
els.showMpvLogsBtn.addEventListener('click', refreshMpvLogs)
els.openLogsFolderBtn?.addEventListener('click', async () => {
  const result = await window.torrgether.openLogsFolder()
  if (!result.ok) logT('log.openLogsFailed', { error: result.error })
})

els.mpvStopBtn.addEventListener('click', async () => {
  await withButtonBusy(els.mpvStopBtn, 'buttons.stopping', async () => {
    await window.torrgether.stopExternalPlayer()
    state.mpvActive = false
    state.lastExternalPoll = null
    state.externalStatus = null
    els.mpvStatus.textContent = t('mpv.stopped')
  })
})

window.addEventListener('resize', scheduleRutrackerBoundsUpdate)
window.addEventListener('scroll', scheduleRutrackerBoundsUpdate, true)
if (window.ResizeObserver && els.rutrackerViewport) {
  new ResizeObserver(scheduleRutrackerBoundsUpdate).observe(els.rutrackerViewport)
}

registerInterval(async () => {
  if (!state.isHost || !state.currentTorrent || !window.torrgether.socketConnected()) return
  if (state.heartbeatInFlight) return
  state.heartbeatInFlight = true
  try {
    const active = await getActivePlayback()
    window.torrgether.socketEmit('host:heartbeat', {
      playing: active.playing,
      time: active.time
    })
    state.lastHostBroadcast = { playing: active.playing, time: active.time, at: Date.now() }
  } catch (err) {
    logT('log.heartbeatFailed', { error: err.message || err })
  } finally {
    state.heartbeatInFlight = false
  }
}, 2000)

registerInterval(async () => {
  if (state.torrentStatusInFlight) return
  state.torrentStatusInFlight = true
  try {
    const status = await window.torrgether.torrentStatus()
    if (!status.ok) return

    const progress = (Number(status.selectedFileProgress) || 0) * 100
    const ramBytes = Number(status.ramBytes ?? status.memoryBytes ?? 0)
    const ramMaxBytes = Number(status.ramMaxBytes ?? status.memoryMaxBytes ?? 0)
    const ramPercent = ramMaxBytes ? (ramBytes / ramMaxBytes) * 100 : 0
    const mpvCacheSeconds = Number(status.mpvCacheSeconds)
    const pressureKey = ramPercent >= 90 ? 'stream.pressureHigh' : ramPercent >= 70 ? 'stream.pressureWatch' : 'stream.pressureLow'

    els.peerStatus.textContent = t('stream.peerCount', { count: status.numPeers })
    if (els.speedStatus) {
      els.speedStatus.textContent = t('stream.speedText', {
        down: prettySpeed(status.downloadSpeed),
        up: prettySpeed(status.uploadSpeed)
      })
    }
    if (els.progressPercent) els.progressPercent.textContent = `${progress.toFixed(2)}%`
    setBar(els.progressBar, progress)
    setBar(els.ramBar, ramPercent)

    const mpvText = status.mpvCacheText || t('stream.mpvCacheEmpty')
    const overLimitText = Number(status.ramOverLimitBytes || 0) > 0 ? t('stream.overLimit', { over: mib(status.ramOverLimitBytes) }) : ''
    const lowCache = Number(status.lowCacheEvents || 0) > 0 && Number.isFinite(mpvCacheSeconds) && mpvCacheSeconds < 1
    const cacheText = t('stream.cacheSummary', {
      used: mib(ramBytes),
      max: mib(ramMaxBytes),
      chunks: status.ramChunks ?? 'n/a',
      recent: status.ramRecentEvictions ?? 0,
      piece: mib(status.pieceLength),
      mpv: mpvText
    })
    if (els.ramShortStatus) els.ramShortStatus.textContent = `${ramPercent.toFixed(0)}%`
    if (els.cachePressureStatus) els.cachePressureStatus.textContent = lowCache ? t('stream.starved') : t(pressureKey)
    if (els.evictionStatus) els.evictionStatus.textContent = String(status.ramEvictions ?? 0)
    if (els.refetchStatus) els.refetchStatus.textContent = String(status.ramRecoveries ?? 0)
    if (els.pendingStatus) els.pendingStatus.textContent = `${status.ramPendingReads ?? 0}/${status.ramMaxPendingReads ?? 'n/a'}`
    els.bufferStatus.textContent = `${progress.toFixed(2)}%, ${cacheText}${overLimitText}${lowCache ? t('stream.lowMpvBuffer') : ''}`
  } catch (err) {
    logT('log.statusFailed', { error: err.message || err })
  } finally {
    state.torrentStatusInFlight = false
  }
}, 1000)

registerInterval(async () => {
  if (!state.mpvActive && !state.externalStatus?.running && !state.externalStatus?.connected) return
  if (state.externalStatusIntervalInFlight) return
  state.externalStatusIntervalInFlight = true
  try {
    const result = await pollExternalPlayerStatus()
    if (!result.ok) {
      els.mpvStatus.textContent = result.error
      if (result.status?.recentLogs) renderMpvLogs({ lines: result.status.recentLogs, logPath: result.status.logPath })
      return
    }

    const st = result.status
    state.externalStatus = st
    const mpvCacheSuffix = Number.isFinite(Number(st.cacheSeconds)) ? `, cache ${Number(st.cacheSeconds).toFixed(1)}s` : ''
    els.mpvStatus.textContent = st.connected
      ? `${st.pause ? t('mpv.paused') : t('mpv.playing')}, ${Number(st.timePos || 0).toFixed(1)}s${mpvCacheSuffix}`
      : st.running ? t('mpv.starting') : t('mpv.notRunning')
    els.timeStatus.textContent = Number(st.timePos || 0).toFixed(1)

    if (!st.connected && !st.running) {
      state.mpvActive = false
      if (st.lastError) {
        logT('log.mpvStopped', { error: st.lastError })
        if (result.status?.recentLogs) renderMpvLogs({ lines: result.status.recentLogs, logPath: result.status.logPath })
      }
      updateActionState()
      return
    }

    updateActionState()

    if (state.isHost && !state.suppressHostPoll && st.connected) {
      const playing = !st.pause
      const time = Number(st.timePos) || 0
      const now = Date.now()
      const previousPoll = state.lastExternalPoll
      state.lastExternalPoll = { playing, time, at: now }

      const expected = state.lastHostBroadcast.playing
        ? state.lastHostBroadcast.time + Math.max(0, now - state.lastHostBroadcast.at) / 1000
        : state.lastHostBroadcast.time

      const changedPause = playing !== state.lastHostBroadcast.playing
      const bigJumpFromExpected = Math.abs(time - expected) > 3.0
      const bigJumpFromPreviousPoll = previousPoll ? Math.abs(time - previousPoll.time) > 2.0 : true
      const changedTimeBySeek = bigJumpFromExpected && bigJumpFromPreviousPoll

      if (changedPause || changedTimeBySeek) {
        await emitHostControl(changedPause ? 'mpv:state' : 'mpv:seek-detected', { playing, time })
      }
    }
  } catch (err) {
    logT('log.mpvStatusFailed', { error: err.message || err })
  } finally {
    state.externalStatusIntervalInFlight = false
  }
}, 700)

window.torrgether.onTorrentError(payload => logT('log.torrentWarning', { message: payload.message }))
window.torrgether.onPlayerLog(payload => renderMpvLogs(payload))
window.torrgether.onRutrackerImport(importFromRutracker)
window.torrgether.onRutrackerStatus(payload => {
  if (!payload?.ok) els.rutrackerStatus.textContent = t('rutracker.error', { error: payload?.error || 'unknown' })
})

setLocale(state.locale)
if (els.contentLanguageSelect) els.contentLanguageSelect.value = state.contentLanguage
applyClientConfig().then(() => updateVideoInfo())
scheduleSearchCatalog(0)
checkForUpdates({ quiet: true }).catch(() => {})
updateActionState()
