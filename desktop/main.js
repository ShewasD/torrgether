import { app, BrowserWindow, WebContentsView, dialog, ipcMain, session, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'
import os from 'os'
import net from 'net'
import { randomBytes } from 'crypto'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import WebTorrent from 'webtorrent'
import LruMemoryChunkStore from './LruMemoryChunkStore.js'
import { parseMpvStdoutStatus } from './mpvOutput.js'
import { getMpvCandidates } from './mpvPaths.js'
import { shouldDisableHardwareAcceleration } from './gpuPolicy.js'
import { waitForReady } from './streamServerReady.js'
import { fetchSourceTorrent, searchSources } from './sourceProviders.js'
import { checkForUpdates, DEFAULT_UPDATE_REPO } from './updateCheck.js'
import { createLogger, redactForLog } from '../shared/logger.js'
import { startSignalingServer } from '../server/server.js'
import {
  RUTRACKER_HOME_URL,
  RUTRACKER_PARTITION,
  importNameForTorrent,
  isMagnetUrl,
  isRutrackerTopLevelUrl,
  isTorrentDownload,
  validateTorrentDownloadSize
} from './rutracker.js'

// Electron/Chromium on Linux often prints VA-API/libva GPU warnings.
// Keep Windows/macOS GPU decoding by default, while allowing an env override.
if (shouldDisableHardwareAcceleration()) app.disableHardwareAcceleration()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const execFileAsync = promisify(execFile)
const appLogger = createLogger({
  name: 'desktop',
  fileName: 'desktop.log',
  level: process.env.LOG_LEVEL,
  ...(process.env.LOG_DIR ? { logDir: process.env.LOG_DIR } : {})
})
const mpvLogger = createLogger({
  name: 'mpv',
  fileName: 'mpv.log',
  level: process.env.LOG_LEVEL,
  ...(process.env.LOG_DIR ? { logDir: process.env.LOG_DIR } : {})
})

let win
let client
let serverInstance
let currentTorrent = null
let selectedFile = null
let streamServerReady = false
let streamServerPort = null
let streamServerReadyPromise = null
let streamServerError = null
let embeddedSignalingServer = null
let embeddedServerInfo = null
let shutdownStarted = false
let rutrackerView = null
let rutrackerSession = null
let rutrackerVisible = false
let rutrackerBounds = null
let sourceResultCache = new Map()

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.avi', '.ogv'])
const MAX_TORRENT_FILE_BYTES = Number(process.env.MAX_TORRENT_FILE_BYTES || 10 * 1024 * 1024)
const MAX_MEMORY_CHUNKS = Number(process.env.MAX_MEMORY_CHUNKS || 384)
const MAX_MEMORY_MB = Number(process.env.MAX_MEMORY_MB || 512)
const MAX_MEMORY_BYTES = Number(process.env.MAX_MEMORY_BYTES || MAX_MEMORY_MB * 1024 * 1024)
const DEFAULT_MPV_DEMUXER_MAX_BYTES = `${Math.max(32, Math.min(256, Math.floor(MAX_MEMORY_MB / 2)))}MiB`
const MPV_DEMUXER_MAX_BYTES = process.env.MPV_DEMUXER_MAX_BYTES || DEFAULT_MPV_DEMUXER_MAX_BYTES
const MPV_DEMUXER_MAX_BACK_BYTES = process.env.MPV_DEMUXER_MAX_BACK_BYTES || '64MiB'
const MPV_CACHE_SECS = process.env.MPV_CACHE_SECS || '60'
const MPV_CACHE_PAUSE_WAIT = process.env.MPV_CACHE_PAUSE_WAIT || '20'
const MPV_NETWORK_TIMEOUT = process.env.MPV_NETWORK_TIMEOUT || '120'
const RAM_STORE_GET_TIMEOUT_MS = Number(process.env.RAM_STORE_GET_TIMEOUT_MS || 45_000)
const MAX_PENDING_RAM_READS = Number(process.env.MAX_PENDING_RAM_READS || 256)
const STREAM_SERVER_READY_TIMEOUT_MS = Number(process.env.STREAM_SERVER_READY_TIMEOUT_MS || 8000)
const TORRGETHER_STORAGE_MODE = 'ram'
const WEBTORRENT_STORE_CACHE_SLOTS = 0
const MPV_IPC_ATTEMPTS = Number(process.env.MPV_IPC_ATTEMPTS || 100)
const MPV_IPC_RETRY_MS = Number(process.env.MPV_IPC_RETRY_MS || 100)
const PLAYER_LOG_MAX_LINES = 400
const HEALTH_SNAPSHOT_INTERVAL_MS = Number(process.env.HEALTH_SNAPSHOT_INTERVAL_MS || 30_000)
const UPDATE_REPO = process.env.UPDATE_REPO || DEFAULT_UPDATE_REPO
const UPDATE_CHECK_INTERVAL_MS = Number(process.env.UPDATE_CHECK_INTERVAL_MS || 6 * 60 * 60 * 1000)
const DISABLE_UPDATE_CHECK = ['1', 'true', 'yes'].includes(String(process.env.DISABLE_UPDATE_CHECK || '').toLowerCase())
let playerLogLines = []
let mpvPreflight = null
let healthSnapshotTimer = null

const externalPlayer = {
  process: null,
  ipcPath: null,
  socket: null,
  buffer: '',
  pending: new Map(),
  requestId: 1,
  lastStdout: '',
  lastStderr: '',
  status: {
    running: false,
    connected: false,
    path: null,
    pause: true,
    timePos: 0,
    duration: null,
    filename: null,
    lastError: null,
    cacheSeconds: null,
    cacheBytes: null,
    cacheText: null,
    lowCacheEvents: 0
  }
}


function nowIso() {
  return new Date().toISOString()
}

function getPlayerLogPath() {
  return mpvLogger.filePath
}

function redactEnvPath(value) {
  if (!value) return ''
  return String(value).split(path.delimiter).slice(0, 8).join(path.delimiter)
}

function playerLog(message, data = undefined) {
  const safeData = data === undefined ? undefined : redactForLog(data)
  let line = `[${nowIso()}] ${message}`
  if (safeData !== undefined) {
    try {
      line += ` ${JSON.stringify(safeData, null, 2)}`
    } catch {
      line += ` ${String(safeData)}`
    }
  }

  playerLogLines.push(line)
  if (playerLogLines.length > PLAYER_LOG_MAX_LINES) playerLogLines = playerLogLines.slice(-PLAYER_LOG_MAX_LINES)
  mpvLogger.info(message, data)

  try {
    sendToRenderer('player:log', { line, lines: playerLogLines.slice(-120), logPath: getPlayerLogPath() })
  } catch {}
}

async function detectMpv() {
  const candidates = getMpvCandidates({
    appDir: __dirname,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath
  })

  const seen = new Set()
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ['--version'], { timeout: 4000 })
      return {
        ok: true,
        binary: candidate,
        version: `${stdout || stderr}`.split('\n').filter(Boolean).slice(0, 3).join(' | '),
        candidates
      }
    } catch (err) {
      playerLog('MPV candidate failed', {
        candidate,
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        message: err.message
      })
    }
  }

  return { ok: false, binary: candidates[0] || 'mpv', version: null, candidates }
}

