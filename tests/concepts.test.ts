import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConcepts } from '../src/host/generation/normalize.ts'

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
