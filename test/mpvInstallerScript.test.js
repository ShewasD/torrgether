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