async function refreshMpvPreflight() {
  mpvPreflight = await detectMpv()
  if (mpvPreflight.ok) {
    playerLog('MPV preflight passed', {
      binary: mpvPreflight.binary,
      version: mpvPreflight.version
    })
  } else {
    const message = `MPV is required but was not found. Rerun the Torrgether installer or install mpv and add it to PATH. Checked ${mpvPreflight.candidates.length} locations.`
    resetExternalStatus(message)
    playerLog('MPV preflight failed', mpvPreflight)
  }
  return mpvPreflight
}

function ensureHealthSnapshotTimer() {
  if (healthSnapshotTimer) return
  healthSnapshotTimer = setInterval(() => {
    if (!currentTorrent && !externalPlayer.status.running && !externalPlayer.status.connected) return
    appLogger.info('Runtime health snapshot', getRuntimeHealthSnapshot())
  }, HEALTH_SNAPSHOT_INTERVAL_MS)
  healthSnapshotTimer.unref?.()
}

function tailText(text, max = 2000) {
  const clean = String(text || '').trim()
  return clean.length > max ? clean.slice(-max) : clean
}

function createClient() {
  client = new WebTorrent({ maxConns: 80 })
  client.on('error', err => {
    appLogger.error('WebTorrent client error', err)
    sendToRenderer('torrent:error', { message: err.message })
  })
  client.on('warning', err => {
    appLogger.warn('WebTorrent client warning', err)
    sendToRenderer('torrent:error', { message: err.message })
  })

  serverInstance = client.createServer({ origin: '*' }, 'node')
  streamServerReady = false
  streamServerPort = null
  streamServerError = null

  streamServerReadyPromise = new Promise((resolve, reject) => {
    const streamServer = serverInstance.server
    const failStartup = err => {
      streamServerError = err
      appLogger.error('Local WebTorrent HTTP stream server failed to start', err)
      sendToRenderer('torrent:error', { message: `Local stream server failed to start: ${err.message}` })
      reject(err)
    }

    streamServer.once('error', failStartup)
    try {
      streamServer.listen(0, '127.0.0.1', () => {
        streamServer.off('error', failStartup)
        streamServerReady = true
        const address = streamServer.address()
        streamServerPort = typeof address === 'object' && address ? address.port : null
        streamServer.on('error', err => {
          streamServerError = err
          appLogger.error('Local WebTorrent HTTP stream server error', err)
          sendToRenderer('torrent:error', { message: `Local stream server error: ${err.message}` })
        })
        appLogger.info('Local WebTorrent HTTP stream server started', {
          host: '127.0.0.1',
          port: streamServerPort,
          note: 'Media stream remains local to this device and is not exposed publicly.'
        })
        resolve()
      })
    } catch (err) {
      streamServer.off('error', failStartup)
      failStartup(err)
    }
  })
  streamServerReadyPromise.catch(() => {})
}

function hasExternalServerConfig() {
  return Boolean(String(process.env.SERVER_URL || '').trim())
}

async function configureSignalingServer() {
  if (hasExternalServerConfig()) {
    embeddedServerInfo = {
      embedded: false,
      serverUrl: process.env.SERVER_URL,
      serverToken: process.env.SERVER_TOKEN || ''
    }
    return
  }

  const serverToken = process.env.SERVER_TOKEN || randomBytes(32).toString('hex')
  embeddedSignalingServer = await startSignalingServer({
    host: '127.0.0.1',
    port: 0,
    serverToken,
    corsOrigin: '*',
    logDir: process.env.LOG_DIR || appLogger.dir,
    logLevel: process.env.LOG_LEVEL
  })

  embeddedServerInfo = {
    embedded: true,
    serverUrl: `http://127.0.0.1:${embeddedSignalingServer.config.port}`,
    serverToken
  }

  appLogger.info('Embedded signaling server ready', {
    serverUrl: embeddedServerInfo.serverUrl,
    tokenConfigured: Boolean(serverToken)
  })
}

async function closeWebTorrentStreamServer() {
  const streamServer = serverInstance?.server
  if (!streamServer?.listening) return

  await new Promise(resolve => {
    streamServer.close(err => {
      if (err) appLogger.warn('Local WebTorrent HTTP stream server close warning', err)
      resolve()
    })
  })
}

async function destroyWebTorrentClient() {
  if (!client) return
  await new Promise(resolve => {
    try {
      client.destroy(err => {
        if (err) appLogger.warn('WebTorrent client destroy warning', err)
        resolve()
      })
    } catch (err) {
      appLogger.warn('WebTorrent client destroy threw', err)
      resolve()
    }
  })
  client = null
  serverInstance = null
  currentTorrent = null
  selectedFile = null
}

async function shutdownResources() {
  if (healthSnapshotTimer) clearInterval(healthSnapshotTimer)
  healthSnapshotTimer = null
  destroyRutrackerView()
  await stopExternalPlayer().catch(err => appLogger.warn('MPV shutdown warning', err))
  await closeWebTorrentStreamServer().catch(err => appLogger.warn('Stream server shutdown warning', err))
  await destroyWebTorrentClient().catch(err => appLogger.warn('WebTorrent shutdown warning', err))
  await embeddedSignalingServer?.close?.().catch(err => appLogger.warn('Embedded server shutdown warning', err))
  embeddedSignalingServer = null
  await Promise.allSettled([
    appLogger.close?.(),
    mpvLogger.close?.()
  ])
}

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function sendRutrackerImport(payload) {
  sendToRenderer('rutracker:import', payload)
}

async function cookieHeaderForUrl(url) {
  const cookies = await getRutrackerSession().cookies.get({ url })
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

async function fetchTorrentToMemory(url, maxBytes = MAX_TORRENT_FILE_BYTES) {
  const cookie = await cookieHeaderForUrl(url)
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Torrgether torrent importer',
      ...(cookie ? { Cookie: cookie } : {})
    }
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const length = Number(response.headers?.get?.('content-length'))
  if (!validateTorrentDownloadSize(length, maxBytes)) {
    throw new Error(`.torrent file is too large. Limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MiB.`)
  }

  const chunks = []
  let received = 0
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      received += chunk.length
      if (!validateTorrentDownloadSize(received, maxBytes)) {
        try { await reader.cancel() } catch {}
        throw new Error(`.torrent download exceeded ${(maxBytes / 1024 / 1024).toFixed(0)} MiB.`)
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!validateTorrentDownloadSize(buffer.length, maxBytes)) {
    throw new Error(`.torrent download exceeded ${(maxBytes / 1024 / 1024).toFixed(0)} MiB.`)
  }
  return buffer
}

