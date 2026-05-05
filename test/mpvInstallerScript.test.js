import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Windows MPV installer handles PowerShell 5 web responses and wildcard copy', async () => {
  const script = await readFile(new URL('../build/install-mpv.ps1', import.meta.url), 'utf8')

  assert.match(script, /UseBasicParsing\s*=\s*\$true/)
  assert.match(script, /Convert-ResponseContentToText/)
  assert.match(script, /\$Content\s+-is\s+\[byte\[\]\]/)
  assert.match(script, /Copy-Item\s+-Path\s+\(Join-Path \$mpvSourceDir '\*'\)/)
})

test('release workflow bundles MPV before building the Windows installer', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')

  assert.match(workflow, /Bundle MPV runtime/)
  assert.match(workflow, /install-mpv\.ps1 -InstallDir "\$PWD"/)
  assert.match(workflow, /npm run dist:win/)
})
