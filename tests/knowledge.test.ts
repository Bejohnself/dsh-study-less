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
  retentionSafe,
  reviewOn,
  sectionPointStates,
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

/** A concept that has already been reviewed on `rounds` different days. */
function reviewedState(mastery: number, rounds: number, overrides: Partial<ConceptState> = {}): ConceptState {
  const evidence: ConceptState['evidence'] = {}
  for (let index = 0; index < rounds; index += 1) {
    evidence[`q-${String(index)}`] = {
      verdict: 'pass',
      difficulty: 2,
      at: `${addDays(today, -(rounds - index))}T10:00:00+08:00`,
      review: true,
    }
  }
  return state({
    mastery,
    peak: mastery,
    lastAt: `${today}T10:00:00+08:00`,
    evidence,
    ...overrides,
  })
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
  // Two months is many half-lives now: the estimate sits near the floor and the
  // next gain starts from there instead of erasing the absence.
  assert.ok(second.mastery < 0.5, `decayed start expected, got ${second.mastery}`)
  assert.ok(second.mastery > 0.3)
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

test('the documented trajectory: 4 / 7 / 12 passes reach 会用 / 能讲 / 创新', () => {
  const after = (count: number): number => {
    let value: ConceptState | undefined
    for (let index = 0; index < count; index += 1) {
      value = applyEvidence(value, {
        conceptId: 'dp/convergence',
        fingerprint: `q-${String(index)}`,
        verdict: 'pass',
        difficulty: 2,
        at: `${today}T10:00:00+08:00`,
      })
    }
    return value?.mastery ?? 0
  }
  assert.ok(after(3) < 0.75 && after(4) >= 0.75, '会用 needs four normal passes')
  assert.ok(after(6) < 0.85 && after(7) >= 0.85, '能讲 needs seven')
  assert.ok(after(11) < 0.95 && after(12) >= 0.95, '创新 needs twelve')
})

test('reviewOn is the day the decay crosses the threshold', () => {
  const fresh = state({ mastery: 1, peak: 1, lastAt: `${today}T10:00:00+08:00` })
  assert.equal(reviewOn(fresh, 0.75), addDays(today, 7), 'one half-life to lose half the gap')

  const spaced = reviewedState(1, 3)
  const later = reviewOn(spaced, 0.75)
  assert.ok(later !== undefined && later > addDays(today, 7), 'spaced reviews push the crossing out')
})

test('retentionSafe asks the deadline, and only "at target" once it passed', () => {
  const fresh = state({ mastery: 0.9, peak: 0.9, lastAt: `${today}T10:00:00+08:00` })
  assert.equal(retentionSafe(fresh, 0.85, addDays(today, 31), today), false, 'would drop before the deadline')

  const spaced = reviewedState(0.9, 7)
  assert.equal(retentionSafe(spaced, 0.85, addDays(today, 31), today), true)

  assert.equal(retentionSafe(fresh, 0.85, today, today), true, 'deadline day: at target now is enough')
  assert.equal(retentionSafe(fresh, 0.85, addDays(today, -1), today), true, 'past deadline: at target now is enough')
  assert.equal(retentionSafe(state({ mastery: 0.8, peak: 0.8 }), 0.85, addDays(today, -1), today), false)
})

test('decay halves the gap to the floor every half-life and never goes below it', () => {
  const long = state({ mastery: 1, peak: 1, lastAt: `${addDays(today, -7)}T10:00:00+08:00` })
  assert.ok(Math.abs(decayedMastery(long, today) - 0.75) < 1e-6)
  const longer = state({ mastery: 1, peak: 1, lastAt: `${addDays(today, -70)}T10:00:00+08:00` })
  assert.ok(Math.abs(decayedMastery(longer, today) - 0.5) < 0.01)
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

test('the review queue waits for a point that had reached the line, then decays', async () => {
  await rm(paths.knowledgeFile, { force: true })
  for (let index = 0; index < 4; index += 1) {
    await recordEvidence(paths, {
      conceptId: 'dp/convergence',
      fingerprint: `q-file-${String(index)}`,
      verdict: 'pass',
      difficulty: 2,
      at: `${today}T10:00:00+08:00`,
    })
  }
  const file = await readKnowledge(paths)
  const entry = file.concepts['dp/convergence']
  assert.ok(entry !== undefined)
  assert.ok(entry.mastery >= 0.75, 'four passes reach the 会用 line')
  assert.equal(entry.due, undefined, 'the FSRS due field is no longer written')
  assert.equal(dueConcepts(file, () => 0.75, today).length, 0, 'at target is not due')
  const due = dueConcepts(file, () => 0.75, addDays(today, 30))
  assert.equal(due[0]?.conceptId, 'dp/convergence')
  assert.ok((due[0]?.overdueDays ?? 0) > 0)
  assert.equal(file.concepts['dp/convergence']?.settledAt, undefined)
})

test('an at-target point is not review just because the old FSRS date arrived', () => {
  const file = emptyKnowledge()
  file.concepts['dp/steady'] = state({
    mastery: 0.9,
    peak: 0.9,
    lastAt: `${today}T10:00:00+08:00`,
    due: addDays(today, -2),
  })
  assert.equal(dueConcepts(file, () => 0.85, today).length, 0, 'the threshold, not the old date, decides')
})

test('a settled point that fell below the line still comes back for review', () => {
  const file = emptyKnowledge()
  file.concepts['dp/settled'] = state({
    mastery: 0.84,
    peak: 0.9,
    lastAt: `${addDays(today, -2)}T10:00:00+08:00`,
    settledAt: `${addDays(today, -2)}T10:00:00+08:00`,
  })
  const due = dueConcepts(file, () => 0.85, today)
  assert.equal(due[0]?.conceptId, 'dp/settled', 'a settled mark must not hide the decay')
  assert.equal(due[0]?.target, 0.85)
})

test('a point still in its first learning run is not review yet', () => {
  const file = emptyKnowledge()
  file.concepts['dp/new'] = state({ mastery: 0.59, peak: 0.59, lastAt: `${today}T10:00:00+08:00` })
  assert.equal(dueConcepts(file, () => 0.75, addDays(today, 30)).length, 0)
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