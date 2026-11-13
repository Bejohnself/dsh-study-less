/**
 * Quiz selection and objective grading.
 *
 * Selection is deterministic for a given seed, prioritizes weak concepts, and
 * never repeats an item the caller excludes (the UI excludes items answered in
 * the last week).
 */
import { hash32 } from './srs.ts'
import type { QuizBank, QuizItem } from './types.ts'

/** How strongly a weak concept pulls an item to the front. */
const WEAK_WEIGHT = 3
/** How strongly a requested concept pulls an item to the front. */
const REQUESTED_WEIGHT = 2

/** Options for one selection round. */
export interface QuizSelectionOptions {
  /** Concepts the caller wants to practise. */
  concepts?: readonly string[]
  /** Concepts currently considered weak. */
  weakConcepts?: ReadonlySet<string>
  /** Maximum number of items. */
  limit?: number
  /** Seed for the deterministic shuffle. */
  seed?: string
  /** Items to skip (recently answered). */
  excludeIds?: ReadonlySet<string>
}

/** Pick quiz items from one bank, weak concepts first. */
export function selectQuizItems(bank: QuizBank, options: QuizSelectionOptions = {}): QuizItem[] {
  const limit = Math.max(0, options.limit ?? 5)
  const requested = new Set(options.concepts ?? [])
  const weak = options.weakConcepts ?? new Set<string>()
  const excluded = options.excludeIds ?? new Set<string>()
  const seed = options.seed ?? bank.unit

  const scored = bank.items
    .filter(item => !excluded.has(item.id))
    .map(item => {
      let score = 1
      if (item.concepts.some(concept => weak.has(concept))) score += WEAK_WEIGHT
      if (item.concepts.some(concept => requested.has(concept))) score += REQUESTED_WEIGHT
      return { item, score, order: hash32(`${seed}:${item.id}`) }
    })

  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.slice(0, limit).map(entry => entry.item)
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

/**
 * Pick the next adaptive item.
 *
 * Wrong answers retreat to the same concept at an equal-or-easier difficulty;
 * right answers move to the same concept at an equal-or-harder difficulty; if
 * neither exists, any unattempted item is used. Selection is deterministic for
 * a seed so a refresh cannot reshuffle a session unpredictably.
 */
export function pickAdaptiveNext(
  items: readonly QuizItem[],
  options: {
    asked: ReadonlySet<string>
    current: QuizItem
    correct: boolean | null
    seed?: string
  },
): QuizItem | undefined {
  const candidates = items.filter(item => item.id !== options.current.id && !options.asked.has(item.id))
  if (candidates.length === 0) return undefined
  const seed = options.seed ?? options.current.id
  const currentDifficulty = difficultyOf(options.current)
  const objective = (item: QuizItem): boolean => item.type !== 'recall' && item.type !== 'apply'

  const score = (item: QuizItem): number => {
    let value = 0
    if (objective(item)) value += 1
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
    .map(item => ({ item, score: score(item), order: hash32(`${seed}:${item.id}`) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
  return ranked[0]?.item
}
