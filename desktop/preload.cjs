const { contextBridge, ipcRenderer } = require('electron')
const { io } = require('socket.io-client')

let socket = null
const rendererSocketHandlers = new Map()
const DEFAULT_ACK_TIMEOUT_MS = Number(process.env.SOCKET_ACK_TIMEOUT_MS || 8000)
const SOCKET_RECONNECTION_ATTEMPTS = Number(process.env.SOCKET_RECONNECTION_ATTEMPTS || 50)

function appLog(level, message, data) {
  try {
    ipcRenderer.send('app:log', { level, message, data })
  } catch {}
}

let _torrentErrorHandler = null
let _playerLogHandler = null
let _rutrackerImportHandler = null
let _rutrackerStatusHandler = null

function closeSocket() {
  if (!socket) return
  socket.disconnect()
  socket.removeAllListeners()
  socket = null
  rendererSocketHandlers.clear()
}

contextBridge.exposeInMainWorld('torrgether', {
  connectSocket(url, opts = {}) {
    closeSocket()
    socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: SOCKET_RECONNECTION_ATTEMPTS,
      reconnectionDelay: 600,
      reconnectionDelayMax: 3000,
      timeout: 15000,
      auth: {
        serverToken: opts?.auth?.serverToken || ''
      }
    })
    appLog('info', 'Socket connection requested', {
      url,
      hasServerToken: Boolean(opts?.auth?.serverToken),
      transports: ['websocket', 'polling']
    })
    socket.on('connect', () => {
      appLog('info', 'Socket connected', { socketId: socket.id, url })
    })
    socket.on('disconnect', reason => {
      appLog('warn', 'Socket disconnected', { socketId: socket?.id || null, reason, url })
    })
    socket.on('connect_error', err => {
      appLog('error', 'Socket connect_error', { url, message: err.message, description: err.description, context: err.context })
    })
    return true
  },
  disconnectSocket() {
    closeSocket()
    appLog('info', 'Socket manually disconnected')
    return true
  },
  socketOn(event, callback) {
    if (!socket) throw new Error('Socket is not connected')
    // One renderer handler per event is enough for this MVP. Replacing the old
    // handler prevents duplicated state updates after repeated Join clicks.
    const previous = rendererSocketHandlers.get(event)
    if (previous) socket.off(event, previous)
    const handler = (...args) => callback(...args)
    rendererSocketHandlers.set(event, handler)
    socket.on(event, handler)
  },
  socketOff(event) {
    if (!socket) return
    const previous = rendererSocketHandlers.get(event)
    if (previous) socket.off(event, previous)
    rendererSocketHandlers.delete(event)
  },
  socketEmit(event, payload) {
    if (!socket) throw new Error('Socket is not connected')
    appLog('debug', 'Socket emit', { event })
    socket.emit(event, payload)
  },
  socketEmitAck(event, payload, timeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
    if (!socket) throw new Error('Socket is not connected')
    appLog('debug', 'Socket emit ack', { event, timeoutMs })

    return new Promise(resolve => {
      let settled = false
      const finish = response => {
        if (settled) return
        settled = true
        resolve(response)
      }

      const fallbackTimer = setTimeout(() => {
        appLog('warn', 'Socket ACK fallback timeout', { event, timeoutMs })
        finish({ ok: false, error: `ACK timeout after ${timeoutMs}ms for ${event}` })
      }, timeoutMs + 250)

      socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
        clearTimeout(fallbackTimer)
        if (err) {
          appLog('warn', 'Socket ACK timeout/disconnect', { event, timeoutMs, message: err.message || String(err) })
          finish({ ok: false, error: `ACK timeout/disconnect for ${event}: ${err.message || err}` })
          return
        }
        finish(response || { ok: true })
      })
    })
  },
  socketConnected() {
    return Boolean(socket?.connected)
  },
  socketId() {
    return socket?.id || null
  },
  openTorrentDialog: () => ipcRenderer.invoke('torrent:open-dialog'),
  loadTorrent: args => ipcRenderer.invoke('torrent:load', args),
  selectTorrentFile: index => ipcRenderer.invoke('torrent:select-file', index),
  torrentStatus: () => ipcRenderer.invoke('torrent:status'),
  launchExternalPlayer: args => ipcRenderer.invoke('player:launch-external', args),
  controlExternalPlayer: args => ipcRenderer.invoke('player:control-external', args),
  externalPlayerStatus: () => ipcRenderer.invoke('player:status-external'),
  externalPlayerLogs: () => ipcRenderer.invoke('player:logs-external'),
  stopExternalPlayer: () => ipcRenderer.invoke('player:stop-external'),
  clientConfig: () => ipcRenderer.invoke('app:config'),
  mpvPreflight: () => ipcRenderer.invoke('app:mpv-preflight'),
  appHealth: () => ipcRenderer.invoke('app:health'),
  checkForUpdates: () => ipcRenderer.invoke('app:update-check'),
  openReleasePage: url => ipcRenderer.invoke('app:open-release-page', url),
  openLogsFolder: () => ipcRenderer.invoke('app:open-logs-folder'),
  searchSources: args => ipcRenderer.invoke('sources:search', args),
  searchCatalog: args => ipcRenderer.invoke('catalog:search', args),
  catalogDetails: resultId => ipcRenderer.invoke('catalog:details', resultId),
  importSourceResult: resultId => ipcRenderer.invoke('sources:import', resultId),
  showRutracker: () => ipcRenderer.invoke('rutracker:show'),
  hideRutracker: () => ipcRenderer.invoke('rutracker:hide'),
  setRutrackerBounds: bounds => ipcRenderer.invoke('rutracker:set-bounds', bounds),
  rutrackerBack: () => ipcRenderer.invoke('rutracker:back'),
  rutrackerForward: () => ipcRenderer.invoke('rutracker:forward'),
  rutrackerReload: () => ipcRenderer.invoke('rutracker:reload'),
  writeAppLog: payload => ipcRenderer.send('app:log', payload),
  onTorrentError(callback) {
    if (_torrentErrorHandler) ipcRenderer.removeListener('torrent:error', _torrentErrorHandler)
    _torrentErrorHandler = (_event, payload) => callback(payload)
    ipcRenderer.on('torrent:error', _torrentErrorHandler)
  },
  onPlayerLog(callback) {
    if (_playerLogHandler) ipcRenderer.removeListener('player:log', _playerLogHandler)
    _playerLogHandler = (_event, payload) => callback(payload)
    ipcRenderer.on('player:log', _playerLogHandler)
  },
  onRutrackerImport(callback) {
    if (_rutrackerImportHandler) ipcRenderer.removeListener('rutracker:import', _rutrackerImportHandler)
    _rutrackerImportHandler = (_event, payload) => callback(payload)
    ipcRenderer.on('rutracker:import', _rutrackerImportHandler)
  },
  onRutrackerStatus(callback) {
    if (_rutrackerStatusHandler) ipcRenderer.removeListener('rutracker:status', _rutrackerStatusHandler)
    _rutrackerStatusHandler = (_event, payload) => callback(payload)
    ipcRenderer.on('rutracker:status', _rutrackerStatusHandler)
  }
})
