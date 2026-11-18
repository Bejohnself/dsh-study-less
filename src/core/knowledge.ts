/**
 * The knowledge space: one record per concept.
 *
 * Practice answers, reviews and time all write here. A section is only a
 * source of questions; it is never a second progress store. Each record keeps
 * a mastery estimate, its FSRS schedule and deduplicated evidence, so repeating
 * the same question can never inflate progress.
 *
 * Decay is computed on read, not written: a concept does not lose history just
 * because the app was closed for a month.
 */
import type { LibraryPaths } from './paths.ts'
import { initialCard, intervalDays, reviewCard } from './srs.ts'
import { readJson, updateJson, writeJsonAtomic } from './store.ts'
import { addDays, daysBetween, localDate } from './time.ts'
import type { ConceptProgress, ProgressFile, Rating, SrsCard } from './types.ts'

/** Default mastery a concept must reach. */
export const DEFAULT_TARGET = 0.8
/** Default horizon (days) used for final settlement until goals carry one. */
export const DEFAULT_HORIZON_DAYS = 90
/** Mastery half-life: after this many idle days the gap to the floor halves. */
export const DECAY_HALF_LIFE_DAYS = 45
/** Decay never drops below this share of the concept's peak mastery. */
export const DECAY_FLOOR_RATIO = 0.5
/** FSRS intervals are capped so a settled concept does not drift for years. */
export const MAX_SCHEDULE_DAYS = 180
/** A concept is only settled when the next review is at least this far out. */
export const SETTLE_MIN_DAYS = 30

/** What one answer proved. */
export type EvidenceVerdict = 'pass' | 'partial' | 'fail'

/** One deduplicated answer, keyed by question fingerprint. */
export interface ConceptEvidence {
  verdict: EvidenceVerdict
  difficulty: 1 | 2 | 3
  at: string
}

/** The state of one concept in the knowledge space. */
export interface ConceptState {
  mastery: number
  /** Highest mastery reached; decay has a floor relative to it. */
  peak: number
  streak: number
  attempts: number
  correct: number
  lastAt?: string
  /** Local date `YYYY-MM-DD` of the next review. */
  due?: string
  srs: SrsCard
  /** Per-concept target override; absent means the default. */
  target?: number
  /** Set when the concept is done for the current horizon. */
  settledAt?: string
  /** Question fingerprint → latest verdict. One question counts once. */
  evidence: Record<string, ConceptEvidence>
}

/** The single knowledge document (`knowledge.json`). */
export interface KnowledgeFile {
  version: 1
  concepts: Record<string, ConceptState>
  updatedAt: string
}

/** What one answer contributes. */
export interface EvidenceInput {
  conceptId: string
  /** Normalized question fingerprint; the ledger dedupes by this, not by item id. */
  fingerprint: string
  verdict: EvidenceVerdict
  difficulty?: 1 | 2 | 3
  at?: string
}

/** An empty knowledge document. */
export function emptyKnowledge(): KnowledgeFile {
  return { version: 1, concepts: {}, updatedAt: new Date().toISOString() }
}

/**
 * Stable fingerprint of a question.
 *
 * Item ids are reused when a bank is regenerated (`q1..qN`), so they cannot
 * identify evidence. The normalized question text can.
 */
export function questionFingerprint(question: string): string {
  const text = question
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\s,，。、;；:：!！?？"'“”‘’()（）[\]【】]/g, '')
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `q-${(hash >>> 0).toString(36)}-${String(text.length)}`
}

/** FSRS rating implied by a verdict and the question's difficulty. */
function ratingFor(verdict: EvidenceVerdict, difficulty: 1 | 2 | 3): Rating {
  if (verdict === 'fail') return 1
  if (verdict === 'partial') return 2
  return difficulty >= 3 ? 3 : 4
}

/** Mastery gain for one answer; a repeated question counts as review. */
function nextMastery(
  state: ConceptState,
  verdict: EvidenceVerdict,
  difficulty: 1 | 2 | 3,
  repeat: boolean,
): number {
  const factor = repeat ? 0.3 : 1
  if (verdict === 'fail') return clamp01(state.mastery * (1 - 0.25 * factor))
  const credit = verdict === 'pass' ? 1 : 0.5
  const learningRate = (0.1 + 0.05 * (difficulty - 1)) * factor * credit
  return clamp01(state.mastery + learningRate * (1 - state.mastery))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, Number(value.toFixed(4))))
}

