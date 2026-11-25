/**
 * Star map for the goal's knowledge points: one canvas, one constellation per
 * section, one star per concept.
 *
 * Sections that share concepts are laid out next to each other, so a shared
 * star simply rises between them — no lines are drawn across the map.
 */
import type { PlanSectionView } from '../core/views.ts'

export const SKY_PAD = 20
export const SKY_REGION_W = 250
export const SKY_REGION_H = 210
export const SKY_COLS_MAX = 3
export const SKY_MAIN_R = 10
const OUTER_CAPACITY = 9
const OUTER_RADIUS = 62
const INNER_RADIUS = 36
/** How far a section's own star may drift from its grid slot. */
const CENTER_JITTER = 10
/** Minimum gap between two concept stars. */
const STAR_GAP = 13
/** Shared stars sit near the middle of the sections that need them. */
const SHARED_OFFSET = 14

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
  /** Section mastery: the weakest concept, so the main star faces the gap. */
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
  cols: number
  sections: SkySection[]
  stars: SkyStar[]
  /** Section indexes in layout order; neighbours here share the most concepts. */
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

/**
 * Scatter position for solo star `slot` of `total`.
 *
 * A golden-angle spiral keeps stars apart without stacking them on rings —
 * rings read as electron shells, which is not what this map is.
 */
function scatterPoint(total: number, slot: number, id: string): { dx: number; dy: number } {
  const golden = 2.399963229728653
  const angle = slot * golden + hash01(id) * 0.9
  const spread = total <= 1 ? 0 : slot / (total - 1)
  const radius = 40 + spread * 54 + (hash01(`${id}:r`) - 0.5) * 8
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius }
}

/** Star radius by threshold: a deeper level asks for a bigger star. */
function starRadius(threshold: number): number {
  const share = Math.max(0, Math.min(1, (threshold - 0.6) / 0.35))
  return Math.round((3.2 + share * 1.8) * 10) / 10
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

/** The whole goal on one canvas: neighbours share stars, so no links are needed. */
export function buildMasterySky(sections: readonly PlanSectionView[]): SkyMap {
  if (sections.length === 0) {
    return { width: SKY_PAD * 2, height: SKY_PAD * 2, cols: 1, sections: [], stars: [], order: [] }
  }
  const cols = Math.max(1, Math.min(SKY_COLS_MAX, Math.ceil(Math.sqrt(sections.length))))
  const rows = Math.max(1, Math.ceil(sections.length / cols))
  const width = cols * SKY_REGION_W + SKY_PAD * 2
  const height = rows * SKY_REGION_H + SKY_PAD * 2

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

  // ── 相邻：共用的节排在路线里相邻，星就落在它们中间 ──
  const order = layoutOrder(owners)
  const centers = sections.map(() => ({ x: 0, y: 0 }))
  order.forEach((sectionIndex, slot) => {
    const row = Math.floor(slot / cols)
    const col = row % 2 === 0 ? slot % cols : cols - 1 - (slot % cols)
    const drift = (hash01(`section:${sections[sectionIndex]!.target}`) - 0.5) * CENTER_JITTER * 2
    centers[sectionIndex] = {
      x: Math.round(SKY_PAD + col * SKY_REGION_W + SKY_REGION_W / 2 + drift),
      y: Math.round(SKY_PAD + row * SKY_REGION_H + SKY_REGION_H / 2 + drift / 2),
    }
  })

  // ── 落星：独占概念绕自己的节转，共用概念落在相关节的重心 ──
  const soloTotal = sections.map(() => 0)
  for (const star of stars) if (star.sections.length === 1) soloTotal[star.sections[0]!]! += 1
  const soloSlot = sections.map(() => 0)
  for (const star of stars) {
    if (star.sections.length === 1) {
      const home = star.sections[0]!
      const center = centers[home]!
      const { dx, dy } = scatterPoint(soloTotal[home]!, soloSlot[home]!, star.id)
      soloSlot[home]! += 1
      star.x = center.x + dx
      star.y = center.y + dy
      continue
    }
    // 重心对四个节的情况会偏向一边，再朝最远的那个节挪几步，让每节都够得着。
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
  const minX = SKY_PAD + 8
  const maxX = width - SKY_PAD - 8
  const minY = SKY_PAD + 8
  const maxY = height - SKY_PAD - 8
  for (let pass = 0; pass < 12; pass += 1) {
    for (let index = 0; index < stars.length; index += 1) {
      const star = stars[index]!
      for (const [sectionIndex] of sections.entries()) {
        const center = centers[sectionIndex]!
        const dx = star.x - center.x
        const dy = star.y - center.y
        const distance = Math.hypot(dx, dy) || 1
        const need = SKY_MAIN_R + star.r + 4
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

  const skySections: SkySection[] = sections.map((section, index) => ({
    index,
    target: section.target,
    title: section.title,
    level: section.level,
    mastery: section.mastery,
    atTarget: section.atTarget,
    conceptCount: section.conceptStates.length,
    atTargetCount: section.conceptStates.filter(state => state.atTarget).length,
    x: centers[index]!.x,
    y: centers[index]!.y,
    soloStars: stars.map((star, starIndex) => (star.sections.length === 1 && star.sections[0] === index ? starIndex : -1)).filter(starIndex => starIndex >= 0),
  }))

  return { width, height, cols, sections: skySections, stars, order }
}