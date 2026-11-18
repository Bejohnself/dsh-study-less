import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SESSION_LIMIT,
  MIN_GRADED_FOR_RATING,
  conceptStatus,
  defaultSessionLimit,
  gradeQuizItem,
  isObjectiveItem,
  looksCopiedFromRubric,
  needsWrittenJudge,
  orderQuizItems,
  pickAdaptiveNext,
  sameQuizScope,
  scoreQuizSession,
} from '../src/core/quiz.ts'
import type { QuizBank, QuizItem, QuizSessionEntry, QuizSessionScope } from '../src/core/types.ts'

const item = (
  id: string,
  concepts: string[],
  difficulty: 1 | 2 | 3,
  type: QuizItem['type'] = 'choice',
): QuizItem => ({
  id,
  type,
  question: id,
  concepts,
  difficulty,
  origin: 'generated',
  ...(type === 'choice' ? { choices: ['A', 'B'], answerIndex: 0 } : {}),
})

const bank = (items: QuizItem[]): QuizBank => ({
  version: 1,
  unit: 'u',
  items,
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const current = item('current', ['a'], 2)
const easySame = item('easy-same', ['a'], 1)
const hardSame = item('hard-same', ['a'], 3)
const other = item('other', ['b'], 2)

test('a wrong answer retreats to the same concept at an easier level', () => {
  const next = pickAdaptiveNext([current, easySame, hardSame, other], {
    asked: new Set(['current']),
    current,
    correct: false,
  })
  assert.equal(next?.id, 'easy-same')
})

test('a right answer moves to the same concept at a harder level', () => {
  const next = pickAdaptiveNext([current, easySame, hardSame, other], {
    asked: new Set(['current']),
    current,
    correct: true,
  })
  assert.equal(next?.id, 'hard-same')
})

test('answered items are never repeated and exhaustion returns undefined', () => {
  const next = pickAdaptiveNext([current, easySame], {
    asked: new Set(['current', 'easy-same']),
    current,
    correct: true,
  })
  assert.equal(next, undefined)
})

test('equal scores follow the bank order, not a random hash', () => {
  const first = item('first', ['a'], 2)
  const second = item('second', ['a'], 2)
  const next = pickAdaptiveNext([current, first, second], {
    asked: new Set(['current']),
    current,
    correct: true,
  })
  assert.equal(next?.id, 'first')
})

test('the first item is objective when the bank has one', () => {
  const ordered = orderQuizItems(bank([
    item('recall-1', ['a'], 1, 'recall'),
    item('choice-1', ['a'], 3),
  ]))
  assert.equal(ordered[0]?.id, 'choice-1')
  assert.equal(ordered.find(isObjectiveItem)?.id, 'choice-1')
})

test('order puts weak concepts first, then easier items, then bank order', () => {
  const ordered = orderQuizItems(
    bank([
      item('recall', ['a'], 2, 'recall'),
      item('choice-hard', ['a'], 3),
      item('weak', ['weak'], 2),
      item('choice-easy', ['a'], 1),
    ]),
    { weakConcepts: new Set(['weak']) },
  )
  assert.deepEqual(ordered.map(entry => entry.id), ['weak', 'choice-easy', 'choice-hard', 'recall'])
})

test('default limit is capped by the bank, not by a fixed eight', () => {
  assert.equal(DEFAULT_SESSION_LIMIT, 8)
  assert.equal(defaultSessionLimit(bank([current, easySame, hardSame, other, item('x', ['x'], 2)])), 5)
  assert.equal(
    defaultSessionLimit(bank(Array.from({ length: 10 }, (_, index) => item(`q${String(index)}`, ['a'], 2)))),
    8,
  )
  assert.equal(defaultSessionLimit(bank([])), 0)
})

test('evidence items are written answers, not page-number checks', () => {
  const evidence: QuizItem = {
    id: 'evidence-1',
    type: 'evidence',
    question: '原文在哪一页提醒极限并非无条件成立？',
    concepts: ['dp/unbounded'],
    origin: 'generated',
    page: 420,
    rubric: ['指出 p420'],
  }
  assert.equal(isObjectiveItem(evidence), false)
  assert.deepEqual(gradeQuizItem(evidence, '420'), { correct: null, reason: 'manual' })
})

test('a rebuttal that pastes the rubric is detected', () => {
  const rubric = [
    '先令 $k\\to\\infty$ 并假定 $J_k\\to J^*$。',
    '需要允许极限与 $\\min$、期望交换，或引用值迭代收敛定理；不能无条件交换。',
  ]
  assert.equal(looksCopiedFromRubric(rubric.join(''), rubric), true)
  assert.equal(
    looksCopiedFromRubric('我这次补的是：先取极限，再说明 min 与期望交换需要额外条件，否则不能直接交换。', rubric),
    false,
  )
})

test('sameQuizScope matches one bank only', () => {
  const unit: QuizSessionScope = { kind: 'unit', material: 'm', unit: 'u' }
  assert.equal(sameQuizScope(unit, { kind: 'unit', material: 'm', unit: 'u' }), true)
  assert.equal(sameQuizScope(unit, { kind: 'unit', material: 'm', unit: 'other' }), false)
  const chapter: QuizSessionScope = { kind: 'book', book: 'b', chapter: 'c1' }
  assert.equal(sameQuizScope(chapter, { kind: 'book', book: 'b', chapter: 'c1' }), true)
  assert.equal(sameQuizScope(chapter, { kind: 'book', book: 'b', chapter: 'c2' }), false)
  assert.equal(sameQuizScope(chapter, unit), false)
})
/* ------------------------------------------------ section grading ------- */

const entry = (overrides: Partial<QuizSessionEntry>): QuizSessionEntry => ({
  itemId: 'e',
  correct: null,
  at: '2026-01-01T00:00:00.000Z',
  concepts: [],
  ...overrides,
})

test('a cloze answer is a written answer, but an equal spelling is settled locally', () => {
  const cloze: QuizItem = {
    id: 'cloze-1',
    type: 'cloze',
    question: '补全求和项',
    answer: '$\\frac{1}{2}\\sum_{k=0}^{N-1} g_k$',
    concepts: ['dp/sum'],
    origin: 'generated',
    difficulty: 2,
  }
  assert.equal(isObjectiveItem(cloze), false)
  assert.equal(needsWrittenJudge(cloze), true)
  assert.deepEqual(gradeQuizItem(cloze, '$\\dfrac{1}{2} \\sum_{k=0}^{N-1} g_k$'), { correct: true })
  assert.deepEqual(gradeQuizItem(cloze, '$\\sum g_k$'), { correct: false })
})

test('two easy answers never rate a run, however correct they are', () => {
  const score = scoreQuizSession([
    entry({ correct: true, difficulty: 1 }),
    entry({ correct: true, difficulty: 1 }),
  ])
  assert.equal(score.graded, 2)
  assert.equal(score.score, 1)
  assert.ok(score.graded < MIN_GRADED_FOR_RATING)
})

test('hard answers weigh more and partial credit counts half', () => {
  const score = scoreQuizSession([
    entry({ correct: true, difficulty: 3 }),
    entry({ judged: { verdict: 'partial', missing: [], confidence: 0.8, engine: 'fake', at: '2026-01-01T00:00:00.000Z' }, difficulty: 2 }),
    entry({ correct: false, difficulty: 1 }),
  ])
  assert.equal(score.graded, 3)
  assert.equal(score.correct, 1)
  assert.equal(score.partial, 1)
  // (1*2 + 0.5*1.5 + 0*1) / (2 + 1.5 + 1) = 2.75 / 4.5
  assert.ok(Math.abs(score.score - 2.75 / 4.5) < 1e-9)
})

test('self-graded answers are history, not evidence', () => {
  const score = scoreQuizSession([
    entry({ correct: true, selfGrade: 'correct' }),
    entry({ correct: true }),
  ])
  assert.equal(score.graded, 1)
  assert.equal(score.score, 1)
})

test('a knowledge point needs its latest answer to pass', () => {
  const entries = [
    entry({ itemId: 'a1', correct: true, concepts: ['a'] }),
    entry({ itemId: 'a2', correct: true, concepts: ['b'] }),
    entry({ itemId: 'a3', correct: false, concepts: ['a'] }),
  ]
  const status = conceptStatus(entries, ['a', 'b'])
  assert.deepEqual(status.passed, ['b'])
  assert.deepEqual(status.pending, ['a'])
  assert.equal(status.all, false)
  assert.equal(conceptStatus(entries.slice(0, 2), ['a', 'b']).all, true)
})
