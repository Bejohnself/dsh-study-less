/**
 * Goal-driven learning plans.
 *
 * A plan is the cross-material answer to "what should I read to understand X".
 * Steps point at real units, real concepts and real materials; the Host refuses
 * a plan whose targets do not exist, so a recommendation can always be opened.
 */
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSegment, splitUnitKey } from './ids.ts'
import type { LibraryPaths } from './paths.ts'
import { readJson, writeJsonAtomic } from './store.ts'
import { coverageOf } from './planGate.ts'
import type { MasteryPoint, PlanRecord, PlanStep } from './types.ts'

/** Read one plan, or null when missing. */
export async function readPlan(paths: LibraryPaths, planId: string): Promise<PlanRecord | null> {
  return readJson<PlanRecord | null>(paths.planFile(planId), null)
}

/** Write one plan, refreshing `updatedAt` and renumbering steps. */
export async function writePlan(paths: LibraryPaths, plan: PlanRecord): Promise<void> {
  assertSegment(plan.id, 'plan id')
  plan.steps = plan.steps.map((step, index) => ({ ...step, n: index + 1 }))
  plan.updatedAt = new Date().toISOString()
  await writeJsonAtomic(paths.planFile(plan.id), plan)
}

/** Delete one plan; missing files are ignored. */
export async function deletePlan(paths: LibraryPaths, planId: string): Promise<boolean> {
  try {
    await unlink(paths.planFile(planId))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** List every plan. */
export async function listPlans(paths: LibraryPaths): Promise<PlanRecord[]> {
  let entries: string[]
  try {
    entries = await readdir(paths.plansDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const plans: PlanRecord[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const plan = await readJson<PlanRecord | null>(join(paths.plansDir, entry), null)
    if (plan !== null) plans.push(plan)
  }
  plans.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return plans
}

/** Who a plan can point at. */
export interface PlanTargets {
  /** Whether `<material>:<unit>` resolves to a real unit. */
  hasUnit(key: string): boolean
  /** Whether a concept id exists. */
  hasConcept(id: string): boolean
  /** Whether a material exists. */
  hasMaterial(id: string): boolean
}

/** Validate step targets; returns human-readable issues. */
export function validatePlan(plan: PlanRecord, targets: PlanTargets): string[] {
  const issues: string[] = []
  if (plan.goal.trim().length === 0) issues.push('计划缺少目标（goal）')
  // A draft is the placeholder written when the user creates a goal; the Agent
  // fills its steps later, so an empty draft is valid until then.
  if (plan.steps.length === 0) {
    return plan.status === 'draft' ? issues : [...issues, '计划没有任何步骤']
  }
  for (const [index, step] of plan.steps.entries()) {
    const label = `第 ${index + 1} 步`
    if (step.why.trim().length === 0) issues.push(`${label} 缺少理由（why）`)
    if (step.kind === 'unit' || step.kind === 'paper-pass') {
      if (step.target === undefined) {
        issues.push(`${label} 缺少 target`)
        continue
      }
      try {
        splitUnitKey(step.target)
      } catch {
        issues.push(`${label} 的 target 不是 <material>:<unit>：${step.target}`)
        continue
      }
      if (!targets.hasUnit(step.target)) issues.push(`${label} 指向不存在的单元：${step.target}`)
    } else if (step.kind === 'drill') {
      if (step.concepts === undefined || step.concepts.length === 0) {
        issues.push(`${label} 没有概念`)
        continue
      }
      for (const conceptId of step.concepts) {
        if (!targets.hasConcept(conceptId)) issues.push(`${label} 指向不存在的概念：${conceptId}`)
      }
    } else if (step.kind === 'compare') {
      if (step.materials === undefined || step.materials.length < 2) {
        issues.push(`${label} 至少需要两份材料`)
        continue
      }
      for (const materialId of step.materials) {
        if (!targets.hasMaterial(materialId)) issues.push(`${label} 指向不存在的资料：${materialId}`)
      }
    }
  }
  return issues
}

/**
 * The next unfinished step of one plan.
 *
 * Steps the user cropped out ('skip') are never suggested, and 'read' ranges
 * win over 'skim' ones: the minimal set is what the goal actually needs.
 */
export function nextStep(plan: PlanRecord): PlanStep | undefined {
  const open = plan.steps.filter(step => !step.done && coverageOf(step) !== 'skip')
  return open.find(step => coverageOf(step) === 'read') ?? open[0]
}

/** Turn the next unfinished step into a jump target. */
export function stepTarget(step: PlanStep): { material: string; unit: string } | null {
  if (step.target === undefined) return null
  const { materialId, unitId } = splitUnitKey(step.target)
  return { material: materialId, unit: unitId }
}

/**
 * The mastery points that belong to one unit.
 *
 * Points without a target are goal-level and never appear in a unit's practice.
 */
export function masteryPointsFor(plan: PlanRecord, target: string): MasteryPoint[] {
  return (plan.mastery ?? []).filter(point => point.target === target)
}

/**
 * Mark one mastery point as passed.
 * This is the single writer of goal-mastery progress: the quiz session calls it
 * after an AI-judged pass. Passing is monotonic, so an appeal that revises an
 * old answer can add evidence but never removes a point.
 */
export async function markMasteryPassed(
  paths: LibraryPaths,
  planId: string,
  pointId: string,
  at: string = new Date().toISOString(),
): Promise<boolean> {
  const plan = await readPlan(paths, planId)
  if (plan === null) return false
  const point = (plan.mastery ?? []).find(candidate => candidate.id === pointId)
  if (point === undefined || point.passedAt !== undefined) return false
  point.passedAt = at
  await writePlan(paths, plan)
  return true
}

/** The goal currently driving today; newest active wins. */
export function activePlan(plans: readonly PlanRecord[]): PlanRecord | undefined {
  return [...plans]
    .filter(plan => plan.status === 'active')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
}

/** Concepts one goal requires in one unit, with the deepest required level. */
export function goalTargetsForUnit(
  plan: PlanRecord,
  target: string,
): Map<string, { level: MasteryLevel; pointId: string }> {
  const out = new Map<string, { level: MasteryLevel; pointId: string }>()
  for (const point of plan.mastery ?? []) {
    if (point.target !== target) continue
    for (const conceptId of point.concepts ?? []) {
      const level = point.level ?? 2
      const existing = out.get(conceptId)
      if (existing === undefined || level > existing.level) out.set(conceptId, { level, pointId: point.id })
    }
  }
  return out
}

/** Every concept one goal requires, with its deepest level. */
export function goalConcepts(plan: PlanRecord): Map<string, MasteryLevel> {
  const out = new Map<string, MasteryLevel>()
  for (const point of plan.mastery ?? []) {
    for (const conceptId of point.concepts ?? []) {
      const level = point.level ?? 2
      const existing = out.get(conceptId)
      if (existing === undefined || level > existing) out.set(conceptId, level)
    }
  }
  return out
}
