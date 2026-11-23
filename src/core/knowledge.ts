/**
 * The knowledge space: one record per concept.
 *
 * Practice answers, reviews and time all write here. A section is only a
 * source of questions; it is never a second progress store. Each record keeps
 * its evidence, a mastery estimate derived from it, and its FSRS schedule, so
 * repeating the same question can never inflate progress.
 *
 * Mastery is recomputed from the evidence whenever it changes: every answer is
 * folded in time order and the idle time between two answers decays the estimate
 * first. That is why a month away is not silently undone by the next answer,
 * and why an appeal can amend one verdict without rewriting history.
 */
import type { LibraryPaths } from './paths.ts'
import { MAX_STABILITY, initialCard, intervalDays, reviewCard } from './srs.ts'
import { readJson, updateJson, writeJsonAtomic } from './store.ts'
import { addDays, daysBetween, localDate } from './time.ts'
import type { ConceptProgress, MasteryLevel, ProgressFile, Rating, SrsCard } from './types.ts'

/** Default mastery a concept must reach (level 2, 会用). */
export const DEFAULT_TARGET = 0.75

/** Four depth levels a goal can require for one knowledge point. */
export const MASTERY_LEVELS: ReadonlyArray<{ level: MasteryLevel; label: string; threshold: number }> = [
  { level: 1, label: '了解', threshold: 0.6 },
  { level: 2, label: '会用', threshold: 0.75 },
  { level: 3, label: '能讲', threshold: 0.85 },
  { level: 4, label: '创新', threshold: 0.95 },
]
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
/** Mastery a concept starts from before any evidence. */
export const START_MASTERY = 0.5
/** Gain per answer by difficulty (easy / normal / hard). */
export const LEARNING_RATE: Readonly<Record<1 | 2 | 3, number>> = { 1: 0.14, 2: 0.18, 3: 0.22 }
/** A wrong answer costs a tenth of the current estimate, not a quarter. */
export const FAIL_FACTOR = 0.9
/** Below target a concept is due again within this many days. */
export const MAX_OPEN_INTERVAL_DAYS = 7
/** An appeal that wins counts, but never at full weight. */
export const APPEAL_WEIGHT = 0.7

/** What one answer proved. */
export type EvidenceVerdict = 'pass' | 'partial' | 'fail'

/** One deduplicated answer, keyed by question fingerprint. */
export interface ConceptEvidence {
  verdict: EvidenceVerdict
  difficulty: 1 | 2 | 3
  at: string
  /** 1 by default; a verdict won on appeal counts less. */
  weight?: number
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
  /** Weight of this answer on the gain side; an appeal-won pass uses 0.7. */
  weight?: number
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, Number(value.toFixed(4))))
}

/**
 * Decay one estimate from `from` to `to`, toward a floor under the peak.
 *
 * Pure: it never writes, so a read is always a function of the ledger and the
 * clock, never of how often something was opened.
 */
function decayTo(mastery: number, peak: number, from: string, to: string): number {
  const days = daysBetween(from, to)
  if (!Number.isFinite(days) || days <= 0) return mastery
  const floor = peak * DECAY_FLOOR_RATIO
  if (mastery <= floor) return mastery
  return clamp01(floor + (mastery - floor) * Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS))
}

/** Mastery after idle decay. Pure: it never writes. */
export function decayedMastery(state: ConceptState, today: string = localDate()): number {
  if (state.lastAt === undefined) return state.mastery
  return decayTo(state.mastery, state.peak, localDate(new Date(state.lastAt)), today)
}

/** One knowledge point measured against the threshold its goal asks for. */
export interface SectionPointState {
  id: string
  name: string
  mastery: number
  threshold: number
  atTarget: boolean
}

/**
 * Resolve a section's knowledge points against the one ledger.
 *
 * Practice, the plan page and today all read the same numbers: a point is at
 * target when its decayed mastery reaches the goal's threshold. A point with
 * no state yet starts from the fresh 0.5 the ledger would give it. Order
 * follows `targets`, so the caller decides what is shown first.
 */
export function sectionPointStates(
  targets: readonly string[],
  thresholds: Readonly<Record<string, number>>,
  knowledge: KnowledgeFile,
  names: ReadonlyMap<string, string>,
  today: string,
): SectionPointState[] {
  return targets.map(id => {
    const state = knowledge.concepts[id]
    const mastery = state === undefined ? START_MASTERY : decayedMastery(state, today)
    const threshold = thresholds[id] ?? DEFAULT_TARGET
    return { id, name: names.get(id) ?? id, mastery, threshold, atTarget: mastery >= threshold }
  })
}

/** The state of a concept that never had evidence. */
function freshState(): ConceptState {
  return {
    mastery: START_MASTERY,
    peak: START_MASTERY,
    streak: 0,
    attempts: 0,
    correct: 0,
    srs: initialCard(3),
    evidence: {},
  }
}

/**
 * Recompute a concept from its evidence.
 *
 * Entries are folded oldest first; the idle time between two entries decays the
 * estimate before the next one applies. Ties break on the fingerprint, so the
 * same ledger always yields the same number. `target` only shapes the next due
 * date: a concept short of its goal comes back inside a week.
 */
