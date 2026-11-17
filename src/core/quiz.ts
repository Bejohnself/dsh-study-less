/**
 * Quiz ordering and objective grading.
 *
 * Practice order is deterministic: weak concepts first, objective items before
 * subjective ones, easier before harder, and the bank's own order as the final
 * tie-break. The adaptive step uses the same tie-break, so a resumed session
 * replays exactly the same sequence instead of reshuffling.
 */
import type { QuizBank, QuizItem, QuizSessionScope } from './types.ts'

/** The most questions one practice session asks by default. */
export const DEFAULT_SESSION_LIMIT = 8

/** How strongly a weak concept pulls an item to the front. */
const WEAK_WEIGHT = 3
/** Objective items are easier to start with and to score. */
const OBJECTIVE_WEIGHT = 1

/** Whether an item can be graded without asking the reader to self-assess. */
export function isObjectiveItem(item: QuizItem): boolean {
  return item.type !== 'recall' && item.type !== 'apply'
}

/** How many questions one session should ask for this bank. */
export function defaultSessionLimit(bank: QuizBank): number {
  return Math.min(DEFAULT_SESSION_LIMIT, bank.items.length)
}

/** Stable practice order for one bank. */
export function orderQuizItems(
  bank: QuizBank,
  options: { weakConcepts?: ReadonlySet<string> } = {},
): QuizItem[] {
  const weak = options.weakConcepts ?? new Set<string>()
  const scored = bank.items.map((item, index) => {
    let score = 0
    if (item.concepts.some(concept => weak.has(concept))) score += WEAK_WEIGHT
    if (isObjectiveItem(item)) score += OBJECTIVE_WEIGHT
    return { item, score, difficulty: difficultyOf(item), index }
  })
  scored.sort((a, b) => b.score - a.score || a.difficulty - b.difficulty || a.index - b.index)
  return scored.map(entry => entry.item)
}

/** Normalize a free-text answer for comparison. */
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s,，。、;；:：!！?？"'“”‘’()（）[\]【】]/g, '')
    .trim()
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
      return { correct: normalizeAnswer(answer) === normalizeAnswer(item.answer) }
    }
    case 'evidence': {
      if (item.page === undefined) return { correct: null, reason: 'manual' }
      const text = String(answer).trim()
      return { correct: text === String(item.page) || text === `p${item.page}` }
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

/** Whether two items train at least one shared concept. */
export function sharesConcept(a: QuizItem, b: QuizItem): boolean {
  const concepts = new Set(b.concepts)
  return a.concepts.some(concept => concepts.has(concept))
}

/** Whether two sessions draw from the same bank. */
export function sameQuizScope(a: QuizSessionScope, b: QuizSessionScope): boolean {
  if (a.kind !== b.kind) return false
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
 * right answers move to the same concept at an equal-or-harder difficulty; if
 * neither exists, any unattempted item is used. Ties follow the bank's order,
 * so a resumed session cannot reshuffle the sequence.
 */
export function pickAdaptiveNext(
  items: readonly QuizItem[],
  options: {
    asked: ReadonlySet<string>
    current: QuizItem
    correct: boolean | null
  },
): QuizItem | undefined {
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(entry => entry.item.id !== options.current.id && !options.asked.has(entry.item.id))
  if (candidates.length === 0) return undefined
  const currentDifficulty = difficultyOf(options.current)

  const score = (item: QuizItem): number => {
    let value = 0
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
