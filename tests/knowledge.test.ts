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

test('the same question counts once as evidence and only lightly as review', () => {
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
  const fresh = applyEvidence(state({ mastery: first.mastery }), {
    conceptId: 'dp/convergence',
    fingerprint: 'q-new',
    verdict: 'pass',
    difficulty: 2,
    at: `${today}T11:00:00+08:00`,
  })
  assert.ok(fresh.mastery > second.mastery, 'a new question is stronger evidence than a repeat')
})

test('decay halves the gap to the floor every half-life and never goes below it', () => {
  const long = state({ mastery: 1, peak: 1, lastAt: `${addDays(today, -45)}T10:00:00+08:00` })
  assert.ok(Math.abs(decayedMastery(long, today) - 0.75) < 1e-6)
  const longer = state({ mastery: 1, peak: 1, lastAt: `${addDays(today, -450)}T10:00:00+08:00` })
  assert.ok(Math.abs(decayedMastery(longer, today) - 0.5) < 0.01)
})

test('a reached concept settles when the next review falls past the horizon', () => {
  const far = state({ mastery: 0.95, peak: 0.95, due: addDays(today, 200) })
  const settled = settleIfDone(far, { conceptId: 'dp/convergence', horizonDays: 90, today })
  assert.ok(settled.settledAt !== undefined)

  const near = state({ mastery: 0.95, peak: 0.95, due: addDays(today, 40) })
  assert.equal(settleIfDone(near, { conceptId: 'dp/convergence', horizonDays: 90, today }).settledAt, undefined)

  const weak = state({ mastery: 0.5, peak: 0.5, due: addDays(today, 200) })
  assert.equal(settleIfDone(weak, { conceptId: 'dp/convergence', horizonDays: 90, today }).settledAt, undefined)
})

test('an answer reopens a settled concept', () => {
  const settled = state({ mastery: 0.95, due: addDays(today, 200), settledAt: `${today}T09:00:00+08:00` })
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

test('an empty space is not an error', async () => {
  const other = new LibraryPaths(join(root, 'empty'))
  const file = await readKnowledge(other)
  assert.deepEqual(file.concepts, {})
  assert.equal(localDate(new Date(`${today}T12:00:00+08:00`)), today)
})