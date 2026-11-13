import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickAdaptiveNext } from '../src/core/quiz.ts'
import type { QuizItem } from '../src/core/types.ts'

const item = (id: string, concepts: string[], difficulty: 1 | 2 | 3, type: QuizItem['type'] = 'choice'): QuizItem => ({
  id,
  type,
  question: id,
  concepts,
  difficulty,
  origin: 'generated',
  ...(type === 'choice' ? { choices: ['A', 'B'], answerIndex: 0 } : {}),
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
    seed: 's',
  })
  assert.equal(next?.id, 'easy-same')
})

test('a right answer moves to the same concept at a harder level', () => {
  const next = pickAdaptiveNext([current, easySame, hardSame, other], {
    asked: new Set(['current']),
    current,
    correct: true,
    seed: 's',
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
