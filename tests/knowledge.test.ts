import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyEvidence,
  decayedMastery,
  dueConcepts,
  emptyKnowledge,
  questionFingerprint,
  readKnowledge,
  recordEvidence,
  sectionPointStates,
  settleIfDone,
  type ConceptState,
} from '../src/core/knowledge.ts'
import { LibraryPaths } from '../src/core/paths.ts'
import { addDays, localDate } from '../src/core/time.ts'

const root = await mkdtemp(join(tmpdir(), 'study-knowledge-'))
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const paths = new LibraryPaths(root)
const today = '2026-03-01'

function state(overrides: Partial<ConceptState> = {}): ConceptState {
  return {
    mastery: 0.5,
    peak: 0.5,
    streak: 0,
    attempts: 0,
    correct: 0,
    srs: { S: 3.2, D: 5.5, reps: 0, lapses: 0, lastRating: 3 },
    evidence: {},
    ...overrides,
  }
}

test('the fingerprint ignores whitespace and punctuation, not the question', () => {
  assert.equal(questionFingerprint('为什么 $a+b$ 成立？'), questionFingerprint('为什么  $a+b$ 成立'))
  assert.notEqual(questionFingerprint('为什么 $a+b$ 成立？'), questionFingerprint('为什么 $a-b$ 成立？'))
})

test('a pass raises mastery and a fail lowers it', () => {
  const passed = applyEvidence(state(), {
    conceptId: 'dp/convergence',
    fingerprint: 'q-1',
    verdict: 'pass',
    difficulty: 2,
    at: `${today}T10:00:00+08:00`,
  })
  assert.ok(passed.mastery > 0.5)
  const failed = applyEvidence(state({ mastery: 0.8 }), {
    conceptId: 'dp/convergence',
    fingerprint: 'q-2',
    verdict: 'fail',
    difficulty: 2,
    at: `${today}T10:00:00+08:00`,
  })
  assert.ok(failed.mastery < 0.8)
})

test('the same question counts once: answering it again adds nothing', () => {
  const first = applyEvidence(state(), {
    conceptId: 'dp/convergence',
    fingerprint: 'q-same',
    verdict: 'pass',
    difficulty: 2,
    at: `${today}T10:00:00+08:00`,
  })
  const second = applyEvidence(first, {
    conceptId: 'dp/convergence',
    fingerprint: 'q-same',
    verdict: 'pass',
    difficulty: 2,
    at: `${today}T11:00:00+08:00`,
  })
  assert.deepEqual(Object.keys(second.evidence), ['q-same'])
  assert.equal(second.mastery, first.mastery, 'a repeat is not a second gain')
  const fresh = applyEvidence(first, {
    conceptId: 'dp/convergence',
    fingerprint: 'q-new',
    verdict: 'pass',
    difficulty: 2,
    at: `${today}T11:00:00+08:00`,
  })
  assert.ok(fresh.mastery > second.mastery, 'a new question is what moves the estimate')
})

test('an idle month is not undone by the next answer', () => {
  const first = applyEvidence(state(), {
    conceptId: 'dp/convergence',
    fingerprint: 'q-old',
    verdict: 'pass',
    difficulty: 2,
    at: `${addDays(today, -60)}T10:00:00+08:00`,
  })
  const second = applyEvidence(first, {
    conceptId: 'dp/convergence',
    fingerprint: 'q-new',
    verdict: 'pass',
    difficulty: 2,
    at: `${today}T10:00:00+08:00`,
  })
  // Two months away costs about a fifth of the estimate before the next gain.
  assert.ok(second.mastery < 0.56, `decayed start expected, got ${second.mastery}`)
  assert.ok(second.mastery > 0.5)
})

test('a won appeal counts, but not at full weight', () => {
  const full = applyEvidence(state(), {
    conceptId: 'dp/convergence',
    fingerprint: 'q-1',
    verdict: 'pass',
    difficulty: 2,
    at: `${today}T10:00:00+08:00`,
  })
  const appealed = applyEvidence(state(), {
    conceptId: 'dp/convergence',
    fingerprint: 'q-1',
    verdict: 'pass',
    difficulty: 2,
    at: `${today}T10:00:00+08:00`,
    weight: 0.7,
  })
  assert.ok(appealed.mastery < full.mastery)
  assert.ok(appealed.mastery > 0.5, 'an appeal still moves the estimate')
})

test('a concept short of its goal comes back within a week', () => {
  const base = applyEvidence(state(), {
    conceptId: 'dp/convergence',
    fingerprint: 'q-a',
    verdict: 'pass',
    difficulty: 2,
    at: `${addDays(today, -1)}T10:00:00+08:00`,
  })
  const input = {
    conceptId: 'dp/convergence',
    fingerprint: 'q-b',
    verdict: 'pass' as const,
    difficulty: 2 as const,
    at: `${today}T10:00:00+08:00`,
  }
  assert.equal(applyEvidence(base, input, { target: 0.95 }).due, addDays(today, 7))
  assert.ok((applyEvidence(base, input, { target: 0.6 }).due ?? '') > addDays(today, 7))
})

