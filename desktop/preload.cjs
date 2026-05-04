const { contextBridge, ipcRenderer } = require('electron')
const { io } = require('socket.io-client')

let socket = null
const rendererSocketHandlers = new Map()
const DEFAULT_ACK_TIMEOUT_MS = Number(process.env.SOCKET_ACK_TIMEOUT_MS || 8000)

function appLog(level, message, data) {
  try {
    ipcRenderer.send('app:log', { level, message, data })
  } catch {}
}

function closeSocket() {
  if (!socket) return
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
  rendererSocketHandlers.clear()
}

contextBridge.exposeInMainWorld('torrgether', {
  connectSocket(url, opts) {
    closeSocket()
    socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 3000,
      timeout: 15000,
      ...opts
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
  openLogsFolder: () => ipcRenderer.invoke('app:open-logs-folder'),
  showRutracker: () => ipcRenderer.invoke('rutracker:show'),
  hideRutracker: () => ipcRenderer.invoke('rutracker:hide'),
  setRutrackerBounds: bounds => ipcRenderer.invoke('rutracker:set-bounds', bounds),
  rutrackerBack: () => ipcRenderer.invoke('rutracker:back'),
  rutrackerForward: () => ipcRenderer.invoke('rutracker:forward'),
  rutrackerReload: () => ipcRenderer.invoke('rutracker:reload'),
  writeAppLog: payload => ipcRenderer.send('app:log', payload),
  onTorrentError(callback) {
    ipcRenderer.removeAllListeners('torrent:error')
    ipcRenderer.on('torrent:error', (_event, payload) => callback(payload))
  },
  onPlayerLog(callback) {
    ipcRenderer.removeAllListeners('player:log')
    ipcRenderer.on('player:log', (_event, payload) => callback(payload))
  },
  onRutrackerImport(callback) {
    ipcRenderer.removeAllListeners('rutracker:import')
    ipcRenderer.on('rutracker:import', (_event, payload) => callback(payload))
  },
  onRutrackerStatus(callback) {
    ipcRenderer.removeAllListeners('rutracker:status')
    ipcRenderer.on('rutracker:status', (_event, payload) => callback(payload))
  }
})
