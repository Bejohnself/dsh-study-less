/**
 * Star map for the goal's knowledge points: one spiral galaxy, one star per
 * concept, brightness carried by mastery.
 *
 * Sections follow the learning order along a single arm; sections that share a
 * concept end up next to each other, so the shared star rises between them with
 * no lines across the map. `skim` sections are only a dim dot in the overview.
 */
import type { PlanSectionView } from '../core/views.ts'

/** Overview canvas, deliberately small: the detail comes from zooming in. */
export const SKY_W = 760
export const SKY_H = 460
export const SKY_MAIN_R = 8
/** How much an opened section grows in place. */
export const SKY_ZOOM_SCALE = 2.8
const SPIRAL_X = 1.38
const SPIRAL_Y = 0.82
const OUTER_CAPACITY = 9
const OUTER_RADIUS = 26
const INNER_RADIUS = 14
const CENTER_JITTER = 8
const STAR_GAP = 10

export type SkyCoverage = 'read' | 'skim'

export interface SkyStar {
  id: string
  name: string
  mastery: number
  /** Strictest level threshold among the sections that require it. */
  threshold: number
  /** Bright enough for every section that requires it. */
  atTarget: boolean
  /** Section indexes requiring this concept, in route order. */
  sections: number[]
  x: number
  y: number
  r: number
}

export interface SkySection {
  index: number
  target: string
  title: string
  level: number
  /** Overview draws a skim section as one dim dot, not a constellation. */
  coverage: SkyCoverage
  /** Section mastery: the mean of its concepts, so the main star reads the cluster. */
  mastery: number
  atTarget: boolean
  conceptCount: number
  atTargetCount: number
  x: number
  y: number
  /** Star indexes that only this section needs. */
  soloStars: number[]
}

export interface SkyMap {
  width: number
  height: number
  sections: SkySection[]
  stars: SkyStar[]
  /** Section indexes in route order; neighbours here share the most concepts. */
  order: number[]
}

/** Stable 0..1 from an id: jitter and animation phases must not depend on render order. */
export function hash01(id: string): number {
  let value = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    value = Math.imul(value ^ id.charCodeAt(index), 16777619)
  }
  return (value >>> 0) / 4294967296
}

/** Orbit position for solo star `slot` of `total`, nudged by the concept id. */
function orbitPoint(total: number, slot: number, id: string): { dx: number; dy: number } {
  const outerCount = Math.min(total, OUTER_CAPACITY)
  const inner = slot >= outerCount
  const count = inner ? total - outerCount : outerCount
  const place = inner ? slot - outerCount : slot
  // Stagger the inner ring so it does not line up with the outer spokes.
  const angle = (place / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2 + (inner ? Math.PI / Math.max(3, count) : 0)
  const radius = (inner ? INNER_RADIUS : OUTER_RADIUS) + (hash01(id) - 0.5) * 5
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius }
}

/** Star radius by threshold: a deeper level asks for a bigger star. */
function starRadius(threshold: number): number {
  const share = Math.max(0, Math.min(1, (threshold - 0.6) / 0.35))
  return Math.round((2.2 + share * 1.4) * 10) / 10
}

/**
 * How lit a star is, given mastery.
 *
 * The curve is deliberately steep: 0.5 lights the core only, 0.95 nearly blows
 * out. A linear map made half-learned and well-known stars look the same.
 */
export function brightnessOf(mastery: number): number {
  const value = Math.max(0, Math.min(1, mastery))
  return Math.round((0.15 + Math.pow(value, 1.6) * 0.85) * 100) / 100
}

/**
 * How far a star drifts from ink towards gold, in percent.
 *
 * Brightness alone was hard to read on this parchment background; a warm shift
 * is what people actually see at a glance.
 */
export function goldOf(mastery: number): number {
  const value = Math.max(0, Math.min(1, mastery))
  return Math.round(Math.max(0, Math.min(1, (value - 0.55) / 0.4)) * 100)
}

