/**
 * Content quality gates.
 *
 * The Host refuses notes and quiz items that do not meet the contract, and the
 * refusal lists every missing piece so the agent can fix one call instead of
 * guessing. The page-range check is the anti-hallucination fence: a note may
 * only cite pages of the unit it belongs to.
 */
import type { QuizItem } from './types.ts'

/** Headings every generated unit must carry, in this order. */
export const REQUIRED_NOTE_HEADINGS = [
  '本节目标',
  '前置知识',
  '核心概念',
  '逐步讲解',
  '类比',
  '常见误区',
  '自测',
  '出处',
] as const

/** Shortest acceptable notes body. */
export const MIN_NOTES_CHARS = 400

/** A unit's page range. */
export interface PageRange {
  pageStart: number
  pageEnd: number
}

/** Validation input for one unit's notes. */
export interface NotesValidationInput {
  markdown: string
  pageRefs: readonly number[]
  concepts: readonly string[]
  range: PageRange
  minChars?: number
}

/** Result of a validation pass. */
export interface ValidationResult {
  ok: boolean
  issues: string[]
}

/** Normalize heading text for comparison (strip markdown markers). */
function headingOf(line: string): string | null {
  const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
  const title = match?.[1]
  return title === undefined ? null : title.trim()
}

/** Validate generated notes against the unit contract. */
export function validateNotes(input: NotesValidationInput): ValidationResult {
  const issues: string[] = []
  const headings = input.markdown
    .split('\n')
    .map(headingOf)
    .filter((value): value is string => value !== null)

  for (const required of REQUIRED_NOTE_HEADINGS) {
    if (!headings.some(heading => heading.startsWith(required))) {
      issues.push(`缺少小节：## ${required}`)
    }
  }

  const minChars = input.minChars ?? MIN_NOTES_CHARS
  if (input.markdown.trim().length < minChars) {
    issues.push(`正文过短：${input.markdown.trim().length} < ${minChars} 字符`)
  }

  if (input.concepts.length === 0) issues.push('没有登记任何概念（concepts 不能为空）')

  if (input.pageRefs.length === 0) issues.push('没有引用任何原书页码（pageRefs 不能为空）')

  for (const page of input.pageRefs) {
    if (!Number.isInteger(page) || page < input.range.pageStart || page > input.range.pageEnd) {
      issues.push(`页码越界：p${page} 不在 ${input.range.pageStart}-${input.range.pageEnd} 之内`)
    }
  }

  if (/<script\b/i.test(input.markdown)) issues.push('正文不能包含 <script>')

  return { ok: issues.length === 0, issues }
}

/** Validate one quiz item against its unit range. */
export function validateQuizItem(item: QuizItem, range: PageRange): string[] {
  const issues: string[] = []
  if (item.question.trim().length === 0) issues.push('题干为空')
  if (item.concepts.length === 0) issues.push('题目没有挂概念')
  if (item.page !== undefined && (item.page < range.pageStart || item.page > range.pageEnd)) {
    issues.push(`页码越界：p${item.page} 不在 ${range.pageStart}-${range.pageEnd} 之内`)
  }
  if (item.type === 'choice') {
    if (item.choices === undefined || item.choices.length < 2) issues.push('选择题至少需要 2 个选项')
    if (item.answerIndex === undefined || item.answerIndex < 0 || item.answerIndex >= (item.choices?.length ?? 0)) {
      issues.push('选择题缺少合法的 answerIndex')
    }
  }
  if (item.type === 'cloze' && (item.answer === undefined || item.answer.trim().length === 0)) {
    issues.push('填空题缺少 answer')
  }
  if ((item.type === 'recall' || item.type === 'apply') && (item.rubric === undefined || item.rubric.length === 0)) {
    issues.push(`${item.type} 题需要 rubric（评分要点）`)
  }
  if (item.type === 'evidence' && (item.page === undefined || item.rubric === undefined || item.rubric.length === 0)) {
    issues.push('evidence 题需要 page 与非空的 rubric')
  }
  return issues
}

/** Validate a quiz bank, including id uniqueness. */
export function validateQuizBank(items: readonly QuizItem[], range: PageRange): ValidationResult {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) issues.push(`重复的题目 id：${item.id}`)
    seen.add(item.id)
    issues.push(...validateQuizItem(item, range).map(issue => `${item.id}: ${issue}`))
  }
  return { ok: issues.length === 0, issues }
}

/** Characters that usually mean a formula was typed as Unicode instead of TeX. */
const UNICODE_MATH = /[√ᵀ∑∏∫∂∇∈∉∀∃]/u

/**
 * Soft warnings about formula style.
 *
 * These never block a write: they tell the authoring agent that a formula was
 * typed with Unicode glyphs instead of `$...$` LaTeX, which the reader cannot
 * typeset.
 * @param markdown - the notes source.
 * @returns one message per offending line, capped.
 */
export function mathStyleWarnings(markdown: string): string[] {
  const warnings: string[] = []
  const lines = markdown.split('\n')
  for (const [index, line] of lines.entries()) {
    if (!UNICODE_MATH.test(line)) continue
    if (line.includes('$')) continue
    if (/^\s*(```|~~~)/.test(line)) continue
    warnings.push(`第 ${index + 1} 行疑似用 Unicode 字符写公式，请改用 $...$ 或 $$...$$ 的 LaTeX`)
    if (warnings.length >= 5) break
  }
  return warnings
}
