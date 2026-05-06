import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

test('renderer exposes embedded fallback and MPV controls', async () => {
  const [html, renderer] = await Promise.all([
    fs.readFile(new URL('../renderer/index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../renderer/renderer.js', import.meta.url), 'utf8')
  ])

  assert.match(html, /<video id="embeddedPlayer"/)
  assert.equal(renderer.includes('MEDIA_ERR_'), false)
  assert.match(renderer, /embeddedPlayer\?\.addEventListener\('play'/)
  assert.match(renderer, /startEmbeddedPlayer/)
  assert.match(renderer, /launchMpv/)
})

test('renderer does not block torrent loading when MPV is missing', async () => {
  const renderer = await fs.readFile(new URL('../renderer/renderer.js', import.meta.url), 'utf8')

  assert.match(renderer, /chooseTorrentBtn\) els\.chooseTorrentBtn\.disabled = !state\.isHost/)
  assert.match(renderer, /setMagnetBtn\) els\.setMagnetBtn\.disabled = !state\.isHost/)
  assert.equal(renderer.includes('detailImportBtn) els.detailImportBtn.disabled = !state.isHost || !state.selectedSourceResult || !isPlayableResult(state.selectedSourceResult) || !hasMpv'), false)
  assert.match(renderer, /MPV unavailable/)
})

test('renderer avoids stale catalog and torrent payload hazards', async () => {
  const renderer = await fs.readFile(new URL('../renderer/renderer.js', import.meta.url), 'utf8')

  assert.match(renderer, /crypto\.subtle\.digest\('SHA-256'/)
  assert.equal(renderer.includes('base64.slice(0, 120)'), false)
  assert.equal(renderer.includes('payload.selectedFileIndex ='), false)
  assert.match(renderer, /sourceSearchGeneration/)
  assert.match(renderer, /safePosterUrl/)
  assert.match(renderer, /emitTorrentPayloadGet/)
  assert.equal(renderer.includes('renderSelectedSource(results[0])'), false)
})

test('renderer throttles playback sync and deduplicates joins', async () => {
  const renderer = await fs.readFile(new URL('../renderer/renderer.js', import.meta.url), 'utf8')

  assert.match(renderer, /function playbackDriftThreshold/)
  assert.match(renderer, /source === 'snapshot'\) return 4\.0/)
  assert.match(renderer, /roomState\?\.reason === 'heartbeat'\) return 2\.0/)
  assert.match(renderer, /isDuplicatePlaybackState/)
  assert.match(renderer, /joinInFlight/)
  assert.match(renderer, /activeRoomKey/)
  assert.match(renderer, /applyPlayback\(snapshot\.state, \{ source: 'snapshot' \}\)/)
})

test('renderer HTML keeps diagnostics out of Watch and avoids duplicate IDs', async () => {
  const html = await fs.readFile(new URL('../renderer/index.html', import.meta.url), 'utf8')
  const renderer = await fs.readFile(new URL('../renderer/renderer.js', import.meta.url), 'utf8')
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1])
  assert.equal(ids.length, new Set(ids).size)
  assert.match(html, /id="homeWorkspace"/)
  assert.match(html, /id="watchWorkspace"/)
  assert.match(html, /id="settingsWorkspace"[\s\S]*id="log"/)
  const watchMarkup = html.match(/id="watchWorkspace"[\s\S]*id="settingsWorkspace"/)?.[0] || ''
  assert.match(watchMarkup, /id="embeddedPlayer"/)
  assert.match(watchMarkup, /id="hostControls"/)
  assert.doesNotMatch(watchMarkup, /id="log"|id="mpvLog"|stats-grid|rutrackerViewport|serverUrl|serverToken/)
  assert.doesNotMatch(renderer, /catalogSourceTab|manualSourceTab|rutrackerSourceTab|rightTorrentsPanel|rightMembersPanel/)
  assert.doesNotMatch(html, /<\/main>\s*<\/section>/)
})

test('preload exposes only named socket commands and whitelisted subscriptions', async () => {
  const preload = await fs.readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8')
  assert.match(preload, /ALLOWED_RENDERER_SOCKET_EVENTS/)
  assert.match(preload, /emitTorrentPayloadGet/)
  assert.equal(preload.includes('socketEmit(event'), false)
  assert.equal(preload.includes('_socketEmitAck(event'), false)
  assert.equal(preload.includes('socket.removeAllListeners()'), false)
  assert.match(preload, /internalSocketHandlers/)
})
