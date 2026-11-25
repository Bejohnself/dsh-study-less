/**
 * Star map for the goal's knowledge points: one canvas, one constellation per
 * section, one star per concept instance, brightness carried by mastery.
 *
 * A concept is global, so it rises again in every section that needs it; `links`
 * joins those copies. Positions are deterministic — a re-render must not
 * reshuffle the sky.
 */
import type { PlanSectionView } from '../core/views.ts'

export const SKY_PAD = 16
export const SKY_REGION_W = 250
export const SKY_REGION_H = 210
/** Room above each constellation for its label. */
const SKY_LABEL_H = 22
export const SKY_COLS_MAX = 3
export const SKY_MAIN_R = 10
const OUTER_CAPACITY = 9
const OUTER_RADIUS = 62
const INNER_RADIUS = 36

export interface SkyStar {
  /** Concept id; repeated once per section that requires it. */
  id: string
  name: string
  mastery: number
  /** Strictest level threshold among the sections that require it. */
  threshold: number
  /** Bright enough for every section that requires it. */
  atTarget: boolean
  /** Section indexes requiring this concept, in route order. */
  sections: number[]
  /** The section this copy belongs to. */
  section: number
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
  /** Indexes into `stars`. */
  stars: number[]
}

export interface SkyLink {
  concept: string
  from: number
  to: number
}

export interface SkyMap {
  width: number
  height: number
  cols: number
  sections: SkySection[]
  stars: SkyStar[]
  links: SkyLink[]
}

/** Stable 0..1 from an id, so jitter does not depend on render order. */
function hash(id: string): number {
  let value = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    value = Math.imul(value ^ id.charCodeAt(index), 16777619)
  }
  return (value >>> 0) / 4294967296
}

/** Orbit position for star `slot` of `total`, nudged by the concept id. */
function orbitPoint(total: number, slot: number, id: string): { dx: number; dy: number } {
  const outerCount = Math.min(total, OUTER_CAPACITY)
  const inner = slot >= outerCount
  const count = inner ? total - outerCount : outerCount
  const place = inner ? slot - outerCount : slot
  // Stagger the inner ring so it does not line up with the outer spokes.
  const angle = (place / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2 + (inner ? Math.PI / Math.max(3, count) : 0)
  const radius = (inner ? INNER_RADIUS : OUTER_RADIUS) + (hash(id) - 0.5) * 7
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius }
}

/** Star radius by threshold: a deeper level asks for a bigger star. */
function starRadius(threshold: number): number {
  const share = Math.max(0, Math.min(1, (threshold - 0.6) / 0.35))
  return Math.round((3.2 + share * 1.8) * 10) / 10
}

/** One big map: sections sit on a grid, their concepts orbit the section star. */
export function buildMasterySky(sections: readonly PlanSectionView[]): SkyMap {
  if (sections.length === 0) {
    return { width: SKY_PAD * 2, height: SKY_PAD * 2, cols: 1, sections: [], stars: [], links: [] }
  }
  const cols = Math.max(1, Math.min(SKY_COLS_MAX, Math.ceil(Math.sqrt(sections.length))))
  const rows = Math.max(1, Math.ceil(sections.length / cols))
  const width = cols * SKY_REGION_W + SKY_PAD * 2
  const height = rows * SKY_REGION_H + SKY_PAD * 2

  // ── 共用关系：概念在哪些节里出现，决定星径与共用标记 ──
  const owner = new Map<string, { sections: number[]; threshold: number; atTarget: boolean }>()
  for (const [index, section] of sections.entries()) {
    for (const state of section.conceptStates) {
      const existing = owner.get(state.id)
      if (existing === undefined) {
        owner.set(state.id, { sections: [index], threshold: state.threshold, atTarget: state.atTarget })
        continue
      }
      existing.sections.push(index)
      existing.threshold = Math.max(existing.threshold, state.threshold)
      existing.atTarget = existing.atTarget && state.atTarget
    }
  }

  // ── 排布：每节一团，星星绕着自己的主星 ──
  const stars: SkyStar[] = []
  const starByConcept = new Map<string, number[]>()
  const skySections: SkySection[] = sections.map((section, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const x = Math.round(SKY_PAD + col * SKY_REGION_W + SKY_REGION_W / 2)
    const y = Math.round(SKY_PAD + row * SKY_REGION_H + SKY_REGION_H / 2 + SKY_LABEL_H / 2)
    const indexes: number[] = []
    section.conceptStates.forEach((state, slot) => {
      const shared = owner.get(state.id)
      const { dx, dy } = orbitPoint(section.conceptStates.length, slot, state.id)
      const threshold = shared?.threshold ?? state.threshold
      const star: SkyStar = {
        id: state.id,
        name: state.name,
        mastery: state.mastery,
        threshold,
        atTarget: shared?.atTarget ?? state.atTarget,
        sections: shared?.sections ?? [index],
        section: index,
        x: x + dx,
        y: y + dy,
        r: starRadius(threshold),
      }
      indexes.push(stars.length)
      stars.push(star)
      const copies = starByConcept.get(state.id)
      if (copies === undefined) starByConcept.set(state.id, [stars.length - 1])
      else copies.push(stars.length - 1)
    })
    return {
      index,
      target: section.target,
      title: section.title,
      level: section.level,
      mastery: section.mastery,
      atTarget: section.atTarget,
      conceptCount: section.conceptStates.length,
      atTargetCount: section.conceptStates.filter(state => state.atTarget).length,
      x,
      y,
      stars: indexes,
    }
  })

  // ── 连线：同一个概念的几份星用虚线连起来，读作「几节共用」 ──
  const links: SkyLink[] = []
  for (const [concept, copies] of starByConcept) {
    for (let index = 1; index < copies.length; index += 1) {
      links.push({ concept, from: copies[index - 1]!, to: copies[index]! })
    }
  }

  return { width, height, cols, sections: skySections, stars, links }
}