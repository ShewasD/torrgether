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
