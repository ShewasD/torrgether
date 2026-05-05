import express from 'express'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { Server } from 'socket.io'
import { formatServerUrls, getServerConfig } from '../shared/config.js'
import { createLogger } from '../shared/logger.js'
import { createTokenAuthMiddleware } from './auth.js'

export const MAX_CLIENT_ID_LENGTH = 120
const MAX_TORRENT_FILE_BASE64_BYTES = 7 * 1024 * 1024 // protects the signaling server
const MAX_MAGNET_URI_LENGTH = 2048
const MAX_SELECTED_FILE_INDEX = 10000

function numericOption(value, fallback, { min = 0 } = {}) {
  const number = Number(value)
  return Number.isFinite(number) && number >= min ? number : fallback
}

function integerOption(value, fallback, { min = 0 } = {}) {
  const number = Number(value)
  return Number.isInteger(number) && number >= min ? number : fallback
}

function optionOrDefault(options, key, fallback) {
  return Object.prototype.hasOwnProperty.call(options, key) ? options[key] : fallback
}

export function normalizeClientId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_CLIENT_ID_LENGTH) return null
  return trimmed
}

export function createSocketIoOptions(serverConfig, {
  hostGraceMs,
  maxHttpBufferSize,
  pingInterval,
  pingTimeout,
  connectionStateRecovery = false
} = {}) {
  const options = {
    cors: { origin: serverConfig.corsOrigin },
    ...(maxHttpBufferSize ? { maxHttpBufferSize } : {}),
    ...(pingInterval ? { pingInterval } : {}),
    ...(pingTimeout ? { pingTimeout } : {})
  }

  if (connectionStateRecovery) {
    options.connectionStateRecovery = {
      maxDisconnectionDuration: hostGraceMs,
      skipMiddlewares: false
    }
  }

  return options
}

function booleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function disabledEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())
}

function closeHttpServer(httpServer) {
  return new Promise(resolve => {
    if (!httpServer.listening) return resolve()
    httpServer.close(() => resolve())
  })
}

function isCliEntryPoint() {
  if (!process.argv[1]) return false
  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
}