/** The state of a concept that never had evidence. */
function freshState(): ConceptState {
  return {
    mastery: 0.5,
    peak: 0.5,
    streak: 0,
    attempts: 0,
    correct: 0,
    srs: initialCard(3),
    evidence: {},
  }
}

/**
 * Apply one answer to one concept.
 *
 * The update is deterministic: the model only supplies the verdict and the
 * difficulty. Re-answering the same fingerprint counts as review (0.3 weight),
 * and new evidence reopens a settled concept.
 */
export function applyEvidence(existing: ConceptState | undefined, input: EvidenceInput): ConceptState {
  const state = existing ?? freshState()
  const at = input.at ?? new Date().toISOString()
  const day = localDate(new Date(at))
  const difficulty = input.difficulty ?? 2
  const repeat = state.evidence[input.fingerprint] !== undefined
  const rating = ratingFor(input.verdict, difficulty)
  const srs = state.attempts === 0 ? initialCard(rating) : reviewCard(state.srs, rating)
  const mastery = nextMastery(state, input.verdict, difficulty, repeat)
  return {
    mastery,
    peak: Math.max(state.peak, mastery),
    streak: input.verdict === 'fail' ? state.streak + 1 : 0,
    attempts: state.attempts + 1,
    correct: state.correct + (input.verdict === 'pass' ? 1 : 0),
    lastAt: at,
    due: addDays(
      day,
      intervalDays(srs.S, { maxIntervalDays: MAX_SCHEDULE_DAYS, fuzzKey: input.conceptId }),
    ),
    srs,
    ...(state.target === undefined ? {} : { target: state.target }),
    evidence: { ...state.evidence, [input.fingerprint]: { verdict: input.verdict, difficulty, at } },
  }
}

/** Mastery after idle decay. Pure: it never writes. */
export function decayedMastery(state: ConceptState, today: string = localDate()): number {
  if (state.lastAt === undefined) return state.mastery
  const last = localDate(new Date(state.lastAt))
  const days = daysBetween(last, today)
  if (!Number.isFinite(days) || days <= 0) return state.mastery
  const floor = state.peak * DECAY_FLOOR_RATIO
  if (state.mastery <= floor) return state.mastery
  return clamp01(floor + (state.mastery - floor) * Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS))
}

/** Effective target of one concept. */
export function targetOf(state: ConceptState | undefined): number {
  return state?.target ?? DEFAULT_TARGET
}

/** Review interval implied by a state's FSRS card. */
export function reviewIntervalDays(state: ConceptState, conceptId: string): number {
  return intervalDays(state.srs.S, {
    maxIntervalDays: MAX_SCHEDULE_DAYS,
    fuzzKey: conceptId,
  })
}

/**
 * Settle a concept when the next review falls past the horizon.
 *
 * Only reached concepts settle, and only when reviewing again could not change
 * the outcome before the horizon. A new answer reopens it automatically.
 */
export function settleIfDone(
  state: ConceptState,
  options: { conceptId: string; target?: number; horizonDays?: number; today?: string },
): ConceptState {
  if (state.settledAt !== undefined) return state
  const today = options.today ?? localDate()
  if (decayedMastery(state, today) < (options.target ?? targetOf(state))) return state
  const horizon = Math.max(0, options.horizonDays ?? DEFAULT_HORIZON_DAYS)
  const dueIn = state.due === undefined ? reviewIntervalDays(state, options.conceptId) : daysBetween(today, state.due)
  if (!Number.isFinite(dueIn)) return state
  if (dueIn <= Math.max(SETTLE_MIN_DAYS, horizon * 1.5)) return state
  return { ...state, settledAt: new Date().toISOString() }
}

/** One due concept for the review queue. */
export interface DueConcept {
  conceptId: string
  due: string
  overdueDays: number
  mastery: number
  target: number
}

/** Concepts whose review date has arrived, most overdue first. */
export function dueConcepts(file: KnowledgeFile, today: string = localDate()): DueConcept[] {
  const out: DueConcept[] = []
  for (const [conceptId, state] of Object.entries(file.concepts)) {
    if (state.settledAt !== undefined) continue
    if (state.due === undefined || state.due > today) continue
    const mastery = decayedMastery(state, today)
    out.push({
      conceptId,
      due: state.due,
      overdueDays: Math.max(0, daysBetween(state.due, today)),
      mastery,
      target: targetOf(state),
    })
  }
  out.sort((a, b) => b.overdueDays - a.overdueDays || a.mastery - b.mastery || a.conceptId.localeCompare(b.conceptId))
  return out
}

