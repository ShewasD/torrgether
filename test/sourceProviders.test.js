import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupeSourceResults, fetchSourceTorrent, normalizeContentLanguage, searchSources } from '../desktop/sourceProviders.js'

test('deduplicates source results by info hash and keeps variants', () => {
  const results = dedupeSourceResults([
    { id: 'a', providerId: 'one', title: 'Demo', infoHash: 'ABC', seeders: 1 },
    { id: 'b', providerId: 'two', title: 'Demo copy', infoHash: 'abc', seeders: 4 }
  ])

  assert.equal(results.length, 1)
  assert.equal(results[0].seeders, 4)
  assert.equal(results[0].variants.length, 2)
})

test('normalizes content language choices', () => {
  assert.equal(normalizeContentLanguage('ja-JP'), 'ja')
  assert.equal(normalizeContentLanguage(''), 'any')
})

test('source search falls back when requested audio language has no matches', async () => {
  const response = await searchSources('sintel', { language: 'ja' }, async () => ({ ok: false, status: 503 }))
  assert.equal(response.ok, true)
  assert.equal(response.languageFallback, true)
  assert.ok(response.results.length > 0)
})

test('fetchSourceTorrent returns RAM payload and enforces size', async () => {
  const response = {
    ok: true,
    headers: new Map([['content-length', '4']]),
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
  }
  const payload = await fetchSourceTorrent({ title: 'Demo', torrentUrl: 'https://example.test/demo.torrent' }, async () => response, { maxBytes: 8 })
  assert.equal(payload.kind, 'torrent-file')
  assert.equal(payload.name, 'Demo.torrent')
  assert.equal(payload.base64, 'AQIDBA==')

  await assert.rejects(
    () => fetchSourceTorrent({ title: 'Demo', torrentUrl: 'https://example.test/demo.torrent' }, async () => response, { maxBytes: 2 }),
    /too large/
  )
})

test('fetchSourceTorrent enforces streamed size limits', async () => {
  const response = {
    ok: true,
    headers: new Map(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
        controller.close()
      }
    })
  }

  await assert.rejects(
    () => fetchSourceTorrent({ title: 'Demo', torrentUrl: 'https://example.test/demo.torrent' }, async () => response, { maxBytes: 3 }),
    /too large/
  )
})

test('searchSources tolerates source provider timeout failures', async () => {
  const response = await searchSources('sintel', { language: 'any' }, async () => {
    throw new Error('timeout')
  })

  assert.equal(response.ok, true)
  assert.ok(response.results.length > 0)
})
