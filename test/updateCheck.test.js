import test from 'node:test'
import assert from 'node:assert/strict'
import { checkForUpdates, compareVersions, normalizeUpdateRepo, selectReleaseAssets } from '../desktop/updateCheck.js'

test('compares semantic versions', () => {
  assert.equal(compareVersions('0.3.1', '0.3.0'), 1)
  assert.equal(compareVersions('v0.3.0', '0.3.0'), 0)
  assert.equal(compareVersions('0.2.9', '0.3.0'), -1)
})

test('normalizes update repository and release assets', () => {
  assert.equal(normalizeUpdateRepo('https://github.com/ShewasD/torrgether'), 'ShewasD/torrgether')
  const assets = selectReleaseAssets([
    { name: 'Torrgether-Setup-0.3.0.exe', browser_download_url: 'https://example.test/win.exe' },
    { name: 'Torrgether-0.3.0.AppImage', browser_download_url: 'https://example.test/appimage' },
    { name: 'Torrgether-0.3.0.deb', browser_download_url: 'https://example.test/deb' }
  ])
  assert.equal(assets.windows.url, 'https://example.test/win.exe')
  assert.equal(assets.appImage.url, 'https://example.test/appimage')
  assert.equal(assets.deb.url, 'https://example.test/deb')
})

test('update check reports latest release and preferred asset', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tag_name: 'v0.3.1',
      html_url: 'https://github.com/ShewasD/torrgether/releases/tag/v0.3.1',
      assets: [
        { name: 'Torrgether-Setup-0.3.1.exe', browser_download_url: 'https://example.test/win.exe' }
      ]
    })
  })

  const result = await checkForUpdates({ currentVersion: '0.3.0', fetchImpl, platform: 'win32' })
  assert.equal(result.updateAvailable, true)
  assert.equal(result.preferredAsset.name, 'Torrgether-Setup-0.3.1.exe')
})

test('update check handles repositories without releases', async () => {
  const result = await checkForUpdates({
    currentVersion: '0.3.0',
    fetchImpl: async () => ({ ok: false, status: 404 }),
    platform: 'linux'
  })
  assert.equal(result.ok, true)
  assert.equal(result.updateAvailable, false)
})
