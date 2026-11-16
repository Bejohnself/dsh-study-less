/**
 * The smallest review unit: one failed sufficiency question.
 *
 * A goal owns its cards. Writing a card is the only way the review queue grows,
 * and closing the goal retires them, so the queue can never turn into an
 * ever-growing debt (docs/POSITIONING.md §3).
 */
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryPaths } from './paths.ts'
import { initialCard, intervalDays, reviewCard } from './srs.ts'
import { readJson, writeJsonAtomic } from './store.ts'
import { addDays, localDate } from './time.ts'
import type { CardRecord, Rating } from './types.ts'

/** Most review events kept per card. */
const HISTORY_LIMIT = 60

/** Deterministic card id of one sufficiency question. */
export function judgementCardId(planId: string, questionId: string): string {
  return `j-${planId}-${questionId}`
}

/** Read one card, or null when it does not exist. */
export async function readCard(paths: LibraryPaths, cardId: string): Promise<CardRecord | null> {
  return readJson<CardRecord | null>(paths.cardFile(cardId), null)
}

/** Write one card atomically. */
export async function writeCard(paths: LibraryPaths, card: CardRecord): Promise<void> {
  await writeJsonAtomic(paths.cardFile(card.id), card)
}

/** Delete one card; a missing file is not an error. */
export async function deleteCard(paths: LibraryPaths, cardId: string): Promise<boolean> {
  try {
    await unlink(paths.cardFile(cardId))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Every card on disk. */
export async function listCards(paths: LibraryPaths): Promise<CardRecord[]> {
  let entries: string[]
  try {
    entries = await readdir(paths.cardsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const cards: CardRecord[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const card = await readJson<CardRecord | null>(join(paths.cardsDir, entry), null)
    if (card !== null) cards.push(card)
  }
  cards.sort((a, b) => ((a.due ?? '9999') < (b.due ?? '9999') ? -1 : 1))
  return cards
}

/** Cards due on or before `today`, most overdue first. */
export function dueCards(cards: readonly CardRecord[], today: string): CardRecord[] {
  return cards
    .filter(card => card.state !== 'suspended' && (card.due === undefined || card.due <= today))
    .sort((a, b) => ((a.due ?? '9999') < (b.due ?? '9999') ? -1 : 1))
}

/** Days between a due date and today, never negative. */
export function overdueDays(due: string | undefined, today: string): number {
  if (due === undefined) return 0
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${due}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((a - b) / 86_400_000))
}

/**
 * Write (or refresh) the card of one failed question.
 *
 * A card that already exists keeps its schedule: failing the same question
 * again must not reset the interval, or the queue would thrash.
 */
export async function upsertJudgementCard(
  paths: LibraryPaths,
  input: { planId: string; questionId: string; prompt: string; detail?: string; today?: string },
): Promise<CardRecord> {
  const id = judgementCardId(input.planId, input.questionId)
  const today = input.today ?? localDate()
  const existing = await readCard(paths, id)
  if (existing !== null) {
    existing.prompt = input.prompt
    if (input.detail === undefined) delete existing.detail
    else existing.detail = input.detail
    await writeCard(paths, existing)
    return existing
  }
  const card: CardRecord = {
    version: 1,
    id,
    kind: 'judgement',
    planId: input.planId,
    prompt: input.prompt,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    srs: initialCard(3),
    history: [],
    due: addDays(today, 1),
    state: 'new',
    createdAt: new Date().toISOString(),
  }
  await writeCard(paths, card)
  return card
}

/** Delete every card of one goal; used when the goal closes. */
export async function retirePlanCards(paths: LibraryPaths, planId: string): Promise<number> {
  const cards = (await listCards(paths)).filter(card => card.planId === planId)
  for (const card of cards) await deleteCard(paths, card.id)
  return cards.length
}

/** Apply one rating to a card and schedule its next due date. */
export async function reviewCardOnce(
  paths: LibraryPaths,
  cardId: string,
  options: {
    rating: Rating
    today?: string
    targetRetention?: number
    maxIntervalDays?: number
  },
): Promise<CardRecord> {
  const card = await readCard(paths, cardId)
  if (card === null) throw new Error(`card not found: ${cardId}`)
  const today = options.today ?? localDate()
  const next = reviewCard(card.srs, options.rating)
  const interval = intervalDays(next.S, {
    ...(options.targetRetention === undefined ? {} : { targetRetention: options.targetRetention }),
    ...(options.maxIntervalDays === undefined ? {} : { maxIntervalDays: options.maxIntervalDays }),
    fuzzKey: cardId,
  })
  card.srs = next
  card.due = addDays(today, interval)
  card.lastReviewedAt = new Date().toISOString()
  card.state = 'learned'
  card.history = [...card.history, { at: card.lastReviewedAt, rating: options.rating, source: 'manual' }].slice(-HISTORY_LIMIT)
  await writeCard(paths, card)
  return card
}
