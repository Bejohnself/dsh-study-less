import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SKY_BOX, buildMasterySky } from '../src/client/masterySky.ts'
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

test('one cluster per section, one star per concept', () => {
  const sky = buildMasterySky([
    section('m:a', [{ id: 'shared' }, { id: 'only-a' }]),
    section('m:b', [{ id: 'shared' }]),
  ])
  assert.equal(sky.length, 2)
  assert.equal(sky[0]?.stars.length, 2)
  assert.equal(sky[1]?.stars.length, 1)
  assert.deepEqual(sky[0]?.stars.find(star => star.id === 'shared')?.sections, [0, 1])
  assert.deepEqual(sky[1]?.stars.find(star => star.id === 'shared')?.sections, [0, 1])
})

test('a shared star takes the strictest threshold and is at target only when every section agrees', () => {
  const sky = buildMasterySky([
    section('m:a', [{ id: 'shared', mastery: 0.8, threshold: 0.75 }]),
    section('m:b', [{ id: 'shared', mastery: 0.8, threshold: 0.85 }]),
  ])
  assert.equal(sky[0]?.stars[0]?.threshold, 0.85)
  assert.equal(sky[0]?.stars[0]?.atTarget, false)
})

test('stars stay inside the field, keep their distance, and do not move between renders', () => {
  const states = Array.from({ length: 12 }, (_, index) => ({ id: `c${String(index)}` }))
  const sections = [section('m:a', states), section('m:b', states.slice(0, 5))]
  const first = buildMasterySky(sections)
  const second = buildMasterySky(sections)
  for (const cluster of first) {
    for (const star of cluster.stars) {
      assert.ok(star.x > 0 && star.x < SKY_BOX, `x out of field: ${String(star.x)}`)
      assert.ok(star.y > 0 && star.y < SKY_BOX, `y out of field: ${String(star.y)}`)
    }
    for (let left = 0; left < cluster.stars.length; left += 1) {
      for (let right = left + 1; right < cluster.stars.length; right += 1) {
        const a = cluster.stars[left]!
        const b = cluster.stars[right]!
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        assert.ok(distance >= 10, `stars ${a.id}/${b.id} overlap: ${distance.toFixed(1)}`)
      }
    }
  }
  assert.deepEqual(second.map(cluster => cluster.stars.map(star => [star.x, star.y])), first.map(cluster => cluster.stars.map(star => [star.x, star.y])))
})

test('the main star follows the weakest concept of its section', () => {
  const sky = buildMasterySky([
    section('m:a', [{ id: 'strong', mastery: 0.95 }, { id: 'weak', mastery: 0.52 }]),
    section('m:b', [{ id: 'done', mastery: 0.9 }]),
  ])
  assert.equal(sky[0]?.mastery, 0.52)
  assert.equal(sky[0]?.atTarget, false)
  assert.equal(sky[1]?.atTarget, true)
  assert.equal(sky[1]?.atTargetCount, 1)
})

test('no sections means no sky', () => {
  assert.deepEqual(buildMasterySky([]), [])
})