/** Concepts below target, weakest first. */
export function belowTarget(file: KnowledgeFile, today: string = localDate()): DueConcept[] {
  const out: DueConcept[] = []
  for (const [conceptId, state] of Object.entries(file.concepts)) {
    if (state.settledAt !== undefined) continue
    const mastery = decayedMastery(state, today)
    const target = targetOf(state)
    if (mastery >= target) continue
    out.push({ conceptId, due: state.due ?? today, overdueDays: 0, mastery, target })
  }
  out.sort((a, b) => a.mastery - b.mastery || a.conceptId.localeCompare(b.conceptId))
  return out
}

/** Read `knowledge.json`; a missing file is an empty space, not an error. */
export async function readKnowledge(paths: LibraryPaths): Promise<KnowledgeFile> {
  const file = await readJson<KnowledgeFile | null>(paths.knowledgeFile, null)
  if (file === null) return emptyKnowledge()
  return { ...file, version: 1, concepts: file.concepts ?? {} }
}

/** Replace the knowledge document. */
export async function writeKnowledge(paths: LibraryPaths, file: KnowledgeFile): Promise<KnowledgeFile> {
  const next = { ...file, version: 1 as const, updatedAt: new Date().toISOString() }
  await writeJsonAtomic(paths.knowledgeFile, next)
  return next
}

/**
 * Record one answer, then settle the concept if the horizon allows.
 *
 * `at` is passed in tests; the caller may pass a fake date.
 */
export async function recordEvidence(
  paths: LibraryPaths,
  input: EvidenceInput,
  options: { target?: number; horizonDays?: number; today?: string } = {},
): Promise<ConceptState> {
  let recorded: ConceptState | undefined
  await updateJson<KnowledgeFile>(paths.knowledgeFile, emptyKnowledge(), current => {
    const file: KnowledgeFile = { ...current, version: 1, concepts: current.concepts ?? {} }
    const state = applyEvidence(file.concepts[input.conceptId], input)
    const settled = settleIfDone(state, {
      conceptId: input.conceptId,
      ...(options.target === undefined ? {} : { target: options.target }),
      ...(options.horizonDays === undefined ? {} : { horizonDays: options.horizonDays }),
      ...(options.today === undefined ? {} : { today: options.today }),
    })
    file.concepts[input.conceptId] = settled
    file.updatedAt = new Date().toISOString()
    recorded = settled
    return file
  })
  if (recorded === undefined) throw new Error('knowledge write failed')
  return recorded
}

/**
 * Seed the space from the old concept progress.
 *
 * Runs once when `knowledge.json` is missing: mastery and streaks carry over;
 * every seeded concept is due today, so nothing learned is silently dropped.
 */
export async function seedKnowledgeFromProgress(paths: LibraryPaths): Promise<KnowledgeFile> {
  const progress = await readJson<ProgressFile | null>(paths.progressFile, null)
  const file = emptyKnowledge()
  const today = localDate()
  for (const [conceptId, entry] of Object.entries(progress?.concepts ?? {})) {
    if (!isConceptProgress(entry)) continue
    const rating: Rating = entry.mastery >= 0.8 ? 4 : entry.mastery >= 0.6 ? 3 : entry.mastery >= 0.4 ? 2 : 1
    file.concepts[conceptId] = {
      mastery: clamp01(entry.mastery),
      peak: clamp01(entry.mastery),
      streak: entry.streak,
      attempts: entry.attempts,
      correct: entry.correct,
      ...(entry.lastSeen === undefined ? {} : { lastAt: entry.lastSeen }),
      due: today,
      srs: initialCard(rating),
      evidence: {},
    }
  }
  return writeKnowledge(paths, file)
}

function isConceptProgress(value: unknown): value is ConceptProgress {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Partial<ConceptProgress>
  return typeof entry.mastery === 'number' && typeof entry.attempts === 'number'
}
/**
 * Read the space, seeding it from the old concept progress on first use.
 *
 * Seeding is a one-time migration: after `knowledge.json` exists, the old
 * progress file is no longer read here.
 */
export async function ensureKnowledge(paths: LibraryPaths): Promise<KnowledgeFile> {
  const existing = await readJson<KnowledgeFile | null>(paths.knowledgeFile, null)
  if (existing !== null) {
    return { ...existing, version: 1, concepts: existing.concepts ?? {} }
  }
  return seedKnowledgeFromProgress(paths)
}