test('the documented trajectory: 4 / 7 / 12 passes reach 会用 / 能讲 / 创新', () => {
  const after = (count: number): number => {
    let state: ConceptState | undefined
    for (let index = 0; index < count; index += 1) {
      state = applyEvidence(state, {
        conceptId: 'dp/convergence',
        fingerprint: `q-${String(index)}`,
        verdict: 'pass',
        difficulty: 2,
        at: `${today}T10:00:00+08:00`,
      })
    }
    return state?.mastery ?? 0
  }
  assert.ok(after(3) < 0.75 && after(4) >= 0.75, '会用 needs four normal passes')
  assert.ok(after(6) < 0.85 && after(7) >= 0.85, '能讲 needs seven')
  assert.ok(after(11) < 0.95 && after(12) >= 0.95, '创新 needs twelve')
})

test('decay halves the gap to the floor every half-life and never goes below it', () => {
  const long = state({ mastery: 1, peak: 1, lastAt: `${addDays(today, -45)}T10:00:00+08:00` })
  assert.ok(Math.abs(decayedMastery(long, today) - 0.75) < 1e-6)
  const longer = state({ mastery: 1, peak: 1, lastAt: `${addDays(today, -450)}T10:00:00+08:00` })
  assert.ok(Math.abs(decayedMastery(longer, today) - 0.5) < 0.01)
})

test('a reached concept settles when it would outlast the horizon', () => {
  const stable = { S: 200, D: 3, reps: 3, lapses: 0, lastRating: 4 as const }
  const far = state({ mastery: 0.95, peak: 0.95, srs: stable })
  const settled = settleIfDone(far, { conceptId: 'dp/convergence', horizonDays: 90, today })
  assert.ok(settled.settledAt !== undefined)

  const near = state({ mastery: 0.95, peak: 0.95, srs: { ...stable, S: 40 } })
  assert.equal(settleIfDone(near, { conceptId: 'dp/convergence', horizonDays: 90, today }).settledAt, undefined)

  const weak = state({ mastery: 0.5, peak: 0.5, srs: stable })
  assert.equal(settleIfDone(weak, { conceptId: 'dp/convergence', horizonDays: 90, today }).settledAt, undefined)
})

test('a long deadline still settles: the calendar cap is not the gate', () => {
  // S=400 means the reader would remember for ~400 days; the scheduled date is
  // capped at 180, which used to make a 200-day deadline impossible to close.
  const stable = state({ mastery: 0.95, peak: 0.95, srs: { S: 400, D: 3, reps: 3, lapses: 0, lastRating: 4 } })
  assert.ok(settleIfDone(stable, { conceptId: 'dp/convergence', horizonDays: 200, today }).settledAt !== undefined)
})

test('an answer reopens a settled concept', () => {
  const settled = state({ mastery: 0.95, settledAt: `${today}T09:00:00+08:00` })
  const reopened = applyEvidence(settled, {
    conceptId: 'dp/convergence',
    fingerprint: 'q-again',
    verdict: 'fail',
    at: `${today}T12:00:00+08:00`,
  })
  assert.equal(reopened.settledAt, undefined)
})

test('one answer writes the concept, its due date and the review queue', async () => {
  await recordEvidence(paths, {
    conceptId: 'dp/convergence',
    fingerprint: 'q-file',
    verdict: 'pass',
    difficulty: 2,
    at: `${today}T10:00:00+08:00`,
  })
  const file = await readKnowledge(paths)
  const entry = file.concepts['dp/convergence']
  assert.ok(entry !== undefined)
  assert.ok(entry.mastery > 0.5)
  assert.ok(entry.due !== undefined)
  const due = dueConcepts(file, addDays(today, 30))
  assert.equal(due[0]?.conceptId, 'dp/convergence')
  assert.equal(dueConcepts(file, today).length, 0, 'a fresh pass is not due today')
  assert.equal(file.concepts['dp/convergence']?.settledAt, undefined)
})

test('section points read the ledger, the threshold and the name map together', () => {
  const file = emptyKnowledge()
  file.concepts['dp/a'] = state({ mastery: 0.8, peak: 0.8 })
  file.concepts['dp/b'] = state({ mastery: 0.6, peak: 0.6 })
  const points = sectionPointStates(
    ['dp/a', 'dp/b', 'dp/missing'],
    { 'dp/a': 0.75, 'dp/b': 0.75 },
    file,
    new Map([['dp/a', '概念 A']]),
    today,
  )
  assert.deepEqual(points.map(point => [point.id, point.name, point.atTarget]), [
    ['dp/a', '概念 A', true],
    ['dp/b', 'dp/b', false],
    ['dp/missing', 'dp/missing', false],
  ])
  assert.equal(points[2]?.mastery, 0.5, 'an unseen point starts from the fresh 0.5')
  assert.equal(points[1]?.threshold, 0.75, 'the goal threshold is used')
  assert.equal(points[2]?.threshold, 0.75, 'a missing threshold falls back to the default')
})

test('an empty space is not an error', async () => {
  const other = new LibraryPaths(join(root, 'empty'))
  const file = await readKnowledge(other)
  assert.deepEqual(file.concepts, {})
  assert.equal(localDate(new Date(`${today}T12:00:00+08:00`)), today)
})