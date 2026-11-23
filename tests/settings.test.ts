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

test('quick actions default to one editable example and survive nesting', () => {
  const fresh = defaultSettings()
  assert.equal(fresh.study.quickActions.length, 1)
  assert.equal(fresh.study.quickActions[0]?.label, '翻译')
  // A stored document without the field gets the same example, not an empty bar.
  assert.equal(normalizeSettings({}).study.quickActions[0]?.label, '翻译')
  // An explicit empty array is the user deleting them all.
  assert.deepEqual(normalizeSettings({ study: { quickActions: [] } }).study.quickActions, [])
})

test('quick actions are trimmed, capped at three and keep their order', () => {
  const settings = normalizeSettings({
    study: {
      quickActions: [
        { label: ' 翻译 ', prompt: ' 翻成中文 ' },
        { label: '解释', prompt: '用一句普通话解释' },
        { label: '找假设', prompt: '找出隐含假设' },
        { label: '第四个', prompt: '不该出现' },
      ],
    },
  })
  assert.deepEqual(settings.study.quickActions, [
    { label: '翻译', prompt: '翻成中文' },
    { label: '解释', prompt: '用一句普通话解释' },
    { label: '找假设', prompt: '找出隐含假设' },
  ])
})

test('quick actions drop empty slots and clamp lengths', () => {
  const settings = normalizeSettings({
    study: {
      quickActions: [
        { label: '', prompt: '没有按钮名' },
        { label: '只有名字' },
        { label: '长'.repeat(20), prompt: '提'.repeat(500) },
      ],
    },
  })
  assert.equal(settings.study.quickActions.length, 1)
  assert.equal(settings.study.quickActions[0]?.label.length, 6)
  assert.equal(settings.study.quickActions[0]?.prompt.length, 400)
})

test('a later study patch replaces the action list', () => {
  const base = defaultSettings()
  const patched = patchSettings(base, { study: { quickActions: [{ label: '翻译', prompt: '译成中文' }] } })
  assert.deepEqual(patched.study.quickActions, [{ label: '翻译', prompt: '译成中文' }])
  const cleared = patchSettings(patched, { study: { quickActions: [] } })
  assert.deepEqual(cleared.study.quickActions, [])
})
