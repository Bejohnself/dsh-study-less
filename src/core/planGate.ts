/**
 * Boundary arithmetic of one goal.
 *
 * Which steps count, how many pages the minimal set is, and the stored threshold
 * an old plan file may still carry. Pure on purpose: no library on disk.
 */
import type { Coverage, PlanRecord, PlanStep } from './types.ts'

/** Default pass ratio of the sufficiency questions. */
export const DEFAULT_THRESHOLD = 0.8

/** Boundary decision of one step, defaulting old plans to 'read'. */
export function coverageOf(step: PlanStep): Coverage {
  return step.coverage === 'skim' || step.coverage === 'skip' ? step.coverage : 'read'
}

/** Inclusive page range of one target, as resolved from the manifest. */
export interface PageRange {
  pageStart: number
  pageEnd: number
}

/** Resolve `<material>:<unit>` to its page range, or null when unknown. */
export type PageRangeOf = (target: string) => PageRange | null

/** Page arithmetic of the crop list. */
export interface BoundarySummary {
  /** Steps per decision. */
  read: number
  skim: number
  skip: number
  /** Pages per decision, summed over steps. */
  readPages: number
  skimPages: number
  skipPages: number
  /** Pages that must be read, and pages covered by the whole crop list. */
  minPages: number
  totalPages: number
}

/** Sum the page ranges of a plan, grouped by coverage. */
export function summarizeBoundary(plan: PlanRecord, pages: PageRangeOf): BoundarySummary {
  const summary: BoundarySummary = {
    read: 0,
    skim: 0,
    skip: 0,
    readPages: 0,
    skimPages: 0,
    skipPages: 0,
    minPages: 0,
    totalPages: 0,
  }
  for (const step of plan.steps) {
    if (step.kind !== 'unit' && step.kind !== 'paper-pass') continue
    const range = step.target === undefined ? null : pages(step.target)
    const span = range === null ? 0 : Math.max(0, range.pageEnd - range.pageStart + 1)
    const coverage = coverageOf(step)
    if (coverage === 'skip') {
      summary.skip += 1
      summary.skipPages += span
    } else if (coverage === 'skim') {
      summary.skim += 1
      summary.skimPages += span
    } else {
      summary.read += 1
      summary.readPages += span
    }
    summary.totalPages += span
  }
  summary.minPages = summary.readPages
  return summary
}

/** Progress that leaves skipped ranges out of the denominator. */
export function planProgress(plan: PlanRecord): { done: number; total: number } {
  // Only section steps are part of the route. Legacy drill/compare steps may
  // still sit in old plan files but must not become invisible obligations.
  const counted = plan.steps.filter(
    step => (step.kind === 'unit' || step.kind === 'paper-pass') && coverageOf(step) !== 'skip',
  )
  return { done: counted.filter(step => step.done).length, total: counted.length }
}

/** Normalize a stored threshold to [0, 1]. */
export function thresholdOf(plan: PlanRecord): number {
  const value = plan.threshold
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_THRESHOLD
  return Math.min(1, Math.max(0, value))
}
