/**
 * The closure gate and boundary arithmetic of one goal.
 *
 * Everything here is pure so the rules can be tested without a library on disk:
 * which steps count, how many pages the minimal set is, and whether a goal may
 * be closed. The gate is the product's anti-self-deception mechanism — see
 * docs/POSITIONING.md §4. Do not loosen it without changing the document first.
 */
import type { AttemptRecord, Coverage, JudgeVerdict, PlanRecord, PlanStep, Provenance, SufficiencyItem } from './types.ts'

/** Independent attempts required before a goal may be closed. */
export const INDEPENDENT_NEEDED = 3

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
  const counted = plan.steps.filter(step => coverageOf(step) !== 'skip')
  return { done: counted.filter(step => step.done).length, total: counted.length }
}

/** How the attempts were reached, counted for the gate badge. */
export interface ProvenanceCounts {
  independent: number
  judged: number
  unverified: number
}

/** Count attempts by attribution. */
export function provenanceCounts(attempts: readonly AttemptRecord[]): ProvenanceCounts {
  const counts: ProvenanceCounts = { independent: 0, judged: 0, unverified: 0 }
  for (const attempt of attempts) {
    if (attempt.provenance === 'independent') counts.independent += 1
    else if (attempt.provenance === 'judged') counts.judged += 1
    else counts.unverified += 1
  }
  return counts
}

/** Below this confidence a verdict is not trusted as a pass. */
export const JUDGE_CONFIDENCE_FLOOR = 0.6

/**
 * Normalize what the model said into a verdict.
 *
 * A pass is only trusted when the model was confident; anything unknown becomes
 * `partial` so it cannot close a goal by accident.
 */
export function normalizeVerdict(raw: unknown, confidence: unknown): JudgeVerdict {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  const score = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 1
  const verdict: JudgeVerdict = value === 'pass' ? 'pass' : value === 'fail' ? 'fail' : 'partial'
  if (verdict === 'pass' && score < JUDGE_CONFIDENCE_FLOOR) return 'partial'
  return verdict
}

/**
 * Whether a question counts as passed.
 *
 * An answer passes when the judge said so, or when the user overruled it and
 * wrote down why. Self-evaluation is allowed but never silent.
 */
export function effectivePass(item: SufficiencyItem): boolean {
  return item.selfPass === true || item.verdict === 'pass'
}

/** Whether one question was judged by a model rather than by the user. */
export function isSelfJudged(item: SufficiencyItem): boolean {
  return item.selfPass === true || (item.verdict === undefined && item.passed === true)
}

/** Whether one goal has enough evidence to be closed. */
export interface GateStatus {
  independent: number
  independentNeeded: number
  judged: number
  unverified: number
  /** Mastery points passed and total (0/0 for plans without a map). */
  masteryPassed: number
  masteryTotal: number
  /** Sufficiency questions passed and asked. */
  passed: number
  asked: number
  /** Passed questions a model judged, and passed ones the user judged. */
  aiJudged: number
  selfJudged: number
  /** Normalized threshold in [0, 1]. */
  threshold: number
  ready: boolean
  /** Every unmet condition, in the order the user should fix them. */
  reasons: string[]
}

/** Normalize a stored threshold to [0, 1]. */
export function thresholdOf(plan: PlanRecord): number {
  const value = plan.threshold
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_THRESHOLD
  return Math.min(1, Math.max(0, value))
}

/** Evaluate the closure gate of one goal. */
export function gateStatus(plan: PlanRecord): GateStatus {
  const attempts = plan.attempts ?? []
  const counts = provenanceCounts(attempts)
  const questions = plan.sufficiency ?? []
  const mastery = plan.mastery ?? []
  const masteryPassed = mastery.filter(point => point.passedAt !== undefined).length
  const passed = questions.filter(item => effectivePass(item)).length
  const selfJudged = questions.filter(item => effectivePass(item) && isSelfJudged(item)).length
  const threshold = thresholdOf(plan)
  const reasons: string[] = []
  if ((plan.deliverable ?? '').trim().length === 0) {
    reasons.push('缺少交付物：先写清这次要交出什么，边界才有依据')
  }
  if (counts.independent < INDEPENDENT_NEEDED) {
    reasons.push(`独立证据 ${counts.independent}/${INDEPENDENT_NEEDED}：至少 3 次不看 AI 的尝试`)
  }
  if (mastery.length > 0 && masteryPassed < mastery.length) {
    reasons.push(
      `掌握点 ${masteryPassed}/${mastery.length}：还有 ${mastery.length - masteryPassed} 个没在过关测试里通过`,
    )
  }
  if (questions.length === 0) {
    reasons.push('还没有判定题：写 3–10 道「答得出就算够了」的问题')
  } else if (passed / questions.length < threshold) {
    reasons.push(`判定通过 ${passed}/${questions.length}，低于 ${Math.round(threshold * 100)}%`)
  }
  const unanswered = questions.filter(
    item => effectivePass(item) && (item.answer ?? '').trim().length === 0,
  ).length
  if (unanswered > 0) {
    reasons.push(`还有 ${unanswered} 道「通过」没有留下答案：判定题要先写下答案，再判`)
  }
  return {
    independent: counts.independent,
    independentNeeded: INDEPENDENT_NEEDED,
    judged: counts.judged,
    unverified: counts.unverified,
    masteryPassed,
    masteryTotal: mastery.length,
    passed,
    asked: questions.length,
    aiJudged: passed - selfJudged,
    selfJudged,
    threshold,
    ready: reasons.length === 0,
    reasons,
  }
}

/** One stuck point, derived from repeated `stuck` texts. */
export interface StuckPointView {
  text: string
  /** How many attempts stopped here. */
  count: number
  /** Latest attempt that stopped here. */
  lastAt: string
}

/** Group the stuck texts of the attempts, most frequent first. */
export function deriveStuckPoints(attempts: readonly AttemptRecord[]): StuckPointView[] {
  const byKey = new Map<string, StuckPointView>()
  for (const attempt of attempts) {
    const text = (attempt.stuck ?? '').trim()
    if (text.length === 0) continue
    const key = text.toLowerCase()
    const existing = byKey.get(key)
    if (existing === undefined) byKey.set(key, { text, count: 1, lastAt: attempt.at })
    else {
      existing.count += 1
      existing.lastAt = attempt.at
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1))
}

/** Attribution label order used by the UI. */
export const PROVENANCE_ORDER: Provenance[] = ['independent', 'judged', 'adopted-unverified']