export async function startSignalingServer(options = {}) {
  const env = options.env || process.env
  const baseConfig = getServerConfig(env)
  const serverConfig = {
    ...baseConfig,
    host: optionOrDefault(options, 'host', baseConfig.host),
    port: integerOption(optionOrDefault(options, 'port', baseConfig.port), baseConfig.port, { min: 0 }),
    publicUrl: optionOrDefault(options, 'publicUrl', baseConfig.publicUrl),
    corsOrigin: optionOrDefault(options, 'corsOrigin', baseConfig.corsOrigin),
    serverToken: String(optionOrDefault(options, 'serverToken', baseConfig.serverToken) || ''),
    logDir: optionOrDefault(options, 'logDir', baseConfig.logDir),
    logLevel: optionOrDefault(options, 'logLevel', baseConfig.logLevel)
  }

  const hostGraceMs = numericOption(optionOrDefault(options, 'hostGraceMs', env.HOST_GRACE_MS), 2 * 60 * 1000)
  const roomEmptyTtlMs = numericOption(optionOrDefault(options, 'roomEmptyTtlMs', env.ROOM_EMPTY_TTL_MS), 5 * 60 * 1000)
  const offlineMemberTtlMs = numericOption(optionOrDefault(options, 'offlineMemberTtlMs', env.OFFLINE_MEMBER_TTL_MS), 15 * 60 * 1000)
  const roomMaintenanceIntervalMs = numericOption(optionOrDefault(options, 'roomMaintenanceIntervalMs', env.ROOM_MAINTENANCE_INTERVAL_MS), 15 * 60 * 1000)
  const hostReadyFallbackMs = numericOption(optionOrDefault(options, 'hostReadyFallbackMs', env.HOST_READY_FALLBACK_MS), 30 * 1000)
  const authRateLimitMaxAttempts = integerOption(optionOrDefault(options, 'authRateLimitMaxAttempts', env.AUTH_RATE_LIMIT_MAX_ATTEMPTS), 20, { min: 1 })
  const authRateLimitWindowMs = numericOption(optionOrDefault(options, 'authRateLimitWindowMs', env.AUTH_RATE_LIMIT_WINDOW_MS), 60 * 1000, { min: 1 })
  const maxHttpBufferSize = integerOption(optionOrDefault(options, 'maxHttpBufferSize', env.SOCKET_MAX_HTTP_BUFFER_SIZE), 12 * 1024 * 1024, { min: 1024 * 1024 })
  const socketPingIntervalMs = numericOption(optionOrDefault(options, 'socketPingIntervalMs', env.SOCKET_PING_INTERVAL_MS), 30 * 1000, { min: 1000 })
  const socketPingTimeoutMs = numericOption(optionOrDefault(options, 'socketPingTimeoutMs', env.SOCKET_PING_TIMEOUT_MS), 60 * 1000, { min: 1000 })
  const connectionStateRecovery = booleanEnv(optionOrDefault(options, 'connectionStateRecovery', env.SOCKET_CONNECTION_STATE_RECOVERY), false) &&
    !disabledEnv(optionOrDefault(options, 'disableConnectionStateRecovery', env.DISABLE_CONNECTION_STATE_RECOVERY))
  const maxRooms = integerOption(optionOrDefault(options, 'maxRooms', env.MAX_ROOMS), 5000, { min: 1 })

  let serverUrls = formatServerUrls(serverConfig)
  const logger = options.logger || createLogger({
    name: 'server',
    fileName: 'server.log',
    ...(serverConfig.logDir ? { logDir: serverConfig.logDir } : {}),
    level: serverConfig.logLevel
  })

  const app = express()
  const httpServer = http.createServer(app)
  const io = new Server(httpServer, createSocketIoOptions(serverConfig, {
    hostGraceMs,
    maxHttpBufferSize,
    pingInterval: socketPingIntervalMs,
    pingTimeout: socketPingTimeoutMs,
    connectionStateRecovery
  }))
  const rooms = new Map()
  let maintenanceTimer = null
  let closed = false

  app.get('/', (_, res) => {
    res.type('text').send(`Torrgether signaling server is running. Connect Electron clients to ${serverUrls.displayUrl}.`)
  })

  app.get('/health', (_, res) => {
    res.json({
      ok: true,
      rooms: rooms.size,
      maxRooms,
      uptime: process.uptime(),
      publicUrl: serverUrls.publicUrl,
      tokenRequired: Boolean(serverConfig.serverToken)
    })
  })

  io.use(createTokenAuthMiddleware(serverConfig.serverToken, logger, {
    maxAttempts: authRateLimitMaxAttempts,
    windowMs: authRateLimitWindowMs
  }))

  function now() {
    return Date.now()
  }

  function createRoom(roomId) {
    return {
      id: roomId,
      hostClientId: null,
      members: new Map(),
      torrent: null,
      torrentVersion: 0,
      createdAt: now(),
      updatedAt: now(),
      cleanupTimer: null,
      state: {
        seq: 0,
        playing: false,
        time: 0,
        updatedAt: now(),
        reason: 'initial'
      }
    }
  }

  function getRoom(roomId) {
    if (!rooms.has(roomId)) {
      if (rooms.size >= maxRooms) throw new Error(`Room limit reached (${maxRooms})`)
      rooms.set(roomId, createRoom(roomId))
    }
    return rooms.get(roomId)
  }

  function touchRoom(room) {
    room.updatedAt = now()
  }

  function onlineMembers(room) {
    return [...room.members.values()].filter(member => member.online)
  }

  function cancelRoomCleanup(room) {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer)
    room.cleanupTimer = null
  }

  function purgeOldOfflineMembers(room) {
    const cutoff = now() - offlineMemberTtlMs
    for (const [clientId, member] of room.members) {
      if (!member.online && member.lastSeen < cutoff) room.members.delete(clientId)
    }
  }

  function deleteRoom(roomId) {
    const room = rooms.get(roomId)
    if (!room) return false
    cancelRoomCleanup(room)
    rooms.delete(roomId)
    logger.info('Deleted inactive room', { roomId })
    return true
  }

  function maybeDeleteEmptyRoom(room) {
    if (onlineMembers(room).length === 0 && now() - room.updatedAt >= roomEmptyTtlMs) {
      return deleteRoom(room.id)
    }
    return false
  }

  function scheduleRoomCleanup(room) {
    if (room.cleanupTimer) return
    room.cleanupTimer = setTimeout(() => {
      const latest = rooms.get(room.id)
      if (!latest) return
      latest.cleanupTimer = null
      purgeOldOfflineMembers(latest)

      if (!maybeDeleteEmptyRoom(latest) && onlineMembers(latest).length === 0) {
        scheduleRoomCleanup(latest)
      }
    }, roomEmptyTtlMs)
    room.cleanupTimer.unref?.()
  }

  function runRoomMaintenance() {
    for (const room of rooms.values()) {
      purgeOldOfflineMembers(room)
      if (!maybeDeleteEmptyRoom(room) && onlineMembers(room).length === 0) scheduleRoomCleanup(room)
    }
  }

  function publicMembers(room) {
    return [...room.members.values()].map(member => ({
      clientId: member.clientId,
      name: member.name,
      online: member.online,
      isHost: member.clientId === room.hostClientId,
      hasCurrentTorrent: room.torrent ? member.readyTorrentVersion === room.torrentVersion : true,
      lastSeen: member.lastSeen
    }))
  }

  function snapshot(room, clientId) {
    return {
      roomId: room.id,
      hostClientId: room.hostClientId,
      isHost: room.hostClientId === clientId,
      members: publicMembers(room),
      torrent: room.torrent,
      state: room.state,
      serverTime: now()
    }
  }

  function chooseHostCandidate(room) {
    const candidates = onlineMembers(room).sort((a, b) => a.joinedAt - b.joinedAt)
    if (!room.torrent) return candidates[0] || null

    // Prefer a participant that explicitly reported the current torrent/file as loaded.
    // If nobody is ready yet, keep the room hostless briefly; then fall back to the
    // oldest online member so a room cannot stay frozen forever.
    const ready = candidates.find(member => member.readyTorrentVersion === room.torrentVersion)
    if (ready) return ready

    const torrentSetAt = Number(room.torrent?.setAt || room.torrent?.fileSelectedAt || 0)
    if (torrentSetAt && now() - torrentSetAt >= hostReadyFallbackMs) return candidates[0] || null
    return null
  }

  function electNewHostIfNeeded(room) {
    const currentHost = room.members.get(room.hostClientId)
    if (currentHost && currentHost.online) return false

    const previousHost = room.hostClientId
    const candidate = chooseHostCandidate(room)
    room.hostClientId = candidate?.clientId || null
    const changed = previousHost !== room.hostClientId
    if (changed) {
      logger.info('Room host changed', {
        roomId: room.id,
        previousHost,
        nextHost: room.hostClientId,
        torrentVersion: room.torrentVersion,
        onlineMembers: onlineMembers(room).length
      })
    }
    return changed
  }

  function emitRoomSnapshot(room) {
    io.to(room.id).emit('room:members', publicMembers(room))
    for (const member of onlineMembers(room)) {
      if (member.socketId) io.to(member.socketId).emit('room:snapshot', snapshot(room, member.clientId))
    }
  }

  function validateSelectedFileIndex(value) {
    if (value == null) return null
    const number = Number(value)
    if (!Number.isInteger(number) || number < 0 || number > MAX_SELECTED_FILE_INDEX) return null
    return number
  }

  function scheduleHostFailover(roomId, clientId) {
    setTimeout(() => {
      const latestRoom = rooms.get(roomId)
      if (!latestRoom || latestRoom.hostClientId !== clientId) return
      const latestMember = latestRoom.members.get(clientId)
      if (latestMember?.online) return

      const hostChanged = electNewHostIfNeeded(latestRoom)
      if (hostChanged) emitRoomSnapshot(latestRoom)
      else io.to(latestRoom.id).emit('room:members', publicMembers(latestRoom))
      if (onlineMembers(latestRoom).length === 0) scheduleRoomCleanup(latestRoom)
    }, hostGraceMs).unref?.()
  }

  io.on('connection', socket => {
    logger.info('Socket connected', {
      socketId: socket.id,
      address: socket.handshake.address,
      recovered: socket.recovered
    })

    socket.on('room:join', (payload = {}, ack) => {
      const { roomId, clientId, name } = payload || {}
      const safeClientId = normalizeClientId(clientId)
      if (!roomId || !safeClientId) {
        ack?.({ ok: false, error: `roomId and clientId are required; clientId must be 1-${MAX_CLIENT_ID_LENGTH} characters` })
        logger.warn('Rejected room join without valid roomId/clientId', {
          socketId: socket.id,
          roomId,
          clientIdLength: typeof clientId === 'string' ? clientId.length : null
        })
        return
      }

      const safeRoomId = String(roomId).slice(0, 80)
      const safeName = String(name || 'Anonymous').slice(0, 40)
      let room
      try {
        room = getRoom(safeRoomId)
      } catch (err) {
        ack?.({ ok: false, error: err.message })
        logger.warn('Rejected room join because room capacity is exhausted', {
          socketId: socket.id,
          roomId: safeRoomId,
          maxRooms
        })
        return
      }
      cancelRoomCleanup(room)
      touchRoom(room)

      purgeOldOfflineMembers(room)

      const previous = room.members.get(safeClientId)
      const member = {
        clientId: safeClientId,
        name: safeName,
        online: true,
        socketId: socket.id,
        joinedAt: previous?.joinedAt || now(),
        lastSeen: now(),
        readyTorrentVersion: previous?.readyTorrentVersion || 0,
        torrentReadyAt: previous?.torrentReadyAt || null
      }

      room.members.set(safeClientId, member)

      if (!room.hostClientId && !room.torrent) {
        room.hostClientId = safeClientId
      } else if (!room.hostClientId) {
        electNewHostIfNeeded(room)
      }

      socket.data.roomId = safeRoomId
      socket.data.clientId = safeClientId
      socket.join(safeRoomId)

      const snap = snapshot(room, safeClientId)
      ack?.({ ok: true, snapshot: snap })
      io.to(safeRoomId).emit('room:members', publicMembers(room))
      logger.info('Member joined room', {
        roomId: safeRoomId,
        clientId: safeClientId,
        name: safeName,
        socketId: socket.id,
        isHost: room.hostClientId === safeClientId,
        members: room.members.size,
        onlineMembers: onlineMembers(room).length,
        torrentVersion: room.torrentVersion
      })
    })

    socket.on('torrent:set', (payload, ack) => {
      const room = rooms.get(socket.data.roomId)
      if (!room) return ack?.({ ok: false, error: 'Join a room first' })
      if (room.hostClientId !== socket.data.clientId) {
        return ack?.({ ok: false, error: 'Only the host can set a torrent' })
      }

      const torrentPayload = payload?.torrent
      if (!torrentPayload) return ack?.({ ok: false, error: 'Missing torrent payload' })

      const isMagnet = torrentPayload.kind === 'magnet' && typeof torrentPayload.magnetURI === 'string'
      const isTorrentFile = torrentPayload.kind === 'torrent-file' && typeof torrentPayload.base64 === 'string'
      if (!isMagnet && !isTorrentFile) return ack?.({ ok: false, error: 'Unsupported torrent payload' })
      if (isMagnet && (torrentPayload.magnetURI.length > MAX_MAGNET_URI_LENGTH || !/^magnet:\?/.test(torrentPayload.magnetURI))) {
        return ack?.({ ok: false, error: 'Invalid magnet URI' })
      }

      if (isTorrentFile && Buffer.byteLength(torrentPayload.base64, 'base64') > MAX_TORRENT_FILE_BASE64_BYTES) {
        return ack?.({ ok: false, error: '.torrent file is too large for this MVP signaling server' })
      }

      const selectedFileIndex = validateSelectedFileIndex(torrentPayload.selectedFileIndex)
      if (torrentPayload.selectedFileIndex != null && selectedFileIndex == null) {
        return ack?.({ ok: false, error: 'Invalid selectedFileIndex' })
      }

      room.torrentVersion += 1
      for (const member of room.members.values()) {
        member.readyTorrentVersion = 0
        member.torrentReadyAt = null
      }

      const host = room.members.get(socket.data.clientId)
      if (host) {
        host.readyTorrentVersion = room.torrentVersion
        host.torrentReadyAt = now()
      }

      room.torrent = {
        ...torrentPayload,
        name: String(torrentPayload.name || 'Untitled torrent').slice(0, 200),
        selectedFileIndex,
        version: room.torrentVersion,
        setBy: socket.data.clientId,
        setAt: now()
      }

      room.state = {
        seq: room.state.seq + 1,
        playing: false,
        time: 0,
        updatedAt: now(),
        reason: 'torrent:set'
      }
      touchRoom(room)

      io.to(room.id).emit('torrent:update', room.torrent)
      io.to(room.id).emit('control:state', room.state)
      io.to(room.id).emit('room:members', publicMembers(room))
      ack?.({ ok: true, torrentVersion: room.torrentVersion })
      logger.info('Torrent set for room', {
        roomId: room.id,
        clientId: socket.data.clientId,
        kind: torrentPayload.kind,
        name: room.torrent.name,
        selectedFileIndex,
        torrentVersion: room.torrentVersion
      })
    })

    socket.on('torrent:file-selected', ({ selectedFileIndex } = {}, ack) => {
      const room = rooms.get(socket.data.roomId)
      if (!room) return ack?.({ ok: false, error: 'Join a room first' })
      if (room.hostClientId !== socket.data.clientId) return ack?.({ ok: false, error: 'Only host can choose video file' })
      if (!room.torrent) return ack?.({ ok: false, error: 'Torrent is not set yet' })

      const safeSelectedFileIndex = validateSelectedFileIndex(selectedFileIndex)
      if (safeSelectedFileIndex == null) return ack?.({ ok: false, error: 'Invalid selectedFileIndex' })

      room.torrentVersion += 1
      for (const member of room.members.values()) {
        member.readyTorrentVersion = 0
        member.torrentReadyAt = null
      }

      const host = room.members.get(socket.data.clientId)
      if (host) {
        host.readyTorrentVersion = room.torrentVersion
        host.torrentReadyAt = now()
      }

      room.torrent = { ...room.torrent, selectedFileIndex: safeSelectedFileIndex, version: room.torrentVersion, fileSelectedAt: now() }
      room.state = {
        seq: room.state.seq + 1,
        playing: false,
        time: 0,
        updatedAt: now(),
        reason: 'torrent:file-selected'
      }
      touchRoom(room)

      io.to(room.id).emit('torrent:update', room.torrent)
      io.to(room.id).emit('control:state', room.state)
      io.to(room.id).emit('room:members', publicMembers(room))
      ack?.({ ok: true, torrentVersion: room.torrentVersion })
      logger.info('Torrent file selected', {
        roomId: room.id,
        clientId: socket.data.clientId,
        selectedFileIndex: safeSelectedFileIndex,
        torrentVersion: room.torrentVersion
      })
    })

    socket.on('torrent:ready', ({ version, infoHash, selectedFileIndex } = {}, ack) => {
      const room = rooms.get(socket.data.roomId)
      if (!room) return ack?.({ ok: false, error: 'Join a room first' })
      const member = room.members.get(socket.data.clientId)
      if (!member) return ack?.({ ok: false, error: 'Join a room first' })
      if (!room.torrent) return ack?.({ ok: false, error: 'Torrent is not set' })

      if (Number(version) !== room.torrentVersion) {
        return ack?.({ ok: false, error: 'Stale torrent version', expectedVersion: room.torrentVersion })
      }

      const safeSelectedFileIndex = validateSelectedFileIndex(selectedFileIndex)
      if (selectedFileIndex != null && safeSelectedFileIndex == null) {
        return ack?.({ ok: false, error: 'Invalid selectedFileIndex' })
      }

      member.readyTorrentVersion = room.torrentVersion
      member.torrentReadyAt = now()
      member.infoHash = typeof infoHash === 'string' ? infoHash.slice(0, 80) : member.infoHash
      member.selectedFileIndex = safeSelectedFileIndex
      touchRoom(room)

      const hostChanged = electNewHostIfNeeded(room)
      if (hostChanged) emitRoomSnapshot(room)
      else io.to(room.id).emit('room:members', publicMembers(room))

      ack?.({ ok: true, isHost: room.hostClientId === socket.data.clientId })
      logger.info('Member reported torrent ready', {
        roomId: room.id,
        clientId: socket.data.clientId,
        version,
        selectedFileIndex: safeSelectedFileIndex,
        isHost: room.hostClientId === socket.data.clientId
      })
    })

    socket.on('control:set', ({ playing, time, reason } = {}, ack) => {
      const room = rooms.get(socket.data.roomId)
      if (!room) return ack?.({ ok: false, error: 'Join a room first' })
      if (room.hostClientId !== socket.data.clientId) {
        return ack?.({ ok: false, error: 'Only the host controls playback in this MVP' })
      }

      const nextTime = Math.max(0, Number(time) || 0)
      room.state = {
        seq: room.state.seq + 1,
        playing: Boolean(playing),
        time: nextTime,
        updatedAt: now(),
        reason: String(reason || 'control').slice(0, 40)
      }
      touchRoom(room)

      io.to(room.id).emit('control:state', room.state)
      ack?.({ ok: true, state: room.state })
      logger.info('Playback control updated', {
        roomId: room.id,
        clientId: socket.data.clientId,
        playing: room.state.playing,
        time: room.state.time,
        seq: room.state.seq,
        reason: room.state.reason
      })
    })

    socket.on('host:heartbeat', ({ playing, time } = {}) => {
      const room = rooms.get(socket.data.roomId)
      if (!room || room.hostClientId !== socket.data.clientId) return

      room.state = {
        seq: room.state.seq + 1,
        playing: Boolean(playing),
        time: Math.max(0, Number(time) || 0),
        updatedAt: now(),
        reason: 'heartbeat'
      }
      touchRoom(room)

      socket.to(room.id).emit('control:state', room.state)
      logger.debug('Host heartbeat', {
        roomId: room.id,
        clientId: socket.data.clientId,
        playing: room.state.playing,
        time: room.state.time,
        seq: room.state.seq
      })
    })

    socket.on('disconnect', reason => {
      const room = rooms.get(socket.data.roomId)
      if (!room) {
        logger.info('Socket disconnected before joining room', { socketId: socket.id, reason })
        return
      }

      const member = room.members.get(socket.data.clientId)
      const wasCurrentSocket = member?.socketId === socket.id
      if (member && wasCurrentSocket) {
        member.online = false
        member.lastSeen = now()
        member.socketId = null
      }
      touchRoom(room)

      io.to(room.id).emit('room:members', publicMembers(room))
      if (onlineMembers(room).length === 0) scheduleRoomCleanup(room)
      if (wasCurrentSocket && room.hostClientId === socket.data.clientId) {
        scheduleHostFailover(room.id, socket.data.clientId)
      }

      logger.info('Socket disconnected from room', {
        socketId: socket.id,
        roomId: room.id,
        clientId: socket.data.clientId,
        reason,
        staleSocket: Boolean(member && !wasCurrentSocket),
        onlineMembers: onlineMembers(room).length
      })
    })
  })

  maintenanceTimer = setInterval(runRoomMaintenance, roomMaintenanceIntervalMs)
  maintenanceTimer.unref?.()

  const handle = {
    app,
    httpServer,
    io,
    rooms,
    logger,
    get config() {
      return serverConfig
    },
    get urls() {
      return serverUrls
    },
    async close() {
      if (closed) return
      closed = true
      if (maintenanceTimer) clearInterval(maintenanceTimer)
      for (const room of rooms.values()) cancelRoomCleanup(room)
      await new Promise(resolve => io.close(() => resolve()))
      await closeHttpServer(httpServer)
      await logger.close?.()
    }
  }

  try {
    await new Promise((resolve, reject) => {
      const onListenError = err => {
        logger.error('HTTP server startup error', err)
        reject(err)
      }
      httpServer.once('error', onListenError)
      httpServer.listen(serverConfig.port, serverConfig.host, () => {
        httpServer.off('error', onListenError)
        const address = httpServer.address()
        if (typeof address === 'object' && address?.port) {
          serverConfig.port = address.port
          serverUrls = formatServerUrls(serverConfig)
        }
        httpServer.on('error', err => {
          logger.error('HTTP server error', err)
        })
        if (!serverConfig.serverToken && (serverConfig.host === '0.0.0.0' || serverConfig.host === '::')) {
          logger.warn('Server is listening on a public interface without SERVER_TOKEN')
        }
        logger.info('Torrgether signaling server started', {
          host: serverConfig.host,
          port: serverConfig.port,
          urls: serverUrls,
        corsOrigin: serverConfig.corsOrigin,
        tokenRequired: Boolean(serverConfig.serverToken),
        authRateLimitMaxAttempts,
        authRateLimitWindowMs,
        maxHttpBufferSize,
        logPath: logger.filePath
      })
        resolve()
      })
    })
  } catch (err) {
    if (maintenanceTimer) clearInterval(maintenanceTimer)
    try { await logger.close?.() } catch {}
    throw err
  }

  return handle
}

if (isCliEntryPoint()) {
  let serverHandle = null
  let shuttingDown = false

  const shutdown = async exitCode => {
    if (shuttingDown) return
    shuttingDown = true
    try {
      await serverHandle?.close?.()
    } catch (err) {
      serverHandle?.logger?.error?.('Server shutdown error', err)
      process.exitCode = 1
    }
    process.exit(exitCode ?? process.exitCode ?? 0)
  }

  process.on('unhandledRejection', err => {
    serverHandle?.logger?.error?.('Unhandled server rejection', err)
  })

  process.on('uncaughtException', err => {
    serverHandle?.logger?.error?.('Uncaught server exception', err)
    shutdown(1).catch(() => process.exit(1))
  })

  process.on('SIGINT', () => shutdown(0).catch(() => process.exit(1)))
  process.on('SIGTERM', () => shutdown(0).catch(() => process.exit(1)))

  try {
    serverHandle = await startSignalingServer()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}
