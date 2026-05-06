const { contextBridge, ipcRenderer } = require('electron')

const rendererSocketHandlers = new Map()
const internalSocketHandlers = new Map()
const socketState = {
  connected: false,
  id: null
}
const ALLOWED_RENDERER_SOCKET_EVENTS = new Set([
  'connect',
  'disconnect',
  'connect_error',
  'room:snapshot',
  'room:members',
  'torrent:update',
  'control:state'
])

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
  rendererSocketHandlers.clear()
  socketState.connected = false
  socketState.id = null
}

function assertAllowedSocketEvent(event) {
  if (!ALLOWED_RENDERER_SOCKET_EVENTS.has(event)) {
    throw new Error(`Socket event is not exposed to renderer: ${event}`)
  }
}

function handleSocketEvent(_event, payload = {}) {
  const event = payload?.event
  if (!ALLOWED_RENDERER_SOCKET_EVENTS.has(event)) return

  if (event === 'connect') {
    socketState.connected = true
    socketState.id = payload.socketId || null
  } else if (event === 'disconnect') {
    socketState.connected = false
    socketState.id = null
  } else {
    socketState.connected = Boolean(payload.connected)
    socketState.id = payload.socketId || null
  }

  const handler = rendererSocketHandlers.get(event)
  if (handler) handler(...(Array.isArray(payload.args) ? payload.args : []))
}

internalSocketHandlers.set('socket:event', handleSocketEvent)
ipcRenderer.on('socket:event', handleSocketEvent)

function invokeSocketConnect(url, opts) {
  ipcRenderer.invoke('socket:connect', { url, opts }).catch(err => {
    appLog('error', 'Socket connect failed', { url, message: err.message || String(err) })
  })
}

function invokeSocketDisconnect() {
  ipcRenderer.invoke('socket:disconnect').catch(err => {
    appLog('warn', 'Socket disconnect failed', { message: err.message || String(err) })
  })
}

function socketEmitAck(event, payload, timeoutMs) {
  if (!socketState.connected) throw new Error('Socket is not connected')
  appLog('debug', 'Socket emit ack', { event, timeoutMs })
  return ipcRenderer.invoke('socket:emit-ack', { event, payload, timeoutMs })
}

contextBridge.exposeInMainWorld('torrgether', {
  connectSocket(url, opts = {}) {
    closeSocket()
    invokeSocketConnect(url, opts)
    return true
  },
  disconnectSocket() {
    closeSocket()
    invokeSocketDisconnect()
    appLog('info', 'Socket manually disconnected')
    return true
  },
  socketOn(event, callback) {
    assertAllowedSocketEvent(event)
    const handler = (...args) => callback(...args)
    rendererSocketHandlers.set(event, handler)
  },
  socketOff(event) {
    assertAllowedSocketEvent(event)
    rendererSocketHandlers.delete(event)
  },
  emitRoomJoin(payload, timeoutMs) {
    return socketEmitAck('room:join', payload, timeoutMs)
  },
  emitTorrentSet(payload, timeoutMs) {
    return socketEmitAck('torrent:set', payload, timeoutMs)
  },
  emitTorrentFileSelected(payload, timeoutMs) {
    return socketEmitAck('torrent:file-selected', payload, timeoutMs)
  },
  emitTorrentReady(payload, timeoutMs) {
    return socketEmitAck('torrent:ready', payload, timeoutMs)
  },
  emitTorrentPayloadGet(payload, timeoutMs) {
    return socketEmitAck('torrent:get-payload', payload, timeoutMs)
  },
  emitControlSet(payload, timeoutMs) {
    return socketEmitAck('control:set', payload, timeoutMs)
  },
  emitHostHeartbeat(payload) {
    if (!socketState.connected) throw new Error('Socket is not connected')
    ipcRenderer.invoke('socket:emit', { event: 'host:heartbeat', payload }).catch(err => {
      appLog('warn', 'Socket emit failed', { event: 'host:heartbeat', message: err.message || String(err) })
    })
  },
  socketConnected() {
    return socketState.connected
  },
  socketId() {
    return socketState.id
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
