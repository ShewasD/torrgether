import fs from 'fs'
import os from 'os'
import path from 'path'

const LEVELS = new Map([
  ['debug', 10],
  ['info', 20],
  ['warn', 30],
  ['error', 40]
])

function normalizeLevel(level) {
  const value = String(level || '').toLowerCase()
  return LEVELS.has(value) ? value : 'info'
}

export function defaultLogDir(env = process.env, platform = process.platform) {
  if (env.LOG_DIR) return path.resolve(env.LOG_DIR)

  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(base, 'Torrgether', 'logs')
  }

  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Logs', 'Torrgether')

  const stateHome = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state')
  return path.join(stateHome, 'torrgether', 'logs')
}

export function redactPath(value, env = process.env) {
  let result = String(value || '')
  const home = os.homedir()
  if (home) result = result.split(home).join('~')
  if (env.USERPROFILE) result = result.split(env.USERPROFILE).join('~')
  if (env.HOME) result = result.split(env.HOME).join('~')
  return result
}

function redactPathList(value, env = process.env) {
  const items = String(value || '').split(path.delimiter).filter(Boolean)
  const head = items.slice(0, 8).map(item => redactPath(item, env))
  if (items.length > head.length) head.push(`[${items.length - head.length} more entries redacted]`)
  return head.join(path.delimiter)
}

function redactString(value, key = '', env = process.env) {
  const keyLower = String(key || '').toLowerCase()
  if (keyLower.includes('token') || keyLower.includes('secret') || keyLower.includes('password')) {
    return value ? '[redacted]' : ''
  }
  if (keyLower.includes('base64')) return value ? `[redacted:base64:${String(value).length}]` : ''
  if (keyLower === 'path' || keyLower.endsWith('path') || keyLower.includes('filepath')) {
    return redactPath(value, env)
  }
  if (keyLower.includes('pathenv')) return redactPathList(value, env)

  let result = String(value)
  const serverToken = env.SERVER_TOKEN
  if (serverToken) result = result.split(serverToken).join('[redacted]')
  result = result.replace(/magnet:\?[^\s"'<>]+/gi, 'magnet:?[redacted]')
  result = result.replace(/([?&](?:token|serverToken|auth)=)[^&\s"'<>]+/gi, '$1[redacted]')
  if (/^[A-Za-z0-9+/=]{120,}$/.test(result)) return `[redacted:base64:${result.length}]`
  return redactPath(result, env)
}

export function redactForLog(value, key = '', env = process.env, seen = new WeakSet()) {
  if (value == null) return value
  if (typeof value === 'string') return redactString(value, key, env)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, 'message', env),
      code: value.code,
      stack: value.stack ? redactString(value.stack, 'stack', env) : undefined
    }
  }
  if (Buffer.isBuffer(value)) return `[redacted:buffer:${value.length}]`
  if (Array.isArray(value)) return value.map(item => redactForLog(item, key, env, seen))
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const result = {}
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[entryKey] = redactForLog(entryValue, entryKey, env, seen)
    }
    seen.delete(value)
    return result
  }
  return String(value)
}

export function createLogger({
  name,
  fileName = `${name}.log`,
  logDir = defaultLogDir(),
  level = process.env.LOG_LEVEL,
  consoleOutput = true,
  env = process.env
}) {
  const effectiveLevel = normalizeLevel(level)
  const threshold = LEVELS.get(effectiveLevel)
  fs.mkdirSync(logDir, { recursive: true })
  const filePath = path.join(logDir, fileName)
  const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' })
  let streamClosed = false

  stream.on('error', err => {
    if (consoleOutput) console.error(`[logger:${name}] failed to write ${filePath}: ${err.message}`)
  })

  function shouldLog(messageLevel) {
    return LEVELS.get(messageLevel) >= threshold
  }

  function write(messageLevel, message, data) {
    if (!shouldLog(messageLevel)) return
    const payload = {
      ts: new Date().toISOString(),
      level: messageLevel,
      name,
      message: redactForLog(message, 'message', env)
    }
    if (data !== undefined) payload.data = redactForLog(data, '', env)
    const line = JSON.stringify(payload)
    if (!streamClosed && !stream.destroyed) stream.write(`${line}\n`)
    if (consoleOutput) {
      const consoleLine = `[${payload.ts}] [${messageLevel}] [${name}] ${payload.message}`
      const target = messageLevel === 'error' ? console.error : messageLevel === 'warn' ? console.warn : console.log
      target(data === undefined ? consoleLine : `${consoleLine} ${JSON.stringify(payload.data)}`)
    }
  }

  function flush() {
    if (streamClosed || stream.destroyed) return Promise.resolve()
    return new Promise(resolve => stream.write('', resolve))
  }

  async function close() {
    if (streamClosed) return
    await flush()
    await new Promise(resolve => stream.end(resolve))
    streamClosed = true
  }

  return {
    name,
    level: effectiveLevel,
    dir: logDir,
    filePath,
    debug: (message, data) => write('debug', message, data),
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, data) => write('error', message, data),
    flush,
    close
  }
}
