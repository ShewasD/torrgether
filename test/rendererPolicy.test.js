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
  assert.equal(renderer.includes('renderSelectedSource(results[0])'), false)
})
