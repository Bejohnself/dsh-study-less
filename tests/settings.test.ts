import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultSettings, normalizeSettings, patchSettings, settingsView } from '../src/core/settings.ts'

test('settings mask secrets', () => {
  const settings = normalizeSettings({
    text: { kind: 'openai-compatible', baseURL: 'https://example.test/v1', model: 'm', apiKey: 'secret' },
  })
  const view = settingsView(settings)
  assert.equal(view.text.apiKeySet, true)
  assert.equal('apiKey' in view.text, false)
})

test('omitted key is preserved, empty key clears it', () => {
  const base = patchSettings(defaultSettings(), {
    text: { kind: 'openai-compatible', baseURL: 'https://example.test/v1', model: 'm', apiKey: 'secret' },
  })
  const kept = patchSettings(base, { text: { model: 'm2' } })
  assert.equal(kept.text.apiKey, 'secret')
  assert.equal(kept.text.model, 'm2')
  const cleared = patchSettings(base, { text: { apiKey: '' } })
  assert.equal(cleared.text.apiKey, undefined)
})

test('study preferences are clamped', () => {
  const settings = normalizeSettings({
    study: { targetRetention: 3, maxIntervalDays: 99999, dailyNewUnits: -1 },
  })
  assert.equal(settings.study.targetRetention, 0.99)
  assert.equal(settings.study.maxIntervalDays, 3650)
  assert.equal(settings.study.dailyNewUnits, 0)
})

test('study preferences keep the panel toggle', () => {
  assert.equal(normalizeSettings({}).study.showInsights, true)
  const off = patchSettings(defaultSettings(), { study: { showInsights: false } })
  assert.equal(off.study.showInsights, false)
  assert.equal(settingsView(off).study.showInsights, false)
  // An omitted field in a later patch must not flip it back.
  assert.equal(patchSettings(off, {}).study.showInsights, false)
})