/** Halo strength; dimmer than the core so a bright star reads as bright. */
export function glowOf(mastery: number): number {
  const value = Math.max(0, Math.min(1, mastery))
  return Math.round((0.04 + Math.pow(value, 1.8) * 0.7) * 100) / 100
}

/** Translate/scale that centres one section in the overview when opened. */
export function zoomTransform(section: SkySection): { scale: number; tx: number; ty: number } {
  return {
    scale: SKY_ZOOM_SCALE,
    tx: SKY_W / 2 - section.x * SKY_ZOOM_SCALE,
    ty: SKY_H / 2 - section.y * SKY_ZOOM_SCALE,
  }
}

/** Number of concepts two sections must both learn. */
function sharedCount(left: Set<string>, right: readonly string[]): number {
  let count = 0
  for (const id of right) if (left.has(id)) count += 1
  return count
}

/** Greedy route over sections: each step takes the neighbour sharing the most. */
function layoutOrder(conceptIds: ReadonlyArray<readonly string[]>): number[] {
  const sets = conceptIds.map(ids => new Set(ids))
  const left = new Set(conceptIds.map((_, index) => index))
  // Start from the most connected section so shared stars land near the middle.
  let start = 0
  let bestDegree = -1
  for (const index of left) {
    const degree = sets.reduce((sum, set, other) => sum + (other === index ? 0 : sharedCount(set, conceptIds[index]!)), 0)
    if (degree > bestDegree) {
      start = index
      bestDegree = degree
    }
  }
  const order = [start]
  left.delete(start)
  while (left.size > 0) {
    const last = sets[order[order.length - 1]!]!
    let pick = -1
    let pickScore = -1
    for (const index of left) {
      const score = sharedCount(last, conceptIds[index]!)
      if (score > pickScore) {
        pick = index
        pickScore = score
      }
    }
    order.push(pick)
    left.delete(pick)
  }
  return order
}

/** One arm: radius grows with the slot, so the galaxy is not a grid. */
function spiralPoint(slot: number, total: number, id: string): { x: number; y: number } {
  if (total <= 1) return { x: SKY_W / 2, y: SKY_H / 2 }
  const t = slot / (total - 1)
  const turns = total <= 4 ? 0.55 : 0.95
  const inner = total <= 4 ? 60 : 104
  const outer = total <= 4 ? 150 : 206
  const angle = -Math.PI / 2 + t * turns * Math.PI * 2
  const radius = inner + t * (outer - inner)
  const drift = (hash01(`section:${id}`) - 0.5) * CENTER_JITTER * 2
  return {
    x: SKY_W / 2 + Math.cos(angle) * radius * SPIRAL_X + drift,
    y: SKY_H / 2 + Math.sin(angle) * radius * SPIRAL_Y + drift / 2,
  }
}

