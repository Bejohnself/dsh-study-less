import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SKY_MAIN_R, SKY_PAD, SKY_REGION_W, buildMasterySky } from '../src/client/masterySky.ts'
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

test('the whole goal is one map: one section per region, one star per concept copy', () => {
  const map = buildMasterySky([
    section('m:a', [{ id: 'shared' }, { id: 'only-a' }]),
    section('m:b', [{ id: 'shared' }]),
  ])
  assert.equal(map.sections.length, 2)
  assert.equal(map.stars.length, 3)
  assert.equal(map.cols, 2)
  assert.equal(map.sections[0]?.stars.length, 2)
  assert.equal(map.sections[1]?.stars.length, 1)
  assert.ok(map.width > SKY_PAD * 2 && map.height > SKY_PAD * 2)
})

test('a shared concept is drawn once per section and joined by a link', () => {
  const map = buildMasterySky([
    section('m:a', [{ id: 'shared' }, { id: 'only-a' }]),
    section('m:b', [{ id: 'shared' }]),
    section('m:c', [{ id: 'shared' }]),
  ])
  const copies = map.stars.filter(star => star.id === 'shared')
  assert.deepEqual(copies.map(star => star.section), [0, 1, 2])
  assert.equal(map.links.filter(link => link.concept === 'shared').length, 2)
  assert.ok(map.stars.every(star => star.id === 'shared' || star.sections.length === 1))
})

test('stars sit inside their own region and clear of each other and the main star', () => {
  const states = Array.from({ length: 12 }, (_, index) => ({ id: `c${String(index)}` }))
  const map = buildMasterySky([section('m:a', states), section('m:b', states.slice(0, 5))])
  for (const skySection of map.sections) {
    const stars = skySection.stars.map(index => map.stars[index]!)
    for (const star of stars) {
      assert.ok(Math.abs(star.x - skySection.x) < SKY_REGION_W / 2, `star escapes region: ${star.id}`)
      assert.ok(Math.hypot(star.x - skySection.x, star.y - skySection.y) >= SKY_MAIN_R + star.r, `star touches main: ${star.id}`)
    }
    for (let left = 0; left < stars.length; left += 1) {
      for (let right = left + 1; right < stars.length; right += 1) {
        const a = stars[left]!
        const b = stars[right]!
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 10, `stars overlap: ${a.id}/${b.id}`)
      }
    }
  }
})

test('positions and links are stable between renders', () => {
  const sections = [section('m:a', [{ id: 'x' }, { id: 'y' }]), section('m:b', [{ id: 'x' }])]
  const first = buildMasterySky(sections)
  const second = buildMasterySky(sections)
  assert.deepEqual(
    second.stars.map(star => [star.x, star.y, star.r]),
    first.stars.map(star => [star.x, star.y, star.r]),
  )
  assert.deepEqual(second.links, first.links)
})

test('the main star follows the weakest concept of its section', () => {
  const map = buildMasterySky([
    section('m:a', [{ id: 'strong', mastery: 0.95 }, { id: 'weak', mastery: 0.52 }]),
    section('m:b', [{ id: 'done', mastery: 0.9 }]),
  ])
  assert.equal(map.sections[0]?.mastery, 0.52)
  assert.equal(map.sections[0]?.atTarget, false)
  assert.equal(map.sections[1]?.atTarget, true)
  assert.equal(map.sections[1]?.atTargetCount, 1)
})

test('no sections means an empty map', () => {
  const map = buildMasterySky([])
  assert.deepEqual(map.sections, [])
  assert.deepEqual(map.stars, [])
  assert.equal(map.width, SKY_PAD * 2)
})