function importRutrackerMagnet(magnetURI) {
  sendRutrackerImport({
    kind: 'magnet',
    payload: {
      kind: 'magnet',
      name: 'RuTracker magnet',
      magnetURI
    }
  })
}

function getRutrackerSession() {
  if (rutrackerSession) return rutrackerSession

  rutrackerSession = session.fromPartition(RUTRACKER_PARTITION, { cache: true })
  rutrackerSession.on('will-download', handleRutrackerDownload)
  return rutrackerSession
}

function handleRutrackerNavigation(url) {
  if (isMagnetUrl(url)) {
    importRutrackerMagnet(url)
    return { allow: false }
  }

  if (isRutrackerTopLevelUrl(url)) return { allow: true }

  shell.openExternal(url).catch(err => appLogger.warn('Failed to open external URL from RuTracker view', { url, message: err.message }))
  return { allow: false }
}

function handleRutrackerDownload(event, item) {
  const url = item.getURL?.() || ''
  const filename = item.getFilename?.() || ''
  const mimeType = item.getMimeType?.() || ''

  if (!isTorrentDownload({ url, filename, mimeType })) return
  event.preventDefault()

  const totalBytes = item.getTotalBytes?.()
  if (!validateTorrentDownloadSize(totalBytes, MAX_TORRENT_FILE_BYTES)) {
    sendToRenderer('torrent:error', { message: `.torrent file is too large. Limit is ${(MAX_TORRENT_FILE_BYTES / 1024 / 1024).toFixed(0)} MiB.` })
    return
  }

  const importName = importNameForTorrent({ filename, url })
  queueMicrotask(async () => {
    try {
      const buffer = await fetchTorrentToMemory(url)
      sendRutrackerImport({
        kind: 'torrent-file',
        payload: {
          kind: 'torrent-file',
          name: importName,
          base64: buffer.toString('base64')
        }
      })
    } catch (err) {
      sendToRenderer('torrent:error', { message: `Could not import RuTracker torrent: ${err.message}` })
    }
  })
}

