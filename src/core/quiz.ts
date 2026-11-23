/**
 * Quiz ordering and objective grading.
 *
 * Practice order is deterministic: weak concepts first, objective items before
 * subjective ones, easier before harder, and the bank's own order as the final
 * tie-break. The adaptive step uses the same tie-break, so a resumed session
 * replays exactly the same sequence instead of reshuffling.
 */
import type { QuizBank, QuizItem, QuizSessionEntry, QuizSessionScope } from './types.ts'

/** The most questions one practice session asks by default. */
export const DEFAULT_SESSION_LIMIT = 8

/** How strongly a weak concept pulls an item to the front. */
const WEAK_WEIGHT = 3
/** Unpassed knowledge points of this section pull harder than global weakness. */
const FOCUS_WEIGHT = 6
/** Objective items are easier to start with and to score. */
const OBJECTIVE_WEIGHT = 1

/** Whether an item can be graded without asking the reader to self-assess. */
export function isObjectiveItem(item: QuizItem): boolean {
  return item.type === 'choice'
}

/** Whether an item takes a written answer that a model should judge. */
export function needsWrittenJudge(item: QuizItem): boolean {
  return item.type !== 'choice'
}

/**
 * Stable practice order for one bank.
 *
 * `skip` drops items a knowledge point has already been tested on: one question
 * proves a point once, so re-asking it would only waste the reader's time.
 */
export function orderQuizItems(
  bank: QuizBank,
  options: { weakConcepts?: ReadonlySet<string>; skip?: (item: QuizItem) => boolean } = {},
): QuizItem[] {
  const weak = options.weakConcepts ?? new Set<string>()
  const items = options.skip === undefined ? bank.items : bank.items.filter(item => !options.skip!(item))
  const scored = items.map((item, index) => {
    let score = 0
    if (item.concepts.some(concept => weak.has(concept))) score += WEAK_WEIGHT
    if (isObjectiveItem(item)) score += OBJECTIVE_WEIGHT
    return { item, score, difficulty: difficultyOf(item), index }
  })
  scored.sort((a, b) => b.score - a.score || a.difficulty - b.difficulty || a.index - b.index)
  return scored.map(entry => entry.item)
}

