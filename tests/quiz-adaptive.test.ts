import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SESSION_LIMIT,
  defaultSessionLimit,
  isObjectiveItem,
  orderQuizItems,
  pickAdaptiveNext,
  sameQuizScope,
} from '../src/core/quiz.ts'
import type { QuizBank, QuizItem, QuizSessionScope } from '../src/core/types.ts'

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

test('sameQuizScope matches one bank only', () => {
  const unit: QuizSessionScope = { kind: 'unit', material: 'm', unit: 'u' }
  assert.equal(sameQuizScope(unit, { kind: 'unit', material: 'm', unit: 'u' }), true)
  assert.equal(sameQuizScope(unit, { kind: 'unit', material: 'm', unit: 'other' }), false)
  const chapter: QuizSessionScope = { kind: 'book', book: 'b', chapter: 'c1' }
  assert.equal(sameQuizScope(chapter, { kind: 'book', book: 'b', chapter: 'c1' }), true)
  assert.equal(sameQuizScope(chapter, { kind: 'book', book: 'b', chapter: 'c2' }), false)
  assert.equal(sameQuizScope(chapter, unit), false)
})