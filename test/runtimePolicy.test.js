import test from 'node:test'
import assert from 'node:assert/strict'
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
