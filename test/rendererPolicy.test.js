import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

test('renderer is MPV-only and does not include HTML video playback', async () => {
  const [html, renderer] = await Promise.all([
    fs.readFile(new URL('../renderer/index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../renderer/renderer.js', import.meta.url), 'utf8')
  ])

  assert.equal(html.includes('<video'), false)
  assert.equal(renderer.includes('els.player'), false)
  assert.equal(renderer.includes("addEventListener('play'"), false)
  assert.equal(renderer.includes('MEDIA_ERR_'), false)
  assert.match(renderer, /launchMpv/)
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
