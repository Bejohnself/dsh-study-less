/**
 * Star layout for the goal's knowledge sky: one cluster per section, one star
 * per concept, brightness carried by mastery.
 *
 * A concept is global, so the same star shows up in every cluster that needs
 * it; `sections` on the star is what marks it as shared (the ring in the view).
 * Positions are deterministic — a re-render must not reshuffle the sky.
 */
import type { PlanSectionView } from '../core/views.ts'

/** Square star field inside one cluster, in px. */
export const SKY_BOX = 172
export const SKY_CENTER = SKY_BOX / 2
/** Radius of the cluster's own star. */
export const SKY_MAIN_R = 9
/** Up to this many concepts sit on the outer ring; the rest use an inner ring. */
const OUTER_CAPACITY = 9
const OUTER_RADIUS = 60
const INNER_RADIUS = 34

export interface SkyStar {
  id: string
  name: string
  mastery: number
  /** Strictest level threshold among the sections that require it. */
  threshold: number
  /** Dark enough for every section that requires it. */
  atTarget: boolean
  /** Section indexes requiring this concept, in route order. */
  sections: number[]
  x: number
  y: number
  r: number
}

export interface SkyCluster {
  index: number
  target: string
  title: string
  level: number
  /** Section mastery: the weakest concept, so the main star faces the gap. */
  mastery: number
  atTarget: boolean
  conceptCount: number
  atTargetCount: number
  stars: SkyStar[]
}

/** Stable 0..1 from an id, so jitter does not depend on render order. */
function hash(id: string): number {
  let value = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    value = Math.imul(value ^ id.charCodeAt(index), 16777619)
  }
  return (value >>> 0) / 4294967296
}

/** Ring position for star `index` of `total`, nudged by the concept id. */
function starPoint(total: number, index: number, id: string): { x: number; y: number } {
  const outerCount = Math.min(total, OUTER_CAPACITY)
  const inner = index >= outerCount
  const count = inner ? total - outerCount : outerCount
  const slot = inner ? index - outerCount : index
  // Stagger the inner ring so it does not line up with the outer spokes.
  const angle = (slot / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2 + (inner ? Math.PI / Math.max(3, count) : 0)
  const radius = (inner ? INNER_RADIUS : OUTER_RADIUS) + (hash(id) - 0.5) * 7
  return {
    x: SKY_CENTER + Math.cos(angle) * radius,
    y: SKY_CENTER + Math.sin(angle) * radius,
  }
}

/** Star radius by threshold: a deeper level asks for a bigger star. */
function starRadius(threshold: number): number {
  const share = Math.max(0, Math.min(1, (threshold - 0.6) / 0.35))
  return Math.round((3.2 + share * 1.8) * 10) / 10
}

/** Build one constellation per required section, sharing concept metadata. */
export function buildMasterySky(sections: readonly PlanSectionView[]): SkyCluster[] {
  // ── 共用关系：概念在哪些节里出现，决定星星的共用环与最严档位 ──
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

  // ── 排布：每节一团，星星在场上环成一个圈 ──
  return sections.map((section, index) => {
    const stars: SkyStar[] = section.conceptStates.map((state, slot) => {
      const shared = owner.get(state.id)
      const point = starPoint(section.conceptStates.length, slot, state.id)
      return {
        id: state.id,
        name: state.name,
        mastery: state.mastery,
        threshold: shared?.threshold ?? state.threshold,
        atTarget: shared?.atTarget ?? state.atTarget,
        sections: shared?.sections ?? [index],
        ...point,
        r: starRadius(shared?.threshold ?? state.threshold),
      }
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
      stars,
    }
  })
}