function ensureRutrackerView() {
  if (!win || win.isDestroyed()) throw new Error('Main window is not ready')
  if (rutrackerView) return rutrackerView

  getRutrackerSession()
  rutrackerView = new WebContentsView({
    webPreferences: {
      partition: RUTRACKER_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  rutrackerView.setVisible(false)
  win.contentView.addChildView(rutrackerView)

  const contents = rutrackerView.webContents
  contents.setWindowOpenHandler(details => {
    const decision = handleRutrackerNavigation(details.url)
    if (decision.allow) contents.loadURL(details.url).catch(err => appLogger.warn('RuTracker popup navigation failed', { url: details.url, message: err.message }))
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const decision = handleRutrackerNavigation(url)
    if (!decision.allow) event.preventDefault()
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    sendToRenderer('rutracker:status', { ok: false, url: validatedURL, error: errorDescription })
  })
  contents.on('did-navigate', (_event, url) => {
    sendToRenderer('rutracker:status', { ok: true, url })
  })

  contents.loadURL(RUTRACKER_HOME_URL).catch(err => {
    sendToRenderer('rutracker:status', { ok: false, url: RUTRACKER_HOME_URL, error: err.message })
  })

  return rutrackerView
}

function normalizeRutrackerBounds(bounds) {
  const clean = {
    x: Math.max(0, Math.round(Number(bounds?.x) || 0)),
    y: Math.max(0, Math.round(Number(bounds?.y) || 0)),
    width: Math.max(0, Math.round(Number(bounds?.width) || 0)),
    height: Math.max(0, Math.round(Number(bounds?.height) || 0))
  }
  if (clean.width < 24 || clean.height < 24) return null
  return clean
}

function applyRutrackerBounds() {
  if (!rutrackerView) return
  if (!rutrackerVisible || !rutrackerBounds) {
    rutrackerView.setVisible(false)
    return
  }
  rutrackerView.setBounds(rutrackerBounds)
  rutrackerView.setVisible(true)
}

function destroyRutrackerView() {
  if (!rutrackerView) return
  try { win?.contentView?.removeChildView?.(rutrackerView) } catch {}
  try { rutrackerView.webContents?.close?.() } catch {}
  try { rutrackerView.webContents?.destroy?.() } catch {}
  rutrackerView = null
  rutrackerVisible = false
  rutrackerBounds = null
}

function getRuntimeHealthSnapshot() {
  const ramStore = getCurrentRamStore()
  const address = serverInstance?.server?.address?.()
  return {
    ts: nowIso(),
    uptimeSeconds: Math.round(process.uptime()),
    platform: process.platform,
    arch: process.arch,
    memory: process.memoryUsage(),
    streamServer: {
      ready: streamServerReady,
      port: streamServerPort || (typeof address === 'object' && address ? address.port : null),
      error: streamServerError ? { message: streamServerError.message, code: streamServerError.code } : null
    },
    signalingServer: {
      embedded: Boolean(embeddedServerInfo?.embedded),
      url: embeddedServerInfo?.serverUrl || process.env.SERVER_URL || null,
      running: Boolean(embeddedSignalingServer?.httpServer?.listening)
    },
    torrent: currentTorrent ? {
      infoHash: currentTorrent.infoHash,
      name: currentTorrent.name,
      numPeers: currentTorrent.numPeers,
      progress: currentTorrent.progress,
      downloadSpeed: currentTorrent.downloadSpeed,
      uploadSpeed: currentTorrent.uploadSpeed,
      selectedFileName: selectedFile?.name || null,
      ram: ramStore?.getStats?.() || null
    } : null,
    mpv: {
      ...externalPlayer.status,
      pendingRequests: externalPlayer.pending.size
    }
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    title: 'Torrgether',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      sandbox: false
    }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    appLogger.error('Renderer process gone', { details, health: getRuntimeHealthSnapshot() })
  })

  win.webContents.on('unresponsive', () => {
    appLogger.warn('Renderer became unresponsive', getRuntimeHealthSnapshot())
  })

  win.webContents.on('responsive', () => {
    appLogger.info('Renderer became responsive again', getRuntimeHealthSnapshot())
  })

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

function waitForStreamServer() {
  return waitForReady({
    isReady: () => streamServerReady,
    getError: () => streamServerError,
    readyPromise: streamServerReadyPromise,
    timeoutMs: STREAM_SERVER_READY_TIMEOUT_MS
  })
}

function getLocalStreamURL(file) {
  if (!file?.streamURL) throw new Error('Selected file does not have streamURL yet')
  const raw = String(file.streamURL)
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  const address = serverInstance?.server?.address?.()
  const port = streamServerPort || (typeof address === 'object' && address ? address.port : null)
  if (!port) throw new Error('Local WebTorrent HTTP stream server is not listening yet')

  // WebTorrent v2 may expose file.streamURL as a server-relative path like
  // /webtorrent/<infoHash>/<file>. MPV treats strings that start with `/` as
  // local filesystem paths, so always hand external players a full HTTP URL.
  // Also normalize protocol-relative or slash-heavy values defensively.
  const cleanPath = raw.startsWith('/') ? `/${raw.replace(/^\/+/, '')}` : `/${raw}`
  return new URL(cleanPath, `http://127.0.0.1:${port}`).toString()
}

function torrentIdFromPayload(payload) {
  if (payload.kind === 'magnet') return payload.magnetURI
  if (payload.kind === 'torrent-file') return Buffer.from(payload.base64, 'base64')
  throw new Error('Unsupported torrent payload')
}

function normalizeVideoFiles(torrent) {
  return torrent.files
    .map((file, index) => ({
      index,
      name: file.name,
      path: file.path,
      size: file.length,
      ext: path.extname(file.name).toLowerCase(),
      isVideo: VIDEO_EXTENSIONS.has(path.extname(file.name).toLowerCase()) || file.type?.startsWith('video/')
    }))
    .filter(file => file.isVideo)
    .sort((a, b) => b.size - a.size)
}

function removeTorrentAsync(torrent) {
  return new Promise(resolve => {
    if (!torrent) return resolve()
    const id = torrent.infoHash || torrent.magnetURI || torrent
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const timer = setTimeout(finish, 5000)
    try {
      client.remove(id, { destroyStore: true }, err => {
        clearTimeout(timer)
        if (err) playerLog('WebTorrent remove warning', { message: err.message, id })
        finish()
      })
    } catch (err) {
      clearTimeout(timer)
      playerLog('WebTorrent remove threw', { message: err.message, id })
      finish()
    }
  })
}

async function clearCurrentTorrent() {
  await stopExternalPlayer()
  selectedFile = null
  currentTorrent = null

  // Remove every torrent that WebTorrent still knows about, including half-added
  // torrents that failed before `currentTorrent` was assigned. WebTorrent indexes
  // by infoHash, so immediately adding the same torrent before removal completes
  // can otherwise throw "Cannot add duplicate torrent".
  const torrents = [...client.torrents]
  await Promise.allSettled(torrents.map(removeTorrentAsync))
}

async function loadTorrent(payload, preferredFileIndex = null) {
  await waitForStreamServer()
  await clearCurrentTorrent()

  const torrentId = torrentIdFromPayload(payload)

  return await new Promise((resolve, reject) => {
    let torrent
    try {
      const addOpts = {
        destroyStoreOnDestroy: true,
        deselect: true,
        addUID: false,
        strategy: 'sequential',
        store: LruMemoryChunkStore,
        storeOpts: {
          maxChunks: MAX_MEMORY_CHUNKS,
          maxBytes: MAX_MEMORY_BYTES,
          getTimeoutMs: RAM_STORE_GET_TIMEOUT_MS,
          maxPendingReads: MAX_PENDING_RAM_READS,
          onWarning: warning => appLogger.warn('RAM store memory pressure', warning)
        },
        storeCacheSlots: WEBTORRENT_STORE_CACHE_SLOTS,
        maxWebConns: Number(process.env.WEBTORRENT_MAX_WEB_CONNS || 8)
      }

      playerLog('Using coherent RAM-only WebTorrent store', {
        maxChunks: MAX_MEMORY_CHUNKS,
        maxBytes: MAX_MEMORY_BYTES,
        mpvDemuxerMaxBytes: MPV_DEMUXER_MAX_BYTES,
        getTimeoutMs: RAM_STORE_GET_TIMEOUT_MS,
        maxPendingReads: MAX_PENDING_RAM_READS,
        storeCacheSlots: WEBTORRENT_STORE_CACHE_SLOTS,
        strategy: addOpts.strategy
      })

      torrent = client.add(torrentId, addOpts)
    } catch (err) {
      sendToRenderer('torrent:error', { message: err.message })
      reject(err)
      return
    }

    let settled = false
    const fail = err => {
      if (settled) return
      settled = true
      sendToRenderer('torrent:error', { message: err.message })
      removeTorrentAsync(torrent).catch(() => {})
      reject(err)
    }

    torrent.once('error', fail)

    torrent.once('ready', () => {
      if (settled) return
      torrent.off('error', fail)
      currentTorrent = torrent

      const videoFiles = normalizeVideoFiles(torrent)
      if (videoFiles.length === 0) {
        fail(new Error('No playable video files were found in this torrent'))
        return
      }

      const preferred = videoFiles.find(file => file.index === preferredFileIndex)
      const chosen = preferred || videoFiles[0]
      selectedFile = torrent.files[chosen.index]

      torrent.files.forEach(file => file.deselect())
      // RAM-only mode lets the HTTP stream request exactly the pieces MPV needs.
      // Full-file prefetch is intentionally disabled so large files do not fill RAM.
      playerLog('Full selected-file prefetch disabled in RAM-only mode; HTTP stream will fetch on demand', { file: selectedFile.name })

      const result = {
        name: torrent.name,
        infoHash: torrent.infoHash,
        magnetURI: torrent.magnetURI,
        numPeers: torrent.numPeers,
        progress: torrent.progress,
        downloadSpeed: torrent.downloadSpeed,
        uploadSpeed: torrent.uploadSpeed,
        selectedFileIndex: chosen.index,
        selectedFileName: selectedFile.name,
        selectedFileExt: path.extname(selectedFile.name).toLowerCase(),
        streamURL: getLocalStreamURL(selectedFile),
        rawStreamURL: selectedFile.streamURL,
        storageMode: TORRGETHER_STORAGE_MODE,
        cachePath: null,
        files: videoFiles
      }

      settled = true
      resolve(result)
    })
  })
}

function makeMpvIpcPath() {
  const suffix = `${process.pid}-${Date.now()}`
  if (process.platform === 'win32') return `\\\\.\\pipe\\torrgether-mpv-${suffix}`
  return path.join(os.tmpdir(), `torrgether-mpv-${suffix}.sock`)
}

function resetExternalStatus(lastError = null) {
  externalPlayer.status = {
    running: false,
    connected: false,
    path: null,
    pause: true,
    timePos: 0,
    duration: null,
    filename: null,
    lastError,
    cacheSeconds: null,
    cacheBytes: null,
    cacheText: null,
    lowCacheEvents: 0
  }
}

function updateMpvCacheFromStdout(text) {
  const parsed = parseMpvStdoutStatus(text)
  if (parsed.cacheText) {
    externalPlayer.status.cacheSeconds = parsed.cacheSeconds
    externalPlayer.status.cacheBytes = parsed.cacheBytes
    externalPlayer.status.cacheText = parsed.cacheText
    if (Number.isFinite(parsed.cacheSeconds) && parsed.cacheSeconds < 0.5) externalPlayer.status.lowCacheEvents += 1
  }
  if (Number.isFinite(parsed.timePos)) {
    // JSON IPC time-pos is preferred, but stdout gives a useful fallback when
    // MPV exits before the next property-change event arrives.
    externalPlayer.status.timePos = parsed.timePos
  }
}

function handleMpvLine(line) {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }

  if (msg.request_id && externalPlayer.pending.has(msg.request_id)) {
    const { resolve, reject, timer } = externalPlayer.pending.get(msg.request_id)
    clearTimeout(timer)
    externalPlayer.pending.delete(msg.request_id)
    if (msg.error && msg.error !== 'success') reject(new Error(msg.error))
    else resolve(msg.data)
    return
  }

  if (msg.event === 'property-change') {
    if (msg.name === 'time-pos' || msg.name === 'playback-time') externalPlayer.status.timePos = Number(msg.data) || 0
    if (msg.name === 'pause') externalPlayer.status.pause = Boolean(msg.data)
    if (msg.name === 'duration') externalPlayer.status.duration = Number.isFinite(Number(msg.data)) ? Number(msg.data) : null
    if (msg.name === 'filename') externalPlayer.status.filename = msg.data || externalPlayer.status.filename
  }

  if (msg.event === 'end-file') {
    const time = Number(externalPlayer.status.timePos) || 0
    const duration = Number(externalPlayer.status.duration) || 0
    if (msg.reason === 'error' || msg.file_error) {
      externalPlayer.status.lastError = msg.file_error || msg.reason || 'MPV failed to load file'
      playerLog('MPV end-file error event', msg)
    } else if (msg.reason === 'eof' && duration > 0 && time < duration - 5) {
      externalPlayer.status.lastError = `MPV stream ended early at ${time.toFixed(1)}s / ${duration.toFixed(1)}s. Torrent data was not supplied fast enough or the HTTP stream ended prematurely.`
      playerLog('MPV premature EOF event', { ...msg, timePos: time, duration })
    }
    externalPlayer.status.running = false
    externalPlayer.status.connected = false
  }

  if (msg.event === 'shutdown') {
    externalPlayer.status.running = false
    externalPlayer.status.connected = false
  }
}

function mpvCommand(command, timeoutMs = 2500) {
  if (!externalPlayer.socket || externalPlayer.socket.destroyed || !externalPlayer.status.connected) {
    return Promise.reject(new Error('MPV IPC is not connected'))
  }

  const requestId = externalPlayer.requestId++
  const payload = JSON.stringify({ command, request_id: requestId }) + '\n'
  playerLog('MPV IPC ->', { command, requestId })

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      externalPlayer.pending.delete(requestId)
      reject(new Error('MPV IPC request timed out'))
    }, timeoutMs)

    externalPlayer.pending.set(requestId, { resolve, reject, timer })
    if (!externalPlayer.socket || externalPlayer.socket.destroyed || !externalPlayer.status.connected) {
      clearTimeout(timer)
      externalPlayer.pending.delete(requestId)
      reject(new Error('MPV IPC closed before command could be sent'))
      return
    }
    externalPlayer.socket.write(payload, err => {
      if (!err) return
      clearTimeout(timer)
      externalPlayer.pending.delete(requestId)
      reject(err)
    })
  })
}

