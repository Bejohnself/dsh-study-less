/**
 * Leaf-unit rule: a route step must land on the deepest section, while a parent
 * unit is only a table-of-contents row that opens the first leaf under it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLeafUnit } from '../src/core/library.ts'
import { validatePlan, type PlanTargets } from '../src/core/plans.ts'
import type { PlanRecord, StructureNode } from '../src/core/types.ts'
import type { TocRow } from '../src/core/views.ts'
import { firstLeafUid, firstLeafUnder, neighbourLeaf } from '../src/client/labels.ts'

function node(uid: string, level: number, pageStart: number, pageEnd: number): StructureNode {
  return { uid, kind: 'section', title: uid, level, pageStart, pageEnd }
}

const structure: StructureNode[] = [
  node('ch1', 1, 1, 20),
  node('1-1', 2, 1, 5),
  node('1-2', 2, 6, 20),
  node('1-2-1', 3, 6, 12),
  node('1-2-2', 3, 13, 20),
  node('ch2', 1, 21, 30),
]

function targets(leaves: readonly string[]): PlanTargets {
  return {
    hasUnit: () => true,
    isLeafUnit: key => leaves.includes(key),
    hasConcept: () => true,
    hasMaterial: () => true,
  }
}

function plan(target: string): PlanRecord {
  return {
    id: 'p',
    goal: 'goal',
    status: 'active',
    steps: [{ n: 1, kind: 'unit', target, why: 'because' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('a unit followed by a deeper node is not a leaf', () => {
  assert.equal(isLeafUnit(structure, 'ch1'), false)
  assert.equal(isLeafUnit(structure, '1-2'), false)
  assert.equal(isLeafUnit(structure, '1-1'), true)
  assert.equal(isLeafUnit(structure, '1-2-2'), true)
  assert.equal(isLeafUnit(structure, 'ch2'), true)
  assert.equal(isLeafUnit(structure, 'missing'), false)
})

test('a route refuses a parent target', () => {
  assert.deepEqual(validatePlan(plan('m:1-1'), targets(['m:1-1'])), [])
  const issues = validatePlan(plan('m:1-2'), targets(['m:1-1']))
  assert.equal(issues.length, 1)
  assert.match(issues[0]!, /父节/)
})

function tocOf(rows: readonly StructureNode[]): TocRow[] {
  return rows.map(entry => ({
    uid: entry.uid,
    title: entry.uid,
    kind: 'section',
    level: entry.level ?? 2,
    pageStart: entry.pageStart,
    pageEnd: entry.pageEnd,
    status: 'new',
    state: 'new',
    concepts: [],
  }))
}

test('a parent TOC row opens the first leaf under it', () => {
  const toc = tocOf(structure)
  assert.equal(firstLeafUnder(toc, 0).uid, '1-1')
  assert.equal(firstLeafUnder(toc, 2).uid, '1-2-1')
  assert.equal(firstLeafUnder(toc, 3).uid, '1-2-1')
  assert.equal(firstLeafUid(toc), '1-1')
})
test('section paging skips parents and stops at the ends', () => {
  const toc = tocOf(structure)
  // ch1 and 1-2 are index rows: paging lands on the leaves around them.
  assert.equal(neighbourLeaf(toc, '1-1', 1)?.uid, '1-2-1')
  assert.equal(neighbourLeaf(toc, '1-1', -1), undefined)
  assert.equal(neighbourLeaf(toc, '1-2-1', -1)?.uid, '1-1')
  assert.equal(neighbourLeaf(toc, '1-2-2', 1)?.uid, 'ch2')
  assert.equal(neighbourLeaf(toc, 'ch2', 1), undefined)
  assert.equal(neighbourLeaf(toc, 'missing', 1), undefined)
})

test('an intro unit is a reading stop of its own', () => {
  const withIntro: StructureNode[] = [
    node('ch3', 1, 571, 639),
    node('3-preamble', 2, 571, 581),
    node('3-1', 2, 581, 588),
  ]
  const toc = tocOf(withIntro)
  assert.equal(neighbourLeaf(toc, '3-preamble', -1), undefined)
  assert.equal(neighbourLeaf(toc, '3-preamble', 1)?.uid, '3-1')
  assert.equal(neighbourLeaf(toc, '3-1', -1)?.uid, '3-preamble')
})
