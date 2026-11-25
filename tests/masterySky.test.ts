import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKY_H,
  SKY_MAIN_R,
  SKY_W,
  brightnessOf,
  buildMasterySky,
  glowOf,
  goldOf,
  zoomTransform,
} from '../src/client/masterySky.ts'
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
  const mastery = conceptStates.length === 0 ? 0 : conceptStates.reduce((sum, state) => sum + state.mastery, 0) / conceptStates.length
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

test('sections follow one spiral arm from the inside out', () => {
  const states = Array.from({ length: 6 }, (_, index) => ({ id: `c${String(index)}` }))
  const map = buildMasterySky([section('m:a', states), section('m:b', states)])
  assert.equal(map.width, SKY_W)
  assert.equal(map.height, SKY_H)
  const center = { x: map.width / 2, y: map.height / 2 }
  const radii = map.order.map(index => {
    const section = map.sections[index]!
    return Math.hypot(section.x - center.x, section.y - center.y)
  })
  for (let index = 1; index < radii.length; index += 1) {
    assert.ok(radii[index]! > radii[index - 1]!, 'the arm must grow outward')
  }
})

test('sections that share a concept are laid out next to each other', () => {
  const map = buildMasterySky([
    section('m:a', [{ id: 'x' }]),
    section('m:b', [{ id: 'y' }]),
    section('m:c', [{ id: 'x' }]),
  ])
  const positionOf = (index: number): number => map.order.indexOf(index)
  assert.equal(Math.abs(positionOf(0) - positionOf(2)), 1)
})

test('a shared concept is one star, placed between the sections that need it', () => {
  const map = buildMasterySky([
    section('m:a', [{ id: 'shared' }, { id: 'only-a' }]),
    section('m:b', [{ id: 'shared' }]),
  ])
  assert.equal(map.stars.length, 2)
  const shared = map.stars.find(star => star.id === 'shared')!
  assert.deepEqual(shared.sections, [0, 1])
  const [a, b] = map.sections
  const middle = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
  assert.ok(Math.hypot(shared.x - middle.x, shared.y - middle.y) < 45, 'shared star is not near both sections')
})

test('skim sections are marked but keep their stars for the zoomed view', () => {
  const map = buildMasterySky(
    [section('m:a', [{ id: 'x' }, { id: 'y' }]), section('m:b', [{ id: 'z' }])],
    { skim: new Set(['m:b']) },
  )
  assert.equal(map.sections[0]?.coverage, 'read')
  assert.equal(map.sections[1]?.coverage, 'skim')
  assert.equal(map.stars.length, 3, 'a skim section still carries its concepts for zoom')
  assert.ok(map.stars.some(star => star.id === 'z'))
})

test('stars stay inside the canvas, apart from each other and from every main star', () => {
  const states = Array.from({ length: 12 }, (_, index) => ({ id: `c${String(index)}` }))
  const map = buildMasterySky([section('m:a', states), section('m:b', states.slice(0, 5)), section('m:c', states.slice(3, 9))])
  for (const star of map.stars) {
    assert.ok(star.x > 0 && star.x < SKY_W, `star x escapes canvas: ${star.id}`)
    assert.ok(star.y > 0 && star.y < SKY_H, `star y escapes canvas: ${star.id}`)
  }
  for (let left = 0; left < map.stars.length; left += 1) {
    for (let right = left + 1; right < map.stars.length; right += 1) {
      const a = map.stars[left]!
      const b = map.stars[right]!
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 9.5, `stars overlap: ${a.id}/${b.id}`)
    }
  }
  for (const star of map.stars) {
    for (const skySection of map.sections) {
      assert.ok(
        Math.hypot(star.x - skySection.x, star.y - skySection.y) >= SKY_MAIN_R + star.r - 0.5,
        `star ${star.id} overlaps the main star of ${skySection.target}`,
      )
    }
  }
})

test('zooming an open section centres it on the canvas', () => {
  const map = buildMasterySky([section('m:a', [{ id: 'x' }, { id: 'y' }]), section('m:b', [{ id: 'z' }])])
  const target = map.sections[1]!
  const view = zoomTransform(target)
  assert.equal(view.tx + target.x * view.scale, SKY_W / 2)
  assert.equal(view.ty + target.y * view.scale, SKY_H / 2)
})

test('positions, order and stars are stable between renders', () => {
  const sections = [section('m:a', [{ id: 'x' }, { id: 'y' }]), section('m:b', [{ id: 'x' }]), section('m:c', [{ id: 'y' }])]
  const first = buildMasterySky(sections)
  const second = buildMasterySky(sections)
  assert.deepEqual(
    second.stars.map(star => [star.x, star.y, star.r]),
    first.stars.map(star => [star.x, star.y, star.r]),
  )
  assert.deepEqual(second.order, first.order)
})

test('a shared star takes the strictest threshold and is at target only when every section agrees', () => {
  const map = buildMasterySky([
    section('m:a', [{ id: 'shared', mastery: 0.8, threshold: 0.75 }]),
    section('m:b', [{ id: 'shared', mastery: 0.8, threshold: 0.85 }]),
  ])
  assert.equal(map.stars[0]?.threshold, 0.85)
  assert.equal(map.stars[0]?.atTarget, false)
})

test('the main star follows the mean mastery of its section', () => {
  const map = buildMasterySky([
    section('m:a', [{ id: 'strong', mastery: 0.95 }, { id: 'weak', mastery: 0.52 }]),
    section('m:b', [{ id: 'done', mastery: 0.9 }]),
  ])
  assert.ok(Math.abs((map.sections[0]?.mastery ?? 0) - 0.735) < 1e-9)
  assert.equal(map.sections[0]?.atTarget, false)
  assert.equal(map.sections[1]?.atTarget, true)
})

test('mastery spreads the brightness, not just tints it', () => {
  assert.ok(brightnessOf(0.5) < 0.6, 'a half-learned star must look half dark')
  assert.ok(brightnessOf(0.9) > 0.85)
  assert.ok(brightnessOf(0.9) - brightnessOf(0.5) > 0.35, 'the gap is what the eye reads')
  assert.ok(brightnessOf(0) >= 0.1, 'never fully disappears')
  assert.ok(brightnessOf(2) <= 1 && brightnessOf(-1) >= 0, 'clamped')
  assert.ok(glowOf(0.9) > glowOf(0.5) && glowOf(0.5) > glowOf(0.1))
})

test('gold only shows up once a concept is well learned', () => {
  assert.equal(goldOf(0.5), 0)
  assert.equal(goldOf(0.55), 0)
  assert.ok(goldOf(0.75) >= 40 && goldOf(0.75) <= 60)
  assert.equal(goldOf(0.95), 100)
  assert.equal(goldOf(1.4), 100)
  assert.equal(goldOf(-1), 0)
})

test('no sections means an empty map', () => {
  const map = buildMasterySky([])
  assert.deepEqual(map.sections, [])
  assert.deepEqual(map.stars, [])
  assert.equal(map.width, SKY_W)
})