import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateInsight } from '../src/core/insights.ts'

const ranges = new Map([['book:unit', { pageStart: 2, pageEnd: 4 }]])

test('valid insight passes', () => {
  const issues = validateInsight({
    title: '本质',
    oneLiner: '一句话',
    body: '这是一段足够长的解释，用来通过最小长度检查。',
    sources: [{ material: 'book', unit: 'unit', page: 3 }],
    concepts: ['topic/concept'],
    ranges,
  })
  assert.deepEqual(issues, [])
})

test('insight refuses an out-of-range source page', () => {
  const issues = validateInsight({
    title: '本质',
    oneLiner: '一句话',
    body: '这是一段足够长的解释，用来通过最小长度检查。',
    sources: [{ material: 'book', unit: 'unit', page: 9 }],
    concepts: ['topic/concept'],
    ranges,
  })
  assert.ok(issues.some(issue => issue.includes('页码越界')))
})