function connectToMpvIpc(ipcPath, attempts = MPV_IPC_ATTEMPTS) {
  return new Promise((resolve, reject) => {
    let tries = 0
    let settled = false

    const tryConnect = () => {
      if (settled) return
      tries += 1
      playerLog('Trying to connect to MPV IPC', { ipcPath, try: tries, attempts })
      const socket = net.createConnection({ path: ipcPath })
      const onPreConnectError = err => {
        socket.destroy()
        if (tries >= attempts) {
          if (!settled) {
            settled = true
            playerLog('Failed to connect to MPV IPC after all attempts', { ipcPath, attempts, error: err.message, code: err.code })
            reject(err)
          }
        } else {
          setTimeout(tryConnect, MPV_IPC_RETRY_MS)
        }
      }

      socket.once('connect', () => {
        if (settled) return
        settled = true
        socket.off('error', onPreConnectError)
        playerLog('Connected to MPV IPC', { ipcPath, try: tries })
        externalPlayer.socket = socket
        externalPlayer.status.connected = true
        externalPlayer.status.path = ipcPath
        socket.setEncoding('utf8')

        socket.on('data', chunk => {
          externalPlayer.buffer += chunk
          const lines = externalPlayer.buffer.split('\n')
          externalPlayer.buffer = lines.pop() || ''
          for (const line of lines) {
            // time-pos changes arrive many times per second; handle them but do not
            // flood the memory log/UI with thousands of nearly identical entries.
            const isNoisyTimePos = line.includes('"event":"property-change"') && line.includes('"name":"time-pos"')
            if (!isNoisyTimePos) playerLog('MPV IPC <-', line.slice(0, 800))
            handleMpvLine(line)
          }
        })

        socket.on('close', hadError => {
          playerLog('MPV IPC socket closed', { hadError })
          externalPlayer.status.connected = false
        })

        socket.on('error', err => {
          playerLog('MPV IPC socket error', { message: err.message, code: err.code })
          externalPlayer.status.lastError = err.message
        })

        resolve(socket)
      })

      socket.once('error', onPreConnectError)
    }

    tryConnect()
  })
}

async function stopExternalPlayer(lastError = null) {
  playerLog('Stopping MPV if running', { pid: externalPlayer.process?.pid || null, connected: externalPlayer.status.connected })
  for (const { reject, timer } of externalPlayer.pending.values()) {
    clearTimeout(timer)
    reject(new Error('MPV was stopped'))
  }
  externalPlayer.pending.clear()

  try {
    if (externalPlayer.socket) {
      externalPlayer.socket.removeAllListeners()
      if (!externalPlayer.socket.destroyed) externalPlayer.socket.destroy()
    }
  } catch {}
  externalPlayer.socket = null
  externalPlayer.buffer = ''

  try {
    if (externalPlayer.process) {
      externalPlayer.process.stdout?.removeAllListeners('data')
      externalPlayer.process.stderr?.removeAllListeners('data')
      externalPlayer.process.removeAllListeners('error')
      externalPlayer.process.removeAllListeners('exit')
      if (!externalPlayer.process.killed) externalPlayer.process.kill()
    }
  } catch {}
  externalPlayer.process = null

  const oldIpcPath = externalPlayer.ipcPath
  externalPlayer.ipcPath = null
  if (oldIpcPath && process.platform !== 'win32') {
    try { await fs.rm(oldIpcPath, { force: true }) } catch {}
  }

  resetExternalStatus(lastError)
}

