import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMasteryTree, LEAF_ROW, TREE_PAD } from '../src/client/masteryTree.ts'
import type { PlanSectionView } from '../src/core/views.ts'

/** One section with the given concepts; mastery and threshold live on the states. */
function section(
  target: string,
  states: Array<{ id: string; mastery?: number; threshold?: number }>,
  atTarget = states.every(state => (state.mastery ?? 0.9) >= (state.threshold ?? 0.75)),
): PlanSectionView {
  const conceptStates = states.map(state => ({
    id: state.id,
    name: state.id,
    mastery: state.mastery ?? 0.9,
    threshold: state.threshold ?? 0.75,
    atTarget: (state.mastery ?? 0.9) >= (state.threshold ?? 0.75),
  }))
  const mastery = conceptStates.length === 0 ? 0 : Math.min(...conceptStates.map(state => state.mastery))
  return {
    target,
    title: target,
    level: 2,
    threshold: 0.75,
    concepts: conceptStates.map(state => state.id),
    mastery,
    atTarget,
    conceptStates,
  }
}

test('a concept required by two sections is one leaf with two edges', () => {
  const tree = buildMasteryTree([
    section('m:a', [{ id: 'shared' }, { id: 'only-a' }]),
    section('m:b', [{ id: 'shared' }]),
  ])
  assert.equal(tree.leaves.length, 2)
  const shared = tree.leaves.find(leaf => leaf.id === 'shared')
  assert.deepEqual(shared?.sections, [0, 1])
  assert.equal(tree.edges.filter(edge => edge.leaf === tree.leaves.indexOf(shared!)).length, 2)
  assert.equal(tree.branches.length, 2)
})

test('collapsing a branch hides its own leaves but keeps a shared leaf', () => {
  const sections = [
    section('m:a', [{ id: 'shared' }, { id: 'only-a' }, { id: 'a2' }, { id: 'a3' }]),
    section('m:b', [{ id: 'shared' }, { id: 'only-b' }]),
  ]
  const open = buildMasteryTree(sections)
  const closed = buildMasteryTree(sections, new Set(['m:a']))
  assert.equal(open.leaves.length, 5)
  assert.equal(closed.leaves.length, 2)
  assert.ok(!closed.leaves.some(leaf => leaf.id === 'only-a'))
  assert.ok(closed.leaves.some(leaf => leaf.id === 'shared'))
  assert.equal(closed.branches[0]?.collapsed, true)
  // No edge may start at the collapsed branch, even for a leaf that still shows.
  assert.ok(!closed.edges.some(edge => edge.branch === 0))
  assert.ok(closed.height < open.height)
})

test('a shared leaf takes the strictest threshold and is at target only when every section agrees', () => {
  const tree = buildMasteryTree([
    section('m:a', [{ id: 'shared', mastery: 0.8, threshold: 0.75 }]),
    section('m:b', [{ id: 'shared', mastery: 0.8, threshold: 0.85 }]),
  ])
  assert.equal(tree.leaves.length, 1)
  assert.equal(tree.leaves[0]?.threshold, 0.85)
  assert.equal(tree.leaves[0]?.atTarget, false)
})

test('rows stack downward and each branch sits between its own leaves', () => {
  const tree = buildMasteryTree([
    section('m:a', [{ id: 'a1' }, { id: 'a2' }]),
    section('m:b', [{ id: 'b1' }]),
  ])
  const ys = tree.leaves.map(leaf => leaf.y)
  assert.deepEqual(ys, [...ys].sort((left, right) => left - right))
  assert.equal(ys[0], TREE_PAD + LEAF_ROW / 2)
  const branchA = tree.branches[0]!
  assert.equal(branchA.y, (tree.leaves[0]!.y + tree.leaves[1]!.y) / 2)
  assert.ok(tree.height >= tree.leaves.at(-1)!.y + LEAF_ROW / 2 + TREE_PAD - 0.001)
})

test('sections without concepts still get a branch row', () => {
  const tree = buildMasteryTree([section('m:empty', [], false), section('m:a', [{ id: 'a1' }])])
  assert.equal(tree.branches.length, 2)
  assert.equal(tree.branches[0]?.conceptCount, 0)
  assert.equal(tree.leaves.length, 1)
  assert.ok(tree.branches[0]!.y < tree.branches[1]!.y)
})