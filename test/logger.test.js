import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { createLogger, redactForLog } from '../shared/logger.js'

test('redacts sensitive values before logging', () => {
  const redacted = redactForLog({
    magnetURI: 'magnet:?xt=urn:btih:abcdef&dn=Example',
    base64: 'a'.repeat(160),
    serverToken: 'super-secret',
    url: 'https://example.test/?serverToken=super-secret',
    path: 'C:\\Users\\Alice\\Videos\\movie.mkv'
  }, '', {
    SERVER_TOKEN: 'super-secret',
    USERPROFILE: 'C:\\Users\\Alice'
  })

  assert.equal(redacted.magnetURI, 'magnet:?[redacted]')
  assert.equal(redacted.base64, '[redacted:base64:160]')
  assert.equal(redacted.serverToken, '[redacted]')
  assert.equal(redacted.url, 'https://example.test/?serverToken=[redacted]')
  assert.equal(redacted.path, '~\\Videos\\movie.mkv')
})

test('redacts errors without losing useful diagnostics', () => {
  const err = new Error('failed magnet:?xt=urn:btih:abcdef')
  err.code = 'ERR_TEST'

  const redacted = redactForLog(err)

  assert.equal(redacted.name, 'Error')
  assert.equal(redacted.code, 'ERR_TEST')
  assert.match(redacted.message, /magnet:\?\[redacted\]/)
})

test('async logger writes redacted lines and flushes on close', async () => {
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'torrgether-logger-'))
  const logger = createLogger({
    name: 'test',
    fileName: 'test.log',
    logDir,
    consoleOutput: false
  })

  logger.info('hello', { serverToken: 'super-secret', path: path.join(os.homedir(), 'movie.mkv') })
  await logger.close()

  const content = await fs.readFile(logger.filePath, 'utf8')
  assert.match(content, /hello/)
  assert.match(content, /\[redacted\]/)
  assert.doesNotMatch(content, /super-secret/)
})

test('redacts health snapshots without losing diagnostics', () => {
  const redacted = redactForLog({
    health: {
      signalingServer: {
        url: 'https://watch.example.test/?serverToken=super-secret',
        token: 'super-secret'
      },
      torrent: {
        magnetURI: 'magnet:?xt=urn:btih:abcdef&dn=Example',
        ram: { bytes: 1024, overLimitBytes: 0 }
      }
    }
  }, '', { SERVER_TOKEN: 'super-secret' })

  assert.equal(redacted.health.signalingServer.url, 'https://watch.example.test/?serverToken=[redacted]')
  assert.equal(redacted.health.signalingServer.token, '[redacted]')
  assert.equal(redacted.health.torrent.magnetURI, 'magnet:?[redacted]')
  assert.equal(redacted.health.torrent.ram.bytes, 1024)
})
