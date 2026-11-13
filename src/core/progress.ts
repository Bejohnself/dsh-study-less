/**
 * Learning progress: unit SRS state, concept mastery and the review log.
 *
 * The progress document is Host-authored. Every mutation goes through
 * `updateJson`, which serializes writers and bumps the revision the browser
 * sends back as `If-Match`.
 */
import { localDate } from './time.ts'
import { daysBetween } from './time.ts'
import { addDays } from './time.ts'
import { initialCard, intervalDays, reviewCard } from './srs.ts'
import type { LibraryPaths } from './paths.ts'
import { readJson, updateJson } from './store.ts'
import type { ConceptProgress, ProgressFile, Rating, UnitProgress } from './types.ts'

/** Most review events kept per unit. */
export const HISTORY_LIMIT = 100

/** An empty progress document. */
export function emptyProgress(): ProgressFile {
  return { version: 1, revision: 0, units: {}, concepts: {}, updatedAt: new Date().toISOString() }
}

/** Read the progress document. */
export async function readProgress(paths: LibraryPaths): Promise<ProgressFile> {
  return readJson<ProgressFile>(paths.progressFile, emptyProgress())
}

/** The progress entry of a unit, if it exists. */
export function unitProgressOf(progress: ProgressFile, key: string): UnitProgress | undefined {
  return progress.units[key]
}

/** Refresh `updatedAt`/`revision` on a mutated document. */
function touched(progress: ProgressFile): ProgressFile {
  progress.revision += 1
  progress.updatedAt = new Date().toISOString()
  return progress
}

/** Whether a unit has been learned at least once. */
export function isLearned(progress: ProgressFile, key: string): boolean {
  const entry = progress.units[key]
  return entry !== undefined && entry.state !== 'new' && entry.state !== 'suspended'
}

/**
 * First completion of a unit.
 *
 * The first review is scheduled for tomorrow regardless of the model's initial
 * stability: the point of the checkbox is to start the reviewed interval, not to
 * wait days for the first retrieval.
 */
export async function markLearned(
  paths: LibraryPaths,
  key: string,
  options: { rating?: Rating; today?: string } = {},
): Promise<{ progress: ProgressFile; unit: UnitProgress }> {
  const today = options.today ?? localDate()
  const rating = options.rating ?? 3
  let unit: UnitProgress | undefined
  const progress = await updateJson<ProgressFile>(paths.progressFile, emptyProgress(), current => {
    const existing = current.units[key]
    if (existing !== undefined && existing.state !== 'new' && existing.state !== 'suspended') {
      unit = existing
      return current
    }
    const now = new Date().toISOString()
    const next: UnitProgress = {
      state: 'learned',
      firstLearnedAt: now,
      due: addDays(today, 1),
      srs: { ...initialCard(rating), reps: 0, lastRating: undefined },
      history: [{ at: now, rating, source: 'first-learn' }],
    }
    current.units[key] = next
    unit = next
    return touched(current)
  })
  if (unit === undefined) throw new Error(`failed to mark ${key} learned`)
  return { progress, unit }
}

/** Undo a completion; history is kept for audit. */
export async function unmarkLearned(paths: LibraryPaths, key: string): Promise<ProgressFile> {
  return updateJson<ProgressFile>(paths.progressFile, emptyProgress(), current => {
    const existing = current.units[key]
    if (existing === undefined) return current
    existing.state = 'new'
    existing.due = undefined
    return touched(current)
  })
}

/**
 * Record one review (or a manual rating) for a unit.
 * @param options.rating - the rating given.
 * @param options.quizScore - optional score that motivated the rating.
 * @param options.today - local date override (tests/time travel).
 */
