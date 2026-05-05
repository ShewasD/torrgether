import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMagnetUrl,
  isRutrackerTopLevelUrl,
  isTorrentDownload,
  validateTorrentDownloadSize,
  importNameForTorrent
} from '../desktop/rutracker.js'

test('rutracker allowlist accepts only rutracker top-level navigation', () => {
  assert.equal(isRutrackerTopLevelUrl('https://rutracker.org/forum/index.php'), true)
  assert.equal(isRutrackerTopLevelUrl('http://rutracker.org/forum/tracker.php'), true)
  assert.equal(isRutrackerTopLevelUrl('https://static.rutracker.org/assets/app.js'), true)
  assert.equal(isRutrackerTopLevelUrl('https://evilrutracker.org/forum/index.php'), false)
  assert.equal(isRutrackerTopLevelUrl('https://rutracker.org.evil.test/forum/index.php'), false)
  assert.equal(isRutrackerTopLevelUrl('file:///tmp/rutracker.html'), false)
})

test('detects magnet URLs', () => {
  assert.equal(isMagnetUrl('magnet:?xt=urn:btih:abc'), true)
  assert.equal(isMagnetUrl(' MAGNET:?xt=urn:btih:abc'), true)
  assert.equal(isMagnetUrl('https://rutracker.org/forum/viewtopic.php?t=1'), false)
})

test('detects torrent downloads by filename or supported torrent MIME', () => {
  assert.equal(isTorrentDownload({ filename: 'movie.torrent', mimeType: 'text/plain' }), true)
  assert.equal(isTorrentDownload({ url: 'https://rutracker.org/forum/dl.php?id=1&name=movie.torrent' }), true)
  assert.equal(isTorrentDownload({ url: 'https://rutracker.org/files/movie.torrent', mimeType: 'application/x-bittorrent' }), true)
  assert.equal(isTorrentDownload({ url: 'https://rutracker.org/files/movie.txt', mimeType: 'application/x-bittorrent' }), false)
})

test('validates torrent download size and derives an import name', () => {
  assert.equal(validateTorrentDownloadSize(10, 10), true)
  assert.equal(validateTorrentDownloadSize(11, 10), false)
  assert.equal(validateTorrentDownloadSize(-1, 10), false)
  assert.equal(validateTorrentDownloadSize(undefined, 10), false)
  assert.equal(importNameForTorrent({ filename: '', url: 'https://rutracker.org/files/demo.torrent' }), 'demo.torrent')
})

test('rejects generic binary MIME without torrent filename', () => {
  assert.equal(isTorrentDownload({ url: 'https://rutracker.org/files/movie.bin', mimeType: 'application/octet-stream' }), false)
  assert.equal(isTorrentDownload({ url: 'https://rutracker.org/files/movie.torrent', mimeType: 'application/octet-stream' }), true)
})
