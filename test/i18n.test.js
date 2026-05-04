import test from 'node:test'
import assert from 'node:assert/strict'
import { locales, normalizeLocale, resolveInitialLocale, translate } from '../renderer/i18n.js'

test('all locales expose the same translation keys', () => {
  const baseKeys = Object.keys(locales.en).sort()
  for (const [locale, dictionary] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(dictionary).sort(), baseKeys, locale)
  }
})

test('system locale resolves to supported app locales', () => {
  assert.equal(normalizeLocale('ru-RU'), 'ru')
  assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-CN')
  assert.equal(normalizeLocale('ja-JP'), 'ja')
  assert.equal(normalizeLocale('fr-FR'), 'en')
})

test('stored locale wins and unsupported locales fall back to English', () => {
  assert.equal(resolveInitialLocale({ storedLocale: 'ja', systemLocale: 'ru-RU' }), 'ja')
  assert.equal(resolveInitialLocale({ storedLocale: 'de', systemLocale: 'ru-RU' }), 'ru')
  assert.equal(translate('de', 'room.title'), 'Room')
  assert.equal(translate('ru', 'status.online', { id: 'abc' }), 'онлайн (abc)')
})
