/**
 * Layout for the goal's knowledge tree: 目标 → 节（枝）→ 概念（叶）.
 *
 * Concepts are global, so a leaf is drawn once and linked to every section that
 * requires it. That shared edge is the only structure the data really has today
 * (concept-to-concept prerequisites are empty), and it is what tells a hub leaf
 * from one that only one section needs.
 */
import type { PlanSectionView } from '../core/views.ts'

/** Vertical space one leaf row takes, in px. */
export const LEAF_ROW = 24
/** Vertical space a branch takes when it shows no leaves (collapsed or empty). */
export const BRANCH_ROW = 30
/** Breathing room above and below the tree. */
export const TREE_PAD = 8

export interface TreeLeaf {
  id: string
  name: string
  /** Decayed mastery of the concept; the same value in every section. */
  mastery: number
  /** Strictest level threshold among the sections that require it. */
  threshold: number
  /** Dark enough for every section that requires it. */
  atTarget: boolean
  /** Section indexes requiring this concept, in route order. */
  sections: number[]
  /** Centre line of the row. */
  y: number
}

export interface TreeBranch {
  index: number
  target: string
  title: string
  level: number
  mastery: number
  atTarget: boolean
  conceptCount: number
  atTargetCount: number
  collapsed: boolean
  /** Centre line the branch stub and its edges start from. */
  y: number
}

export interface TreeEdge {
  branch: number
  leaf: number
}

export interface MasteryTree {
  leaves: TreeLeaf[]
  branches: TreeBranch[]
  edges: TreeEdge[]
  /** Canvas height in px; the canvas scrolls, so it can exceed the card. */
  height: number
}

/**
 * Build rows for the tree.
 *
 * A collapsed branch keeps its row but hides its own edges, unless another
 * section also needs the leaf — that leaf still shows, because it is not gone.
 */
export function buildMasteryTree(
  sections: readonly PlanSectionView[],
  collapsed: ReadonlySet<string> = new Set<string>(),
): MasteryTree {
  const leafByKey = new Map<string, TreeLeaf>()
  const order: TreeLeaf[] = []
  const sectionKeys: string[][] = []

  // ── 聚合：一个概念一片叶，跨节共用时取最严的档位 ──
  for (const [index, section] of sections.entries()) {
    const keys: string[] = []
    for (const state of section.conceptStates) {
      keys.push(state.id)
      const existing = leafByKey.get(state.id)
      if (existing === undefined) {
        const leaf: TreeLeaf = {
          id: state.id,
          name: state.name,
          mastery: state.mastery,
          threshold: state.threshold,
          atTarget: state.atTarget,
          sections: [index],
          y: 0,
        }
        leafByKey.set(state.id, leaf)
        order.push(leaf)
        continue
      }
      existing.sections.push(index)
      existing.threshold = Math.max(existing.threshold, state.threshold)
      existing.atTarget = existing.atTarget && state.atTarget
    }
    sectionKeys.push(keys)
  }

  // ── 排布：叶按第一次出现的枝顺序往下堆，枝落在自己叶子的中间 ──
  const placed = new Map<string, number>()
  const branches: TreeBranch[] = []
  let cursor = TREE_PAD

  for (const [index, section] of sections.entries()) {
    const isCollapsed = collapsed.has(section.target)
    if (!isCollapsed) {
      for (const key of sectionKeys[index] ?? []) {
        if (placed.has(key)) continue
        const y = cursor + LEAF_ROW / 2
        placed.set(key, y)
        const leaf = leafByKey.get(key)
        if (leaf !== undefined) leaf.y = y
        cursor += LEAF_ROW
      }
    }
    const own = (sectionKeys[index] ?? [])
      .map(key => placed.get(key))
      .filter((y): y is number => y !== undefined)
    let y: number
    if (own.length > 0) {
      y = own.reduce((sum, value) => sum + value, 0) / own.length
    } else {
      y = cursor + BRANCH_ROW / 2
      cursor += BRANCH_ROW
    }
    branches.push({
      index,
      target: section.target,
      title: section.title,
      level: section.level,
      mastery: section.mastery,
      atTarget: section.atTarget,
      conceptCount: section.conceptStates.length,
      atTargetCount: section.conceptStates.filter(state => state.atTarget).length,
      collapsed: isCollapsed,
      y,
    })
  }

  // ── 连线：只连还看得见的叶，折叠的枝不画线 ──
  const leaves = order.filter(leaf => placed.has(leaf.id))
  const visibleIndex = new Map(leaves.map((leaf, index) => [leaf.id, index]))
  const edges: TreeEdge[] = []
  for (const branch of branches) {
    if (branch.collapsed) continue
    for (const key of sectionKeys[branch.index] ?? []) {
      const leafIndex = visibleIndex.get(key)
      if (leafIndex === undefined) continue
      edges.push({ branch: branch.index, leaf: leafIndex })
    }
  }

  const height = Math.max(cursor + TREE_PAD, 96)
  return { leaves, branches, edges, height }
}