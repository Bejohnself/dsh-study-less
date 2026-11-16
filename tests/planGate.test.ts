import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverageOf, deriveStuckPoints, gateStatus, planProgress, summarizeBoundary, thresholdOf } from '../src/core/planGate.ts'
import { nextStep } from '../src/core/plans.ts'
import type { AttemptRecord, PlanRecord, PlanStep } from '../src/core/types.ts'

function step(n: number, patch: Partial<PlanStep> = {}): PlanStep {
  return {
    n,
    kind: 'unit',
    target: 'm:' + String(n),
    why: 'because',
    done: false,
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
  assert.deepEqual(planProgress(value), { done: 0, total: 2 })
  const next = nextStep(value)
  assert.equal(next?.n, 3)
})

test('read ranges win over skim ranges when both are open', () => {
  const value = plan({ steps: [step(1, { coverage: 'skim' }), step(2)] })
  assert.equal(nextStep(value)?.n, 2)
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

test('the gate refuses a goal without a deliverable, evidence or questions', () => {
  const status = gateStatus(plan())
  assert.equal(status.ready, false)
  assert.equal(status.reasons.length, 3)
  assert.match(status.reasons[0] ?? '', /交付物/)
})

test('three independent attempts plus 4 of 5 questions opens the gate', () => {
  const attempts: AttemptRecord[] = [1, 2, 3].map(index => ({
    id: 'a' + String(index),
    move: 'assumption',
    what: 'tried',
    provenance: 'independent',
    at: '2026-02-0' + String(index) + 'T00:00:00.000Z',
  }))
  const value = plan({
    deliverable: 'derive section 3',
    attempts,
    sufficiency: [
      { id: 'q1', q: 'one', answer: 'a1', verdict: 'pass' as const },
      { id: 'q2', q: 'two', answer: 'a2', verdict: 'pass' as const },
      { id: 'q3', q: 'three', answer: 'a3', verdict: 'pass' as const },
      { id: 'q4', q: 'four', answer: 'a4', verdict: 'pass' as const },
      { id: 'q5', q: 'five', answer: 'a5', verdict: 'fail' as const },
    ],
  })
  const status = gateStatus(value)
  assert.equal(status.ready, true)
  assert.equal(status.independent, 3)
  assert.equal(status.passed, 4)
  assert.equal(thresholdOf(value), 0.8)
})

test('adopted-unverified attempts do not count as independent evidence', () => {
  const value = plan({
    deliverable: 'x',
    attempts: [
      { id: 'a', move: 'ablation', what: 'w', provenance: 'adopted-unverified', at: '2026-02-01T00:00:00.000Z' },
      { id: 'b', move: 'ablation', what: 'w', provenance: 'judged', at: '2026-02-02T00:00:00.000Z' },
    ],
    sufficiency: [{ id: 'q', q: 'q', answer: 'a', verdict: 'pass' as const }],
  })
  const status = gateStatus(value)
  assert.equal(status.ready, false)
  assert.equal(status.independent, 0)
  assert.equal(status.judged, 1)
  assert.equal(status.unverified, 1)
})

test('stuck points group repeated texts and sort by frequency', () => {
  const attempts: AttemptRecord[] = [
    { id: 'a', move: 'assumption', what: 'w', stuck: 'constraint into reward', provenance: 'judged', at: '2026-02-01T00:00:00.000Z' },
    { id: 'b', move: 'assumption', what: 'w', stuck: 'Convergence proof', provenance: 'judged', at: '2026-02-02T00:00:00.000Z' },
    { id: 'c', move: 'assumption', what: 'w', stuck: 'constraint into reward', provenance: 'judged', at: '2026-02-03T00:00:00.000Z' },
    { id: 'd', move: 'assumption', what: 'w', provenance: 'judged', at: '2026-02-04T00:00:00.000Z' },
  ]
  const stuck = deriveStuckPoints(attempts)
  assert.equal(stuck.length, 2)
  assert.equal(stuck[0]?.text, 'constraint into reward')
  assert.equal(stuck[0]?.count, 2)
  assert.equal(stuck[0]?.lastAt, '2026-02-03T00:00:00.000Z')
  assert.equal(stuck[1]?.text, 'Convergence proof')
})