function fold(
  evidence: Record<string, ConceptEvidence>,
  options: { conceptId: string; target?: number },
): ConceptState {
  const entries = Object.entries(evidence).sort(
    ([leftKey, left], [rightKey, right]) =>
      Date.parse(left.at) - Date.parse(right.at) || leftKey.localeCompare(rightKey),
  )
  let mastery = START_MASTERY
  let peak = START_MASTERY
  let streak = 0
  let attempts = 0
  let correct = 0
  let lastAt: string | undefined
  let lastDay: string | undefined
  let srs = initialCard(3)
  for (const [, entry] of entries) {
    const day = localDate(new Date(entry.at))
    if (lastDay !== undefined) mastery = decayTo(mastery, peak, lastDay, day)
    if (entry.verdict === 'fail') {
      mastery = clamp01(mastery * FAIL_FACTOR)
      streak += 1
    } else {
      const credit = entry.verdict === 'pass' ? 1 : 0.5
      const weight = entry.weight ?? 1
      mastery = clamp01(mastery + LEARNING_RATE[entry.difficulty] * credit * weight * (1 - mastery))
      streak = 0
      if (entry.verdict === 'pass') correct += 1
    }
    peak = Math.max(peak, mastery)
    attempts += 1
    const rating = ratingFor(entry.verdict, entry.difficulty)
    srs = attempts === 1 ? initialCard(rating) : reviewCard(srs, rating)
    lastAt = entry.at
    lastDay = day
  }
  const interval = intervalDays(srs.S, { maxIntervalDays: MAX_SCHEDULE_DAYS, fuzzKey: options.conceptId })
  const open = mastery < (options.target ?? DEFAULT_TARGET) ? Math.min(interval, MAX_OPEN_INTERVAL_DAYS) : interval
  return {
    mastery,
    peak,
    streak,
    attempts,
    correct,
    ...(lastAt === undefined ? {} : { lastAt }),
    ...(lastDay === undefined ? {} : { due: addDays(lastDay, open) }),
    srs,
    evidence,
  }
}

/**
 * Apply one answer to one concept.
 *
 * The update is deterministic: the model only supplies the verdict, the
 * difficulty and (on appeal) a weight. Answering the same fingerprint again
 * replaces that entry, so a repeated question cannot add a second gain.
 */
export function applyEvidence(
  existing: ConceptState | undefined,
  input: EvidenceInput,
  options: { target?: number } = {},
): ConceptState {
  const state = existing ?? freshState()
  const at = input.at ?? new Date().toISOString()
  const entry: ConceptEvidence = {
    verdict: input.verdict,
    difficulty: input.difficulty ?? 2,
    at,
    ...(input.weight === undefined || input.weight === 1 ? {} : { weight: input.weight }),
  }
  const evidence = { ...state.evidence, [input.fingerprint]: entry }
  return fold(evidence, {
    conceptId: input.conceptId,
    ...(options.target === undefined ? {} : { target: options.target }),
  })
}

/** Threshold that a level requires. */
export function thresholdForLevel(level: MasteryLevel | undefined): number {
  return MASTERY_LEVELS.find(entry => entry.level === (level ?? 2))?.threshold ?? DEFAULT_TARGET
}

/** Chinese label of a level. */
export function levelLabel(level: MasteryLevel | undefined): string {
  return MASTERY_LEVELS.find(entry => entry.level === (level ?? 2))?.label ?? '会用'
}

/**
 * Interval after which the reader would forget the concept.
 *
 * Settling and closing ask this question, not "is the next review date far
 * enough". The calendar cap (`MAX_SCHEDULE_DAYS`) exists so a settled concept
 * does not drift for years; using it as the gate made any deadline more than
 * ~120 days away impossible to close.
 */
export function forgettingIntervalDays(state: ConceptState, conceptId: string): number {
  return intervalDays(state.srs.S, { maxIntervalDays: MAX_STABILITY, fuzzKey: conceptId })
}

/**
 * Settle a concept when it would survive past the horizon.
 *
 * Only reached concepts settle, and only when forgetting could not change the
 * outcome before the horizon. A new answer reopens it automatically.
 */
export function settleIfDone(
  state: ConceptState,
  options: { conceptId: string; target?: number; horizonDays?: number; today?: string },
): ConceptState {
  if (state.settledAt !== undefined) return state
  const today = options.today ?? localDate()
  if (decayedMastery(state, today) < (options.target ?? DEFAULT_TARGET)) return state
  const horizon = Math.max(0, options.horizonDays ?? DEFAULT_HORIZON_DAYS)
  const interval = forgettingIntervalDays(state, options.conceptId)
  if (!Number.isFinite(interval)) return state
  if (interval <= Math.max(SETTLE_MIN_DAYS, horizon * 1.5)) return state
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
      target: DEFAULT_TARGET,
    })
  }
  out.sort((a, b) => b.overdueDays - a.overdueDays || a.mastery - b.mastery || a.conceptId.localeCompare(b.conceptId))
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
 * `target` is the level the current goal asks for, `horizonDays` the time left
 * until its deadline. Both are read from the goal by the caller; the ledger
 * itself stores ability only.
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
    const state = applyEvidence(
      file.concepts[input.conceptId],
      input,
      options.target === undefined ? {} : { target: options.target },
    )
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
  // The today panel reads the space from several places at once; seed once and
  // let every caller wait on the same write.
  const running = seeding.get(paths.knowledgeFile)
  if (running !== undefined) return running
  const task = seedKnowledgeFromProgress(paths).finally(() => {
    seeding.delete(paths.knowledgeFile)
  })
  seeding.set(paths.knowledgeFile, task)
  return task
}

/** In-flight first-use seeding, keyed by file so concurrent readers share it. */
const seeding = new Map<string, Promise<KnowledgeFile>>()