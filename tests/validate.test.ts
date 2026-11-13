import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateNotes, validateQuizBank } from '../src/core/validate.ts'
import type { QuizItem } from '../src/core/types.ts'

const notes = [
  '## 本节目标',
  '目标。',
  '## 前置知识',
  '前置。',
  '## 核心概念',
  '概念。',
  '## 逐步讲解',
  '讲解。'.repeat(120),
  '## 类比',
  '类比。',
  '## 常见误区',
  '误区一。误区二。',
  '## 自测',
  '问题。',
  '## 出处',
  'p3。',
].join('\n')

test('valid notes pass the contract', () => {
  const result = validateNotes({
    markdown: notes,
    pageRefs: [3],
    concepts: ['topic/concept'],
    range: { pageStart: 3, pageEnd: 3 },
  })
  assert.deepEqual(result, { ok: true, issues: [] })
})

test('out-of-range page refs and missing headings are refused', () => {
  const result = validateNotes({
    markdown: '## 本节目标\n短',
    pageRefs: [9],
    concepts: [],
    range: { pageStart: 3, pageEnd: 3 },
  })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.includes('页码越界')))
  assert.ok(result.issues.some(issue => issue.includes('缺少小节')))
})

test('notes without page refs are refused', () => {
  const result = validateNotes({ markdown: notes, pageRefs: [], concepts: ['topic/concept'], range: { pageStart: 3, pageEnd: 3 } })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.includes('pageRefs')))
})

test('quiz bank catches bad choices', () => {
  const item: QuizItem = {
    id: 'q1',
    type: 'choice',
    question: '选一个',
    choices: ['A'],
    answerIndex: 3,
    concepts: [],
    origin: 'generated',
  }
  const result = validateQuizBank([item], { pageStart: 1, pageEnd: 2 })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.includes('至少需要 2 个选项')))
})
