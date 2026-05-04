import test from 'node:test'
import assert from 'node:assert/strict'
import { parseByteSize, parseMpvStdoutStatus, parseTimecode } from '../desktop/mpvOutput.js'

test('parses MPV cache seconds, bytes, and AV time', () => {
  const parsed = parseMpvStdoutStatus('AV: 00:06:54 / 02:10:03 (5%) A-V: 0.000 Cache: 0.3s/973KB')

  assert.equal(parsed.timePos, 414)
  assert.equal(parsed.cacheSeconds, 0.3)
  assert.equal(parsed.cacheBytes, 996352)
  assert.equal(parsed.cacheText, 'Cache: 0.3s/973KB')
})

test('uses the latest status from multiline MPV output', () => {
  const parsed = parseMpvStdoutStatus([
    'AV: 00:06:53 / 02:10:03 Cache: 0.5s/1MB',
    'AV: 00:06:54 / 02:10:03 Cache: 0.0s/21KB'
  ].join('\n'))

  assert.equal(parsed.timePos, 414)
  assert.equal(parsed.cacheSeconds, 0)
  assert.equal(parsed.cacheBytes, 21 * 1024)
})

test('parses common timecode and byte units', () => {
  assert.equal(parseTimecode('01:02:03.5'), 3723.5)
  assert.equal(parseTimecode('02:03'), 123)
  assert.equal(parseByteSize('1.5', 'MB'), 1572864)
  assert.equal(parseByteSize('2', 'GB'), 2147483648)
})