/** The whole goal on one spiral arm: neighbours in route order sit next to each other. */
export function buildMasterySky(
  sections: readonly PlanSectionView[],
  options: { skim?: ReadonlySet<string> } = {},
): SkyMap {
  if (sections.length === 0) {
    return { width: SKY_W, height: SKY_H, sections: [], stars: [], order: [] }
  }

  // ── 一概念一星：先记住谁要它，再决定画在哪 ──
  const stars: SkyStar[] = []
  const starByConcept = new Map<string, number>()
  const owners = sections.map(() => [] as string[])
  for (const [index, section] of sections.entries()) {
    for (const state of section.conceptStates) {
      owners[index]!.push(state.id)
      const existing = starByConcept.get(state.id)
      if (existing !== undefined) {
        const star = stars[existing]!
        star.sections.push(index)
        star.threshold = Math.max(star.threshold, state.threshold)
        star.atTarget = star.atTarget && state.atTarget
        continue
      }
      starByConcept.set(state.id, stars.length)
      stars.push({
        id: state.id,
        name: state.name,
        mastery: state.mastery,
        threshold: state.threshold,
        atTarget: state.atTarget,
        sections: [index],
        x: 0,
        y: 0,
        r: starRadius(state.threshold),
      })
    }
  }

  // ── 排位：按共用关系排出的路线铺到旋臂上 ──
  const order = layoutOrder(owners)
  const centers = sections.map(() => ({ x: 0, y: 0 }))
  order.forEach((sectionIndex, slot) => {
    centers[sectionIndex] = spiralPoint(slot, sections.length, sections[sectionIndex]!.target)
  })

  // ── 落星：独占概念绕自己的节转，共用概念落在相关节的重心 ──
  const soloTotal = sections.map(() => 0)
  for (const star of stars) if (star.sections.length === 1) soloTotal[star.sections[0]!]! += 1
  const soloSlot = sections.map(() => 0)
  for (const star of stars) {
    if (star.sections.length === 1) {
      const home = star.sections[0]!
      const center = centers[home]!
      const { dx, dy } = orbitPoint(soloTotal[home]!, soloSlot[home]!, star.id)
      soloSlot[home]! += 1
      star.x = center.x + dx
      star.y = center.y + dy
      continue
    }
    // 重心对多个节的情况会偏向一边，再朝最远的那个节挪几步，让每节都够得着。
    let x = star.sections.reduce((sum, index) => sum + centers[index]!.x, 0) / star.sections.length
    let y = star.sections.reduce((sum, index) => sum + centers[index]!.y, 0) / star.sections.length
    for (let step = 0; step < 60; step += 1) {
      let far = star.sections[0]!
      let farDistance = -1
      for (const index of star.sections) {
        const center = centers[index]!
        const distance = Math.hypot(x - center.x, y - center.y)
        if (distance > farDistance) {
          farDistance = distance
          far = index
        }
      }
      const target = centers[far]!
      x += (target.x - x) * 0.06
      y += (target.y - y) * 0.06
    }
    const angle = hash01(star.id) * Math.PI * 2
    star.x = x + Math.cos(angle) * 6
    star.y = y + Math.sin(angle) * 6
  }

  // ── 让开：星不压主星、不互相压，也别跑出画布 ──
  const minX = 12
  const maxX = SKY_W - 12
  const minY = 12
  const maxY = SKY_H - 12
  for (let pass = 0; pass < 12; pass += 1) {
    for (let index = 0; index < stars.length; index += 1) {
      const star = stars[index]!
      for (const [sectionIndex] of sections.entries()) {
        const center = centers[sectionIndex]!
        const dx = star.x - center.x
        const dy = star.y - center.y
        const distance = Math.hypot(dx, dy) || 1
        const need = SKY_MAIN_R + star.r + 3
        if (distance < need) {
          star.x = center.x + (dx / distance) * need
          star.y = center.y + (dy / distance) * need
        }
      }
      for (let other = index + 1; other < stars.length; other += 1) {
        const peer = stars[other]!
        const dx = peer.x - star.x
        const dy = peer.y - star.y
        const distance = Math.hypot(dx, dy) || 1
        if (distance >= STAR_GAP) continue
        const push = (STAR_GAP - distance) / 2
        star.x -= (dx / distance) * push
        star.y -= (dy / distance) * push
        peer.x += (dx / distance) * push
        peer.y += (dy / distance) * push
      }
      star.x = Math.min(maxX, Math.max(minX, star.x))
      star.y = Math.min(maxY, Math.max(minY, star.y))
    }
  }

  const skim = options.skim
  const skySections: SkySection[] = sections.map((section, index) => ({
    index,
    target: section.target,
    title: section.title,
    level: section.level,
    coverage: skim?.has(section.target) === true ? 'skim' : 'read',
    mastery: section.mastery,
    atTarget: section.atTarget,
    conceptCount: section.conceptStates.length,
    atTargetCount: section.conceptStates.filter(state => state.atTarget).length,
    x: centers[index]!.x,
    y: centers[index]!.y,
    soloStars: stars.map((star, starIndex) => (star.sections.length === 1 && star.sections[0] === index ? starIndex : -1)).filter(starIndex => starIndex >= 0),
  }))

  return { width: SKY_W, height: SKY_H, sections: skySections, stars, order }
}