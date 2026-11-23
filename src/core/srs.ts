/**
 * FSRS-inspired scheduling, kept as pure functions so it can be tested with
 * fixed vectors and later swapped for a full FSRS implementation.
 *
 * The model keeps a stability S (days) and difficulty D (1..10). Retrievability
 * follows the FSRS power curve `R(t) = (1 + t / (9S))^-1`; the interval that
 * lands on the target retention is the inverse of that curve. Every function is
 * deterministic: the interval fuzz is derived from a caller-provided key, not
 * from randomness, so the same unit always schedules identically.
 */
import type { Rating, SrsCard } from './types.ts'

/** Initial stability per rating (again / hard / good / easy). */
const INITIAL_STABILITY = [0.4, 1.2, 3.2, 8.0] as const

/** Stability growth factor per rating on a successful review. */
const STABILITY_GAIN = [0, 0.15, 0.45, 0.8] as const

/** Difficulty delta per rating. */
const DIFFICULTY_DELTA = [1.0, 0.2, -0.3, -0.8] as const

/** Lower bound of stability in days. */
export const MIN_STABILITY = 0.1

/** Upper bound of stability in days (ten years). */
export const MAX_STABILITY = 3650

/** Default target retention. */
export const DEFAULT_TARGET_RETENTION = 0.9

/** Default maximum interval in days. */
export const DEFAULT_MAX_INTERVAL_DAYS = 365

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/** Difficulty the model starts from, before the first rating shifts it. */
function difficultyFor(rating: Rating): number {
  return clamp(5.5 - 1.2 * (rating - 3), 1, 10)
}

/** A fresh card seeded from the rating given at first completion. */
export function initialCard(rating: Rating): SrsCard {
  return {
    S: INITIAL_STABILITY[rating - 1] ?? 1.2,
    D: difficultyFor(rating),
    reps: 0,
    lapses: 0,
    lastRating: rating,
  }
}

/** The FSRS power curve. */
export function retrievability(stability: number, elapsedDays: number): number {
  const s = Math.max(MIN_STABILITY, stability)
  const elapsed = Math.max(0, elapsedDays)
  return 1 / (1 + elapsed / (9 * s))
}

/**
 * Apply one review to a card.
 * @param card - current card state.
 * @param rating - the rating the reviewer gave.
 * @param elapsedDays - days since the previous review (ignored for rating 1).
 * @returns the next card state.
 */
export function reviewCard(card: SrsCard, rating: Rating): SrsCard {
  if (rating === 1) {
    return {
      S: Math.max(MIN_STABILITY, 0.4 * card.S),
      D: clamp(card.D + 1, 1, 10),
      reps: card.reps,
      lapses: card.lapses + 1,
      lastRating: 1,
    }
  }
  const growth = 1 + (STABILITY_GAIN[rating - 1] ?? 0) * ((11 - card.D) / 10)
  return {
    S: clamp(card.S * growth, MIN_STABILITY, MAX_STABILITY),
    D: clamp(card.D + (DIFFICULTY_DELTA[rating - 1] ?? 0), 1, 10),
    reps: card.reps + 1,
    lapses: card.lapses,
    lastRating: rating,
  }
}

/** Stable 32-bit hash used for deterministic fuzz. */
export function hash32(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Fuzz in [0.95, 1.05], deterministic per key. */
export function intervalFuzz(key: string): number {
  return 0.95 + (hash32(key) % 1000) / 10000
}

/**
 * Interval in days that lands on the target retention.
 * @param stability - card stability in days.
 * @param options - target retention, fuzz key, maximum interval.
 * @returns a whole number of days, at least 1.
 */
export function intervalDays(
  stability: number,
  options: {
    targetRetention?: number
    fuzzKey?: string
    maxIntervalDays?: number
  } = {},
): number {
  const target = clamp(options.targetRetention ?? DEFAULT_TARGET_RETENTION, 0.5, 0.99)
  const max = Math.max(1, Math.round(options.maxIntervalDays ?? DEFAULT_MAX_INTERVAL_DAYS))
  // R(t) = (1 + t / (9S))^-1  =>  t = 9S * (1/target - 1)
  const raw = 9 * Math.max(MIN_STABILITY, stability) * (1 / target - 1)
  const fuzz = options.fuzzKey === undefined ? 1 : intervalFuzz(options.fuzzKey)
  return clamp(Math.round(raw * fuzz), 1, max)
}

/**
 * Map a quiz score to a review rating.
 * @param score - correctness in [0, 1].
 * @returns the rating implied by the score.
 */
export function ratingFromScore(score: number): Rating {
  if (score >= 0.9) return 4
  if (score >= 0.75) return 3
  if (score >= 0.5) return 2
  return 1
}