async function waitForMpvLoadSettled(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (externalPlayer.status.lastError) throw new Error(externalPlayer.status.lastError)
    if (!externalPlayer.status.running && !externalPlayer.status.connected) {
      throw new Error('MPV exited before playback became ready')
    }
    if (Number.isFinite(Number(externalPlayer.status.duration))) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

async function launchExternalPlayer({ startTime = 0, playing = false } = {}) {
  if (!selectedFile) throw new Error('No selected video file')
  await stopExternalPlayer()

  const ipcPath = makeMpvIpcPath()
  const detected = await refreshMpvPreflight()
  const mpvBinary = detected.binary
  if (!detected.ok) {
    const message = `MPV is required but was not found. Rerun the Torrgether installer, install mpv and add mpv.exe to PATH, or set MPV_PATH. Checked ${detected.candidates.length} locations.`
    resetExternalStatus(message)
    playerLog('MPV not found', detected)
    throw new Error(message)
  }

  externalPlayer.ipcPath = ipcPath
  externalPlayer.lastStdout = ''
  externalPlayer.lastStderr = ''
  externalPlayer.status.running = true
  externalPlayer.status.connected = false
  externalPlayer.status.filename = selectedFile.name
  externalPlayer.status.pause = !playing
  externalPlayer.status.timePos = Math.max(0, Number(startTime) || 0)
  externalPlayer.status.lastError = null

  const streamURL = getLocalStreamURL(selectedFile)

  const args = [
    '--no-config',
    '--force-window=yes',
    '--keep-open=no',
    '--cache=yes',
    '--cache-pause=yes',
    '--cache-pause-initial=yes',
    `--cache-pause-wait=${MPV_CACHE_PAUSE_WAIT}`,
    `--cache-secs=${MPV_CACHE_SECS}`,
    `--demuxer-readahead-secs=${MPV_CACHE_SECS}`,
    `--demuxer-max-bytes=${MPV_DEMUXER_MAX_BYTES}`,
    `--demuxer-max-back-bytes=${MPV_DEMUXER_MAX_BACK_BYTES}`,
    `--network-timeout=${MPV_NETWORK_TIMEOUT}`,
    '--force-seekable=yes',
    '--msg-level=all=v',
    `--input-ipc-server=${ipcPath}`,
    `--title=Torrgether: ${selectedFile.name}`,
    playing ? '--pause=no' : '--pause=yes',
    streamURL
  ]

  playerLog('Launching MPV', {
    detected,
    binary: mpvBinary,
    args,
    cwd: process.cwd(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    electron: process.versions.electron,
    pathEnvFirstEntries: redactEnvPath(process.env.PATH),
    selectedFile: {
      name: selectedFile.name,
      length: selectedFile.length,
      rawStreamURL: selectedFile.streamURL,
      resolvedStreamURL: streamURL
    },
    ipcPath,
    logPath: getPlayerLogPath()
  })

  try {
    externalPlayer.process = spawn(mpvBinary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
      env: process.env
    })
  } catch (err) {
    resetExternalStatus(err.message)
    playerLog('MPV spawn threw synchronously', { message: err.message, code: err.code, stack: err.stack })
    throw err
  }

  playerLog('MPV process spawned', { pid: externalPlayer.process.pid, spawnfile: externalPlayer.process.spawnfile, spawnargs: externalPlayer.process.spawnargs })

  let waitingForIpc = true
  const earlyFailure = new Promise((_, reject) => {
    externalPlayer.process.once('error', err => {
      const message = `MPV process error before IPC connection: ${err.message}`
      resetExternalStatus(message)
      playerLog('MPV process error', { message: err.message, code: err.code, errno: err.errno, syscall: err.syscall, stack: err.stack })
      sendToRenderer('torrent:error', { message: `MPV error: ${err.message}` })
      if (waitingForIpc) reject(new Error(message))
    })

    externalPlayer.process.once('exit', (code, signal) => {
      externalPlayer.status.running = false
      externalPlayer.status.connected = false
      const payload = { code, signal, stdout: tailText(externalPlayer.lastStdout), stderr: tailText(externalPlayer.lastStderr) }
      playerLog('MPV process exited', payload)
      if (waitingForIpc) {
        const message = `MPV exited before IPC connection: code=${code}, signal=${signal}, stderr=${tailText(externalPlayer.lastStderr, 900)}`
        reject(new Error(message))
      }
    })
  })

  externalPlayer.process.stdout?.on('data', chunk => {
    const text = String(chunk)
    updateMpvCacheFromStdout(text)
    externalPlayer.lastStdout = tailText(externalPlayer.lastStdout + text)
    if (text.trim()) playerLog('MPV stdout', tailText(text, 1200))
  })

  externalPlayer.process.stderr?.on('data', chunk => {
    const text = String(chunk)
    externalPlayer.lastStderr = tailText(externalPlayer.lastStderr + text)
    if (text.trim()) {
      // mpv may print harmless GPU/driver fallback diagnostics to stderr.
      // Treat stderr as fatal only when it clearly describes stream/file loading failure;
      // real playback failures are still detected through JSON IPC end-file events.
      if (/Cannot open file|No such file|Failed to open|Error opening|No protocol handler|Stream ends prematurely/i.test(text)) {
        externalPlayer.status.lastError = tailText(text, 1200)
      }
      playerLog('MPV stderr', tailText(text, 1200))
    }
  })

  try {
    await Promise.race([
      connectToMpvIpc(ipcPath),
      earlyFailure
    ])
    waitingForIpc = false

    await Promise.allSettled([
      mpvCommand(['observe_property', 1, 'time-pos']),
      mpvCommand(['observe_property', 2, 'pause']),
      mpvCommand(['observe_property', 3, 'duration']),
      mpvCommand(['observe_property', 4, 'filename'])
    ])

    if (startTime > 0) {
      await mpvCommand(['seek', Math.max(0, Number(startTime) || 0), 'absolute+exact']).catch(err => playerLog('Initial seek failed', { message: err.message }))
    }
    await mpvCommand(['set_property', 'pause', !playing]).catch(err => playerLog('Initial pause set failed', { message: err.message }))

    // Wait only until mpv reports it opened media metadata, errors out, or the
    // small settle window expires. This catches bad URLs without adding a fixed
    // unconditional sleep to every successful launch.
    const launchSettleMs = Number(process.env.MPV_LAUNCH_SETTLE_MS || 1200)
    await waitForMpvLoadSettled(launchSettleMs)
    if (externalPlayer.status.lastError || (!externalPlayer.status.running && !externalPlayer.status.connected)) {
      const message = externalPlayer.status.lastError || 'MPV exited immediately after launch'
      playerLog('MPV launch failed (exited before playback)', externalPlayer.status)
      throw new Error(`MPV failed to load stream: ${message}`)
    }

    playerLog('MPV launch finished successfully', externalPlayer.status)
    return { ...externalPlayer.status, logPath: getPlayerLogPath() }
  } catch (err) {
    playerLog('MPV launch failed; cleaning up stale process/listeners', { message: err.message })
    await stopExternalPlayer(err.message)
    throw err
  }
}

async function getExternalPlayerStatus() {
  // Status is kept fresh by observed MPV properties. Avoid sending 4 IPC
  // get_property requests every UI tick; that caused overlapping requests and
  // noisy timeout cascades when MPV was busy buffering/seeking.
  return {
    ...externalPlayer.status,
    logPath: getPlayerLogPath(),
    lastStdout: externalPlayer.lastStdout,
    lastStderr: externalPlayer.lastStderr,
    recentLogs: playerLogLines.slice(-120),
    pendingRequests: externalPlayer.pending.size
  }
}

async function controlExternalPlayer({ playing, time, hard = false, seek = false } = {}) {
  if (!externalPlayer.status.connected) throw new Error('MPV is not running')

  const hasTime = Number.isFinite(Number(time))
  if (hasTime && (hard || seek)) {
    externalPlayer.status.timePos = Math.max(0, Number(time))
    await mpvCommand(['seek', externalPlayer.status.timePos, 'absolute+exact'])
  }

  if (typeof playing === 'boolean') {
    externalPlayer.status.pause = !playing
    await mpvCommand(['set_property', 'pause', !playing])
  }

  return await getExternalPlayerStatus()
}

function getCurrentRamStore() {
  return currentTorrent?._torrgetherRamStore || null
}

ipcMain.handle('torrent:open-dialog', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a legal .torrent file',
    properties: ['openFile'],
    filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
  })

  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const filePath = result.filePaths[0]
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('Selected path is not a file')
  if (stat.size > MAX_TORRENT_FILE_BYTES) {
    throw new Error(`.torrent file is too large: ${(stat.size / 1024 / 1024).toFixed(1)} MiB. Limit is ${(MAX_TORRENT_FILE_BYTES / 1024 / 1024).toFixed(0)} MiB.`)
  }
  const buffer = await fs.readFile(filePath)
  return {
    canceled: false,
    payload: {
      kind: 'torrent-file',
      name: path.basename(filePath),
      base64: buffer.toString('base64')
    }
  }
})

