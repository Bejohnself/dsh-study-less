import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryPaths } from '../src/core/paths.ts'
import { readUsage, recordUsage } from '../src/core/usage.ts'
import { SettingsService } from '../src/host/settings.ts'
import { UsageService } from '../src/host/usage.ts'

const root = await mkdtemp(join(tmpdir(), 'study-usage-'))
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const paths = new LibraryPaths(root)

test('usage ledger aggregates calls and keeps today separate', async () => {
  const at = new Date().toISOString()
  await recordUsage(paths, { at, inputTokens: 1000, outputTokens: 200, cost: 0.001 })
  await recordUsage(paths, { at, inputTokens: 500, outputTokens: 100 })
  const usage = await readUsage(paths)
  assert.equal(usage.totals.calls, 2)
  assert.equal(usage.totals.inputTokens, 1500)
  assert.equal(usage.totals.outputTokens, 300)
  assert.equal(usage.totals.pricedCalls, 1)
  assert.equal(usage.totals.unpricedCalls, 1)
  assert.equal(usage.totals.cost, 0.001)
  assert.equal(usage.today.calls, 2)
})

test('daily buckets keep one entry per local day', async () => {
  await rm(paths.usageFile, { force: true })
  const now = new Date()
  const yesterday = new Date(now.getTime() - 86_400_000)
  await recordUsage(paths, { at: yesterday.toISOString(), inputTokens: 10, cost: 0.5 })
  await recordUsage(paths, { at: now.toISOString(), inputTokens: 20, cost: 0.25 })
  await recordUsage(paths, { at: now.toISOString(), inputTokens: 20 })
  const usage = await readUsage(paths)
  assert.equal(usage.days.length, 2)
  assert.equal(usage.days[0]?.calls, 1)
  assert.equal(usage.days[1]?.calls, 2)
  assert.equal(usage.days[1]?.cost, 0.25)
  assert.equal(usage.days[1]?.unpricedCalls, 1)
  assert.equal(usage.totals.calls, 3)
})

test('provider cost wins over user prices; user prices are the fallback', async () => {
  await rm(paths.usageFile, { force: true })
  const settings = new SettingsService(paths)
  await settings.patch({ study: { pricing: { currency: 'USD', inputPerMillion: 1, cacheInputPerMillion: 0.2, outputPerMillion: 2 } } })
  const usage = new UsageService(paths, settings)
  const fromApi = await usage.record({ inputTokens: 1000, outputTokens: 200, cost: 0.002, currency: 'USD' })
  assert.equal(fromApi.priceSource, 'api')
  assert.equal(fromApi.cost, 0.002)
  const fromUser = await usage.record({ inputTokens: 1000, cacheReadTokens: 5000, outputTokens: 200 })
  assert.equal(fromUser.priceSource, 'user')
  assert.ok(Math.abs((fromUser.cost ?? 0) - 0.0024) < 1e-9)
  const summary = await usage.summary()
  assert.equal(summary.totals.calls, 2)
  assert.ok(Math.abs(summary.totals.cost - 0.0044) < 1e-9)
  assert.equal(summary.totals.cacheReadTokens, 5000)
})
