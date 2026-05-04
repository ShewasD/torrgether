import test from 'node:test'
import assert from 'node:assert/strict'
import { getMpvCandidates } from '../desktop/mpvPaths.js'

test('builds Windows MPV candidates from common install locations', () => {
  const candidates = getMpvCandidates({
    platform: 'win32',
    appDir: 'C:\\App',
    resourcesPath: 'C:\\App\\resources',
    execPath: 'C:\\App\\Torrgether.exe',
    env: {
      MPV_PATH: 'D:\\Tools\\mpv.exe',
      USERPROFILE: 'C:\\Users\\Alice',
      ChocolateyInstall: 'C:\\ProgramData\\chocolatey',
      ProgramData: 'C:\\ProgramData',
      LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)'
    }
  })

  assert.equal(candidates[0], 'D:\\Tools\\mpv.exe')
  assert.ok(candidates.includes('C:\\App\\resources\\bin\\mpv.exe'))
  assert.ok(candidates.includes('C:\\App\\bin\\mpv.exe'))
  assert.ok(candidates.includes('mpv.exe'))
  assert.ok(candidates.includes('C:\\Users\\Alice\\scoop\\shims\\mpv.exe'))
  assert.ok(candidates.includes('C:\\ProgramData\\chocolatey\\bin\\mpv.exe'))
  assert.ok(candidates.includes('C:\\Program Files\\mpv\\mpv.exe'))
})

test('builds Unix MPV candidates', () => {
  const candidates = getMpvCandidates({
    platform: 'linux',
    appDir: '/app',
    resourcesPath: '/app/resources',
    execPath: '/opt/Torrgether/torrgether',
    env: {}
  })

  assert.equal(candidates[0], '/app/resources/bin/mpv')
  assert.ok(candidates.includes('/opt/Torrgether/bin/mpv'))
  assert.ok(candidates.includes('/app/bin/mpv'))
  assert.ok(candidates.includes('mpv'))
  assert.ok(candidates.includes('/usr/bin/mpv'))
  assert.ok(candidates.includes('/app/mpv'))
})