ipcMain.handle('torrent:load', async (_event, { payload, selectedFileIndex }) => {
  try {
    return { ok: true, torrent: await loadTorrent(payload, selectedFileIndex) }
  } catch (err) {
    appLogger.error('Torrent load failed', { error: err, health: getRuntimeHealthSnapshot() })
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('torrent:select-file', async (_event, selectedFileIndex) => {
  try {
    if (!currentTorrent) throw new Error('No torrent loaded')
    await stopExternalPlayer()
    const file = currentTorrent.files[selectedFileIndex]
    if (!file) throw new Error('Invalid file index')
    currentTorrent.files.forEach(f => f.deselect())
    selectedFile = file
    playerLog('Selected file changed; RAM-only stream will fetch pieces on demand', { file: selectedFile.name })
    return {
      ok: true,
      selectedFileIndex,
      selectedFileName: selectedFile.name,
      selectedFileExt: path.extname(selectedFile.name).toLowerCase(),
      streamURL: getLocalStreamURL(selectedFile),
      rawStreamURL: selectedFile.streamURL,
      storageMode: TORRGETHER_STORAGE_MODE,
      cachePath: null
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('torrent:status', async () => {
  if (!currentTorrent) return { ok: false }
  const ramStore = getCurrentRamStore()
  const ramStats = ramStore?.getStats?.() || {}
  return {
    ok: true,
    infoHash: currentTorrent.infoHash,
    numPeers: currentTorrent.numPeers,
    progress: currentTorrent.progress,
    downloaded: currentTorrent.downloaded,
    downloadSpeed: currentTorrent.downloadSpeed,
    uploadSpeed: currentTorrent.uploadSpeed,
    timeRemaining: currentTorrent.timeRemaining,
    selectedFileProgress: selectedFile?.progress ?? 0,
    selectedFileDownloaded: selectedFile?.downloaded ?? 0,
    ramChunks: ramStats.chunks ?? null,
    ramBytes: ramStats.bytes ?? null,
    ramMaxBytes: ramStats.maxBytes ?? null,
    ramMaxChunks: ramStats.maxChunks ?? null,
    ramFillPercent: ramStats.fillPercent ?? null,
    ramLowWatermarkBytes: ramStats.lowWatermarkBytes ?? null,
    ramLowWatermarkChunks: ramStats.lowWatermarkChunks ?? null,
    ramEvictions: ramStats.evictions ?? null,
    ramRecoveries: ramStats.recoveries ?? null,
    ramRecoveryWaits: ramStats.recoveryWaits ?? null,
    ramStaleMisses: ramStats.staleMisses ?? null,
    ramRecentEvictions: ramStats.recentEvictions ?? null,
    ramPendingReads: ramStats.pendingReads ?? null,
    ramMaxPendingReads: ramStats.maxPendingReads ?? null,
    ramOverLimitBytes: ramStats.overLimitBytes ?? null,
    ramOverLimitWarnings: ramStats.overLimitWarnings ?? null,
    memoryChunks: ramStats.chunks ?? null,
    memoryBytes: ramStats.bytes ?? null,
    memoryMaxBytes: ramStats.maxBytes ?? null,
    memoryEvictions: ramStats.evictions ?? null,
    pieceLength: currentTorrent.pieceLength ?? ramStore?.chunkLength ?? null,
    storageMode: TORRGETHER_STORAGE_MODE,
    cachePath: null,
    storeCacheSlots: WEBTORRENT_STORE_CACHE_SLOTS,
    mpvCacheSeconds: externalPlayer.status.cacheSeconds,
    mpvCacheBytes: externalPlayer.status.cacheBytes,
    mpvCacheText: externalPlayer.status.cacheText,
    lowCacheEvents: externalPlayer.status.lowCacheEvents
  }
})

ipcMain.handle('player:launch-external', async (_event, args) => {
  try {
    return { ok: true, status: await launchExternalPlayer(args) }
  } catch (err) {
    appLogger.error('MPV launch IPC failed', { error: err, health: getRuntimeHealthSnapshot() })
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('player:control-external', async (_event, args) => {
  try {
    return { ok: true, status: await controlExternalPlayer(args) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('player:status-external', async () => {
  try {
    return { ok: true, status: await getExternalPlayerStatus() }
  } catch (err) {
    return { ok: false, error: err.message, status: { ...externalPlayer.status } }
  }
})

ipcMain.handle('player:logs-external', async () => {
  try {
    return { ok: true, logPath: getPlayerLogPath(), lines: playerLogLines.slice(-PLAYER_LOG_MAX_LINES), status: await getExternalPlayerStatus() }
  } catch (err) {
    return { ok: false, error: err.message, lines: playerLogLines.slice(-PLAYER_LOG_MAX_LINES), status: { ...externalPlayer.status } }
  }
})

ipcMain.handle('player:stop-external', async () => {
  try {
    await stopExternalPlayer()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('app:mpv-preflight', async () => ({ ok: true, mpv: await refreshMpvPreflight() }))

ipcMain.handle('app:config', async () => ({
  serverUrl: embeddedServerInfo?.serverUrl || process.env.SERVER_URL || 'http://localhost:3000',
  serverToken: embeddedServerInfo?.serverToken || process.env.SERVER_TOKEN || '',
  embeddedServer: Boolean(embeddedServerInfo?.embedded),
  logDir: appLogger.dir,
  desktopLogPath: appLogger.filePath,
  mpvLogPath: mpvLogger.filePath,
  logLevel: appLogger.level,
  updateRepo: UPDATE_REPO,
  updateCheckIntervalMs: UPDATE_CHECK_INTERVAL_MS,
  updateCheckDisabled: DISABLE_UPDATE_CHECK,
  mpv: mpvPreflight
}))

ipcMain.handle('app:open-logs-folder', async () => {
  const result = await shell.openPath(appLogger.dir)
  return result ? { ok: false, error: result } : { ok: true, path: appLogger.dir }
})

ipcMain.handle('app:health', async () => ({ ok: true, health: getRuntimeHealthSnapshot() }))

ipcMain.handle('app:update-check', async () => {
  if (DISABLE_UPDATE_CHECK) return { ok: true, disabled: true, updateAvailable: false }
  try {
    return await checkForUpdates({
      currentVersion: app.getVersion(),
      repo: UPDATE_REPO,
      fetchImpl: globalThis.fetch,
      platform: process.platform
    })
  } catch (err) {
    return { ok: false, updateAvailable: false, error: err.message }
  }
})

ipcMain.handle('app:open-release-page', async (_event, url) => {
  const target = String(url || `https://github.com/${UPDATE_REPO}/releases`).trim()
  if (!/^https:\/\/github\.com\//i.test(target)) return { ok: false, error: 'Only GitHub release URLs can be opened' }
  await shell.openExternal(target)
  return { ok: true, url: target }
})

ipcMain.handle('sources:search', async (_event, { query, filters } = {}) => {
  const result = await searchSources(query, filters, globalThis.fetch)
  sourceResultCache = new Map(result.results.map(item => [item.id, item]))
  return result
})

ipcMain.handle('sources:import', async (_event, resultId) => {
  try {
    const result = sourceResultCache.get(String(resultId || ''))
    if (!result) throw new Error('Source result is not available anymore. Search again.')
    const payload = await fetchSourceTorrent(result, globalThis.fetch, { maxBytes: MAX_TORRENT_FILE_BYTES })
    return { ok: true, payload }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('rutracker:show', async () => {
  try {
    ensureRutrackerView()
    rutrackerVisible = true
    applyRutrackerBounds()
    return { ok: true, url: rutrackerView.webContents.getURL() || RUTRACKER_HOME_URL }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('rutracker:hide', async () => {
  rutrackerVisible = false
  applyRutrackerBounds()
  return { ok: true }
})

ipcMain.handle('rutracker:set-bounds', async (_event, bounds) => {
  rutrackerBounds = normalizeRutrackerBounds(bounds)
  applyRutrackerBounds()
  return { ok: true, bounds: rutrackerBounds }
})

ipcMain.handle('rutracker:back', async () => {
  try {
    const view = ensureRutrackerView()
    if (view.webContents.canGoBack()) view.webContents.goBack()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('rutracker:forward', async () => {
  try {
    const view = ensureRutrackerView()
    if (view.webContents.canGoForward()) view.webContents.goForward()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('rutracker:reload', async () => {
  try {
    const view = ensureRutrackerView()
    view.webContents.reload()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.on('app:log', (_event, payload) => {
  const level = payload?.level === 'debug' ? 'debug' : payload?.level === 'warn' ? 'warn' : payload?.level === 'error' ? 'error' : 'info'
  appLogger[level]('Renderer/preload event', payload)
})

process.on('unhandledRejection', err => {
  const message = err?.message || String(err)
  appLogger.error('Unhandled desktop rejection', err)
  sendToRenderer('torrent:error', { message })
})

process.on('uncaughtException', err => {
  appLogger.error('Uncaught desktop exception', err)
  sendToRenderer('torrent:error', { message: err?.message || String(err) })
})

process.on('exit', code => {
  try { appLogger.info('Desktop process exit', { code }) } catch {}
})

app.whenReady().then(async () => {
  await configureSignalingServer()
  appLogger.info('Desktop app starting', {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    electron: process.versions.electron,
    serverUrl: embeddedServerInfo?.serverUrl || process.env.SERVER_URL || 'http://localhost:3000',
    embeddedServer: Boolean(embeddedServerInfo?.embedded),
    tokenConfigured: Boolean(embeddedServerInfo?.serverToken || process.env.SERVER_TOKEN),
    logPath: appLogger.filePath,
    mpvLogPath: mpvLogger.filePath
  })
  createClient()
  createWindow()
  ensureHealthSnapshotTimer()
  await refreshMpvPreflight()
}).catch(err => {
  appLogger.error('Desktop app failed to start', { error: err, health: getRuntimeHealthSnapshot() })
  dialog.showErrorBox('Torrgether failed to start', err?.message || String(err))
  process.exitCode = 1
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('child-process-gone', (_event, details) => {
  appLogger.error('Electron child process gone', { details, health: getRuntimeHealthSnapshot() })
})

app.on('will-quit', () => {
  appLogger.info('Desktop app will quit', getRuntimeHealthSnapshot())
})

app.on('before-quit', event => {
  appLogger.info('Desktop app before-quit', getRuntimeHealthSnapshot())
  if (shutdownStarted) return
  shutdownStarted = true
  event.preventDefault()
  shutdownResources()
    .catch(err => {
      try { appLogger.error('Desktop app shutdown failed', { error: err, health: getRuntimeHealthSnapshot() }) } catch {}
    })
    .finally(() => {
      app.exit(process.exitCode || 0)
    })
})
