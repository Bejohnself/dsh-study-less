import { test } from 'node:test'
import assert from 'node:assert/strict'
import { schedulePluginRestart } from '../src/host/pluginRestart.ts'

test('plugin restart toggles only its own loader entry', async () => {
  const states: boolean[] = []
  const entry = {
    id: 'study-desk',
    options: { id: 'study-desk', name: 'dsh-study-less' },
    async update(patch: { disabled: boolean }) {
      states.push(patch.disabled)
    },
  }
  const loader = {
    locate: () => 'study-desk',
    entries: () => [entry],
  }
  const ctx = {
    fiber: {},
    get(name: string) {
      return name === 'loader' ? loader : undefined
    },
  }
  schedulePluginRestart(ctx, 'dsh-study-less')
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.deepEqual(states, [true, false])
})

test('plugin restart refuses when the host has no loader', () => {
  assert.throws(
    () => schedulePluginRestart({ get: () => undefined }, 'dsh-study-less'),
    /不支持单插件重启/,
  )
})
