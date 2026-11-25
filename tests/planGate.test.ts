import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverageOf, planProgress, summarizeBoundary, thresholdOf } from '../src/core/planGate.ts'
import { nextStep } from '../src/core/plans.ts'
import type { PlanRecord, PlanStep } from '../src/core/types.ts'

function step(n: number, patch: Partial<PlanStep> = {}): PlanStep {
  return {
    n,
    kind: 'unit',
    target: 'm:' + String(n),
    why: 'because',
    ...patch,
  }
}

function plan(patch: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'p',
    goal: 'understand',
    status: 'active',
    steps: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

function rangeOf(pageStart: number, pageEnd: number) {
  return () => ({ pageStart, pageEnd })
}

test('an absent coverage reads as read, so old plans keep working', () => {
  assert.equal(coverageOf(step(1)), 'read')
  assert.equal(coverageOf(step(1, { coverage: 'skip' })), 'skip')
})

test('skipped ranges stay out of the denominator and the next step', () => {
  const value = plan({
    steps: [
      step(1, { coverage: 'skip', skipReason: 'exam scope ends here' }),
      step(2, { coverage: 'skim' }),
      step(3),
    ],
  })
  assert.deepEqual(planProgress(value, () => false), { done: 0, total: 2 })
  const next = nextStep(value)
  assert.equal(next?.n, 3)
})

test('legacy drill and compare steps are not route obligations', () => {
  const value = plan({
    steps: [
      step(1),
      step(2, { kind: 'drill', concepts: ['x'] }),
      step(3, { kind: 'compare', materials: ['a', 'b'] }),
    ],
  })
  assert.deepEqual(planProgress(value, () => false), { done: 0, total: 1 })
  assert.equal(nextStep(value)?.n, 1)
})

test('read ranges win over skim ranges when both are open', () => {
  const value = plan({ steps: [step(1, { coverage: 'skim' }), step(2)] })
  assert.equal(nextStep(value)?.n, 2)
})

test('completion comes from the ledger, not from a stored tick', () => {
  const value = plan({ steps: [step(1, { target: 'a:1' }), step(2, { target: 'a:2' })] })
  const learned = (candidate: PlanStep): boolean => candidate.target === 'a:1'
  assert.deepEqual(planProgress(value, learned), { done: 1, total: 2 })
  assert.deepEqual(planProgress(value, () => false), { done: 0, total: 2 }, '没有勾选这条老路，只有账本')
})

test('a learned section no longer holds the next pointer', () => {
  const value = plan({ steps: [step(1, { target: 'a:1' }), step(2, { target: 'a:2' })] })
  assert.equal(nextStep(value)?.n, 1)
  const learned = (candidate: PlanStep): boolean => candidate.target === 'a:1'
  assert.equal(nextStep(value, learned)?.n, 2, '到档的一节不再占着「下一步」')
  assert.equal(nextStep(value, () => true), undefined, '全都到档时没有下一步，今日页留空')
})

test('boundary arithmetic sums pages per decision', () => {
  const value = plan({
    steps: [
      step(1, { target: 'a:1' }),
      step(2, { target: 'a:2', coverage: 'skim' }),
      step(3, { target: 'a:3', coverage: 'skip', skipReason: 'later chapters' }),
      step(4, { kind: 'drill', concepts: ['x'] }),
    ],
  })
  const ranges: Record<string, { pageStart: number; pageEnd: number }> = {
    'a:1': { pageStart: 1, pageEnd: 10 },
    'a:2': { pageStart: 11, pageEnd: 20 },
    'a:3': { pageStart: 21, pageEnd: 40 },
  }
  const summary = summarizeBoundary(value, target => ranges[target] ?? null)
  assert.deepEqual(summary, {
    read: 1,
    skim: 1,
    skip: 1,
    readPages: 10,
    skimPages: 10,
    skipPages: 20,
    minPages: 10,
    totalPages: 40,
  })
})