export async function recordReview(
  paths: LibraryPaths,
  key: string,
  options: {
    rating: Rating
    quizScore?: number
    today?: string
    targetRetention?: number
    maxIntervalDays?: number
  },
): Promise<{ progress: ProgressFile; unit: UnitProgress }> {
  const today = options.today ?? localDate()
  let unit: UnitProgress | undefined
  const progress = await updateJson<ProgressFile>(paths.progressFile, emptyProgress(), current => {
    const existing = current.units[key]
    if (existing === undefined) throw new Error(`unit ${key} has never been learned`)
    const lastDate = existing.lastReviewedAt ?? existing.firstLearnedAt
    const elapsed = lastDate === undefined ? 0 : Math.max(0, daysBetween(localDate(new Date(lastDate)), today))
    const card = reviewCard(existing.srs, options.rating)
    const interval = intervalDays(card.S, {
      targetRetention: options.targetRetention,
      maxIntervalDays: options.maxIntervalDays,
      fuzzKey: key,
    })
    const now = new Date().toISOString()
    const next: UnitProgress = {
      ...existing,
      state: 'reviewing',
      lastReviewedAt: now,
      due: addDays(today, interval),
      srs: card,
      history: [
        ...existing.history,
        { at: now, rating: options.rating, quizScore: options.quizScore, source: 'review' as const },
      ].slice(-HISTORY_LIMIT),
    }
    // Keep the elapsed time visible to future reviews through the stored card.
    void elapsed
    current.units[key] = next
    unit = next
    return touched(current)
  })
  if (unit === undefined) throw new Error(`failed to record review for ${key}`)
  return { progress, unit }
}

/** One unit that is due for review. */
export interface DueUnit {
  key: string
  due: string
  /** Days overdue; 0 means due today. */
  overdueDays: number
  /** Current difficulty, used to order equal overdues. */
  difficulty: number
}

/** Units due on or before `today`, most urgent first. */
export function dueUnits(progress: ProgressFile, today: string): DueUnit[] {
  const due: DueUnit[] = []
  for (const [key, unit] of Object.entries(progress.units)) {
    if (unit.state !== 'learned' && unit.state !== 'reviewing') continue
    if (unit.due === undefined) continue
    if (unit.due <= today) {
      due.push({
        key,
        due: unit.due,
        overdueDays: Math.max(0, daysBetween(unit.due, today)),
        difficulty: unit.srs.D,
      })
    }
  }
  due.sort((a, b) => b.overdueDays - a.overdueDays || b.difficulty - a.difficulty || a.key.localeCompare(b.key))
  return due
}

/** Update one concept's mastery after an attempt. */
export function applyAttempt(
  progress: ProgressFile,
  conceptId: string,
  correct: boolean,
  at: string = new Date().toISOString(),
): ConceptProgress {
  const existing: ConceptProgress = progress.concepts[conceptId] ?? {
    mastery: 0.5,
    attempts: 0,
    correct: 0,
    streak: 0,
  }
  const mastery = correct ? existing.mastery + 0.15 * (1 - existing.mastery) : existing.mastery * 0.75
  const next: ConceptProgress = {
    mastery: Math.min(1, Math.max(0, Number(mastery.toFixed(4)))),
    attempts: existing.attempts + 1,
    correct: existing.correct + (correct ? 1 : 0),
    streak: correct ? 0 : existing.streak + 1,
    lastSeen: at,
  }
  progress.concepts[conceptId] = next
  return next
}

/** A concept is weak when mastery is low or the last two attempts failed. */
export function isWeak(entry: ConceptProgress | undefined): boolean {
  if (entry === undefined) return true
  return entry.mastery < 0.45 || entry.streak >= 2
}

/** Record attempts for a quiz submission, returning the updated progress. */
export async function recordAttempts(
  paths: LibraryPaths,
  attempts: ReadonlyArray<{ conceptId: string; correct: boolean }>,
): Promise<ProgressFile> {
  return updateJson<ProgressFile>(paths.progressFile, emptyProgress(), current => {
    if (attempts.length === 0) return current
    for (const attempt of attempts) applyAttempt(current, attempt.conceptId, attempt.correct)
    return touched(current)
  })
}
