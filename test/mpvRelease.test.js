import test from 'node:test'
import assert from 'node:assert/strict'
import { findSha256ForAsset, selectWindowsMpvAsset } from '../build/mpv-release.js'

test('selects compatible Windows MPV x86_64 release asset', () => {
  const release = {
    assets: [
      { name: 'mpv-x86_64-v3-20260504-git-abc123.7z', browser_download_url: 'https://example.invalid/v3.7z' },
      { name: 'mpv-dev-x86_64-20260504-git-abc123.7z', browser_download_url: 'https://example.invalid/dev.7z' },
      { name: 'mpv-x86_64-20260504-git-abc123.7z', browser_download_url: 'https://example.invalid/mpv.7z' },
      { name: 'sha256.txt', browser_download_url: 'https://example.invalid/sha256.txt' }
    ]
  }

  assert.deepEqual(selectWindowsMpvAsset(release), {
    name: 'mpv-x86_64-20260504-git-abc123.7z',
    url: 'https://example.invalid/mpv.7z',
    checksumName: 'sha256.txt',
    checksumUrl: 'https://example.invalid/sha256.txt'
  })
})

test('finds sha256 entry for release asset', () => {
  const text = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  mpv-x86_64-v3-20260504-git-abc123.7z',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *mpv-x86_64-20260504-git-abc123.7z'
  ].join('\n')

  assert.equal(
    findSha256ForAsset(text, 'mpv-x86_64-20260504-git-abc123.7z'),
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )
})
