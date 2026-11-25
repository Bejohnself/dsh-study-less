import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConcepts } from '../src/host/generation/normalize.ts'
import { bestOccurrence } from '../src/core/concepts.ts'

test('extracted concepts keep valid ids, drop duplicates and out-of-range pages', () => {
  const concepts = normalizeConcepts(
    {
      concepts: [
        { id: 'dp/bellman', name: '贝尔曼方程', definition: '最优代价的递归关系', page: 3 },
        { id: 'DP/Bellman', name: '重复', page: 1 },
        { id: 'not a slug', name: '非法', page: 2 },
        { id: 'dp/limit', name: '极限交换', page: 99 },
        { id: '', name: '空 id', page: 2 },
      ],
    },
    { pageStart: 1, pageEnd: 4 },
  )
  assert.deepEqual(concepts, [
    { id: 'dp/bellman', name: '贝尔曼方程', definition: '最优代价的递归关系', page: 3 },
    { id: 'dp/limit', name: '极限交换' },
  ])
})

test('an empty extraction is an error, not an empty concept list', () => {
  assert.throws(() => normalizeConcepts({ concepts: [] }, { pageStart: 1, pageEnd: 2 }), /知识点/)
})

test('a due concept opens the goal section that asks for the deepest level', () => {
  const occurrences = [
    { material: 'm', unit: '6-1', page: 3, role: 'definition' as const },
    { material: 'm', unit: '6-2-2', page: 7, role: 'definition' as const },
  ]
  const levels = new Map([
    ['m:6-1', 2],
    ['m:6-2-2', 3],
  ])
  assert.equal(
    bestOccurrence(occurrences, occurrence => levels.get(`${occurrence.material}:${occurrence.unit}`))?.unit,
    '6-2-2',
    'the first occurrence is only a fallback, not the review target',
  )
  assert.equal(
    bestOccurrence(occurrences, () => undefined)?.unit,
    '6-1',
    'no goal section carries it: keep the first occurrence',
  )
})
