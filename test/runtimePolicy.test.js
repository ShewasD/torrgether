import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { shouldDisableHardwareAcceleration } from '../desktop/gpuPolicy.js'
import { waitForReady } from '../desktop/streamServerReady.js'
import { normalizeServerUrl } from '../shared/clientUrl.js'

test('GPU acceleration is disabled by default only on Linux', () => {
  assert.equal(shouldDisableHardwareAcceleration({ env: {}, platform: 'linux' }), true)
  assert.equal(shouldDisableHardwareAcceleration({ env: {}, platform: 'win32' }), false)
  assert.equal(shouldDisableHardwareAcceleration({ env: {}, platform: 'darwin' }), false)
})

test('GPU env override works on every platform', () => {
  assert.equal(shouldDisableHardwareAcceleration({ env: { TORRGETHER_DISABLE_GPU: '1' }, platform: 'win32' }), true)
  assert.equal(shouldDisableHardwareAcceleration({ env: { TORRGETHER_DISABLE_GPU: '0' }, platform: 'linux' }), false)
})

test('normalizes local development signaling URLs', () => {
  assert.equal(normalizeServerUrl('localhost:3000'), 'http://localhost:3000')
  assert.equal(normalizeServerUrl('127.0.0.1:3000'), 'http://127.0.0.1:3000')
  assert.equal(normalizeServerUrl('192.168.1.55:3000'), 'http://192.168.1.55:3000')
  assert.equal(normalizeServerUrl('https://watch.example.com/'), 'https://watch.example.com')
})

test('rejects unsupported signaling URL protocols', () => {
  assert.throws(() => normalizeServerUrl('file:///tmp/socket'), /http:\/\/ or https:\/\//)
})

test('stream-server wait resolves, rejects startup errors, and times out cleanly', async () => {
  await waitForReady({
    isReady: () => true,
    timeoutMs: 20
  })

  await assert.rejects(
    waitForReady({
      isReady: () => false,
      getError: () => new Error('listen failed'),
      timeoutMs: 20
    }),
    /listen failed/
  )

  await assert.rejects(
    waitForReady({
      isReady: () => false,
      readyPromise: new Promise(() => {}),
      timeoutMs: 5
    }),
    /Timed out/
  )
})

test('desktop runtime uses bounded RAM-only stream defaults', async () => {
  const main = await fs.readFile(new URL('../desktop/main.js', import.meta.url), 'utf8')

  assert.match(main, /MPV_CACHE_SECS = process\.env\.MPV_CACHE_SECS \|\| '10'/)
  assert.match(main, /MPV_DEMUXER_MAX_BYTES = process\.env\.MPV_DEMUXER_MAX_BYTES \|\| '24MiB'/)
  assert.match(main, /MPV_DEMUXER_MAX_BACK_BYTES = process\.env\.MPV_DEMUXER_MAX_BACK_BYTES \|\| '8MiB'/)
  assert.match(main, /WEBTORRENT_MAX_CONNS = Number\(process\.env\.WEBTORRENT_MAX_CONNS \|\| 30\)/)
  assert.match(main, /--cache-on-disk=no/)
  assert.equal(main.includes('--cache-backbuffer='), false)
  assert.match(main, /STREAM_RANGE_MAX_BYTES/)
  assert.match(main, /TORRENT_READY_TIMEOUT_MS/)
  assert.match(main, /Timed out waiting for torrent metadata/)
  assert.match(main, /MPV_LOW_CACHE_THRESHOLD_SECONDS/)
  assert.match(main, /MPV_LOW_CACHE_EVENT_INTERVAL_MS/)
  assert.match(main, /MPV_STDIO_LOG_INTERVAL_MS/)
  assert.match(main, /queueMpvStdioLog/)
  assert.match(main, /clearMpvStdioLogTimer\(\{ flush: true \}\)/)
  assert.match(main, /ramRescans/)
  assert.match(main, /taskkill/)
  assert.match(main, /MPV_FULLSCREEN = \['1', 'true', 'yes'\]/)
  assert.match(main, /env: process\.env/)
  assert.equal(main.includes("'--msg-level=all=v',"), false)
})