/**
 * Normalize a free-text answer for comparison.
 *
 * LaTeX is folded to the form KaTeX would render (`\dfrac` == `\frac`, `\left`
 * and spacing macros are noise), so two spellings of the same formula are not
 * graded differently. Folding stops here: a model judge decides meaning.
 */
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\\[dt]?frac/g, 'frac')
    .replace(/\\left|\\right|\\!|\\,|\\;|\\quad|\\qquad/g, '')
    .replace(/\$+/g, '')
    .replace(/[\s,，。、;；:：!！?？"'“”‘’()（）[\]【】]/g, '')
    .trim()
}

/**
 * Whether a rebuttal is mostly copied from the rubric or explanation.
 *
 * A reader may quote a line and explain it, so this only fires when most of the
 * rebuttal's character n-grams also sit in the scoring material. That catches
 * pasting the whole rubric while leaving paraphrases alone.
 */
export function looksCopiedFromRubric(rebuttal: string, source: readonly string[]): boolean {
  const text = normalizeAnswer(rebuttal)
  if (text.length < 12) return false
  const material = normalizeAnswer(source.join(''))
  if (material.length < 12) return false

  const size = 4
  const sourceGrams = new Set<string>()
  for (let index = 0; index + size <= material.length; index += 1) {
    sourceGrams.add(material.slice(index, index + size))
  }
  let total = 0
  let shared = 0
  for (let index = 0; index + size <= text.length; index += 1) {
    total += 1
    if (sourceGrams.has(text.slice(index, index + size))) shared += 1
  }
  return total > 0 && shared / total >= 0.75
}

/** Grading outcome: objective verdict, or null when a human/agent must grade. */
export type GradeVerdict = { correct: boolean } | { correct: null; reason: 'manual' }

/** Grade an objectively gradable item. */
export function gradeQuizItem(item: QuizItem, answer: unknown): GradeVerdict {
  switch (item.type) {
    case 'choice': {
      const index =
        typeof answer === 'number'
          ? answer
          : typeof answer === 'string' && item.choices !== undefined
            ? item.choices.findIndex(choice => normalizeAnswer(choice) === normalizeAnswer(answer))
            : -1
      return { correct: index === item.answerIndex }
    }
    case 'cloze': {
      if (typeof answer !== 'string' || item.answer === undefined) return { correct: false }
      // A fast path only: an equal spelling is right without a model call. A
      // different spelling (LaTeX variants, synonyms) goes to the judge, so
      // this never decides "wrong" on its own.
      return { correct: normalizeAnswer(answer) === normalizeAnswer(item.answer) }
    }
    case 'evidence': {
      // Locating a page is only half the answer; a page match alone must not
      // grade an explanation. The model judge (or the reader) decides.
      return { correct: null, reason: 'manual' }
    }
    case 'recall':
    case 'apply':
      return { correct: null, reason: 'manual' }
    default:
      return { correct: null, reason: 'manual' }
  }
}

/** The effective difficulty of an item (older banks default to normal). */
export function difficultyOf(item: QuizItem): 1 | 2 | 3 {
  return item.difficulty ?? 2
}

/**
 * One answer's credit toward the rating.
 *
 * A model verdict is authoritative. A self-grade without one is the reader
 * grading themselves: it stays visible in history but is not evidence, so it
 * returns null and never enters the score.
 */
function creditOf(entry: QuizSessionEntry): number | null {
  if (entry.judged !== undefined) {
    return entry.judged.verdict === 'pass' ? 1 : entry.judged.verdict === 'partial' ? 0.5 : 0
  }
  if (entry.selfGrade !== undefined) return null
  if (entry.correct === true) return 1
  if (entry.correct === false) return 0
  return null
}

/** Hard questions weigh more, so a run of easy items cannot fake a pass. */
function weightOf(entry: QuizSessionEntry): number {
  return entry.difficulty === 1 ? 1 : entry.difficulty === 3 ? 2 : 1.5
}

/** What one session's answers add up to. */
export interface QuizScore {
  /** Weighted 0–1; 0 when nothing was graded. */
  score: number
  /** How many answers are evidence (objective or model-judged). */
  graded: number
  correct: number
  partial: number
}

/** Weighted score over the answers that are actually evidence. */
export function scoreQuizSession(entries: readonly QuizSessionEntry[]): QuizScore {
  let weighted = 0
  let total = 0
  let graded = 0
  let correct = 0
  let partial = 0
  for (const entry of entries) {
    const credit = creditOf(entry)
    if (credit === null) continue
    const weight = weightOf(entry)
    weighted += credit * weight
    total += weight
    graded += 1
    if (credit === 1) correct += 1
    else if (credit === 0.5) partial += 1
  }
  return { score: total === 0 ? 0 : weighted / total, graded, correct, partial }
}

/** Where one section's knowledge points stand after the answers so far. */
export interface ConceptStatus {
  passed: string[]
  pending: string[]
  /** True when every target has a passing answer, not necessarily in a row. */
  all: boolean
}

/**
 * Latest verdict per knowledge point.
 *
 * A point passes when its most recent answer is a full pass; a later wrong
 * answer reopens it. Points with no answer stay pending.
 */
export function conceptStatus(
  entries: readonly QuizSessionEntry[],
  targets: readonly string[],
): ConceptStatus {
  const latest = new Map<string, QuizSessionEntry>()
  for (const entry of entries) {
    for (const concept of entry.concepts ?? []) latest.set(concept, entry)
  }
  const passed: string[] = []
  const pending: string[] = []
  for (const target of targets) {
    const entry = latest.get(target)
    if (entry !== undefined && creditOf(entry) === 1) passed.push(target)
    else pending.push(target)
  }
  return { passed, pending, all: targets.length > 0 && pending.length === 0 }
}

/** Whether two items train at least one shared concept. */
export function sharesConcept(a: QuizItem, b: QuizItem): boolean {
  const concepts = new Set(b.concepts)
  return a.concepts.some(concept => concepts.has(concept))
}

/** Whether two sessions draw from the same bank. */
export function sameQuizScope(a: QuizSessionScope, b: QuizSessionScope): boolean {
  if (a.kind === 'unit' && b.kind === 'unit') {
    return a.material === b.material && a.unit === b.unit
  }
  if (a.kind === 'book' && b.kind === 'book') {
    return a.book === b.book && (a.chapter ?? '') === (b.chapter ?? '')
  }
  return false
}

/**
 * Pick the next adaptive item.
 *
 * Wrong answers retreat to the same concept at an equal-or-easier difficulty;
 * right answers move to the same concept at an equal-or-harder difficulty.
 * Knowledge points not yet passed pull ahead of everything else. If neither
 * applies, any unattempted item is used; ties follow the bank's order, so a
 * resumed session cannot reshuffle the sequence. `skip` removes items whose
 * question is already spent on one of its knowledge points.
 */
export function pickAdaptiveNext(
  items: readonly QuizItem[],
  options: {
    asked: ReadonlySet<string>
    current: QuizItem
    correct: boolean | null
    /** Knowledge points still pending; items on them are chosen first. */
    focus?: ReadonlySet<string>
    /** Items that must not be offered again (question already used). */
    skip?: (item: QuizItem) => boolean
  },
): QuizItem | undefined {
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(
      entry =>
        entry.item.id !== options.current.id &&
        !options.asked.has(entry.item.id) &&
        options.skip?.(entry.item) !== true,
    )
  if (candidates.length === 0) return undefined
  const currentDifficulty = difficultyOf(options.current)
  const focus = options.focus

  const score = (item: QuizItem): number => {
    let value = 0
    if (focus !== undefined && item.concepts.some(concept => focus.has(concept))) value += FOCUS_WEIGHT
    if (isObjectiveItem(item)) value += 1
    if (sharesConcept(item, options.current)) value += 4
    const difficulty = difficultyOf(item)
    if (options.correct === false) {
      if (difficulty < currentDifficulty) value += 3
      else if (difficulty === currentDifficulty) value += 2
    } else if (options.correct === true) {
      if (difficulty > currentDifficulty) value += 3
      else if (difficulty === currentDifficulty) value += 2
    }
    return value
  }

  const ranked = candidates
    .map(entry => ({ item: entry.item, index: entry.index, score: score(entry.item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  return ranked[0]?.item
}
