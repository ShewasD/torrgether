import test from 'node:test'
import assert from 'node:assert/strict'
import { formatServerUrls, getServerConfig, normalizePublicUrl, parseCorsOrigin } from '../shared/config.js'

test('normalizes public URLs and strips trailing slash', () => {
  assert.equal(normalizePublicUrl('watch.example.com/'), 'http://watch.example.com')
  assert.equal(normalizePublicUrl('https://watch.example.com/'), 'https://watch.example.com')
  assert.equal(normalizePublicUrl(''), null)
})

test('parses public server config from environment', () => {
  const config = getServerConfig({
    HOST: '0.0.0.0',
    PORT: '4321',
    PUBLIC_URL: 'https://watch.example.com/',
    CORS_ORIGIN: 'https://app.example.com, https://admin.example.com',
    SERVER_TOKEN: 'secret',
    LOG_LEVEL: 'debug'
  })

  assert.equal(config.host, '0.0.0.0')
  assert.equal(config.port, 4321)
  assert.equal(config.publicUrl, 'https://watch.example.com')
  assert.deepEqual(config.corsOrigin, ['https://app.example.com', 'https://admin.example.com'])
  assert.equal(config.serverToken, 'secret')
  assert.equal(config.logLevel, 'debug')
})

test('formats local and public server URLs', () => {
  assert.deepEqual(formatServerUrls({ host: '0.0.0.0', port: 3000, publicUrl: 'https://watch.example.com' }), {
    localUrl: 'http://localhost:3000',
    bindUrl: 'http://0.0.0.0:3000',
    publicUrl: 'https://watch.example.com',
    displayUrl: 'https://watch.example.com'
  })
})

test('parses wildcard and comma separated CORS origins', () => {
  assert.equal(parseCorsOrigin('*'), '*')
  assert.deepEqual(parseCorsOrigin('https://a.test,https://b.test'), ['https://a.test', 'https://b.test'])
})
