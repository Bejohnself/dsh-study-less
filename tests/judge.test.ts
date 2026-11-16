import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectivePass, gateStatus, isSelfJudged, normalizeVerdict } from '../src/core/planGate.ts'
import type { PlanRecord, SufficiencyItem } from '../src/core/types.ts'

function plan(patch: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'p',
    goal: 'g',
    status: 'active',
    steps: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

function item(patch: Partial<SufficiencyItem> = {}): SufficiencyItem {
  return { id: 'q1', q: '能推出 Eq.12 吗？', ...patch }
}

test('a low-confidence pass is downgraded to partial', () => {
  assert.equal(normalizeVerdict('pass', 0.9), 'pass')
  assert.equal(normalizeVerdict('pass', 0.4), 'partial')
  assert.equal(normalizeVerdict('PASS', undefined), 'pass')
  assert.equal(normalizeVerdict('maybe', 0.99), 'partial')
  assert.equal(normalizeVerdict(undefined, 0.99), 'partial')
  assert.equal(normalizeVerdict('fail', 0.2), 'fail')
})

test('a pass needs a verdict or an explicit self evaluation', () => {
  assert.equal(effectivePass(item({ verdict: 'pass' })), true)
  assert.equal(effectivePass(item({ verdict: 'partial' })), false)
  assert.equal(effectivePass(item({ selfPass: true, verdict: 'fail' })), true)
  assert.equal(effectivePass(item({ passed: true })), false, 'a bare passed flag is not enough')
})

test('self evaluation is detected and counted separately', () => {
  assert.equal(isSelfJudged(item({ selfPass: true })), true)
  assert.equal(isSelfJudged(item({ verdict: 'pass' })), false)
  assert.equal(isSelfJudged(item({ passed: true })), true)
})

test('the gate reports how many passes were self judged', () => {
  const status = gateStatus(
    plan({
      deliverable: 'derive section 3',
      attempts: [1, 2, 3].map(index => ({
        id: 'a' + String(index),
        move: 'assumption' as const,
        what: 'tried',
        provenance: 'independent' as const,
        at: '2026-02-0' + String(index) + 'T00:00:00.000Z',
      })),
      sufficiency: [
        item({ id: 'a', answer: '写出推导', verdict: 'pass' }),
        item({ id: 'b', answer: '我的答案', selfPass: true, verdict: 'fail' }),
      ],
    }),
  )
  assert.equal(status.passed, 2)
  assert.equal(status.aiJudged, 1)
  assert.equal(status.selfJudged, 1)
  assert.equal(status.ready, true)
})

test('a pass without a written answer blocks closing', () => {
  const status = gateStatus(
    plan({
      deliverable: 'x',
      attempts: [1, 2, 3].map(index => ({
        id: 'a' + String(index),
        move: 'assumption' as const,
        what: 'tried',
        provenance: 'independent' as const,
        at: '2026-02-0' + String(index) + 'T00:00:00.000Z',
      })),
      sufficiency: [item({ verdict: 'pass' })],
    }),
  )
  assert.equal(status.ready, false)
  assert.match(status.reasons.join(' '), /没有留下答案/)
})
