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
import { initialCard, reviewCard } from './srs.ts'
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
/**
 * Decay half-life at review count 0.
 *
 * Fitted with `DECAY_HALF_LIFE_GROWTH` so the intervals a concept gets after
 * each successful review track the FSRS "good" sequence closely enough
 * (roughly 1, 2, 3.5, 5.5, 9, 14, 23, 36 days) while the first review still
 * lands on the day after learning.
 */
export const DECAY_HALF_LIFE_DAYS = 7
/** Every successful spaced review multiplies the half-life by this. */
export const DECAY_HALF_LIFE_GROWTH = 1.6
/** Half-life ceiling: beyond this the decay stops slowing down. */
export const DECAY_HALF_LIFE_MAX = 365
/** A passing review lifts the estimate at least this far above the threshold. */
export const REVIEW_GAIN_FLOOR = 0.05
/** Decay never drops below this share of the concept's peak mastery. */
export const DECAY_FLOOR_RATIO = 0.5
/** Mastery a concept starts from before any evidence. */
export const START_MASTERY = 0.5
/** Gain per answer by difficulty (easy / normal / hard). */
export const LEARNING_RATE: Readonly<Record<1 | 2 | 3, number>> = { 1: 0.14, 2: 0.18, 3: 0.22 }
/** A wrong answer costs a tenth of the current estimate, not a quarter. */
export const FAIL_FACTOR = 0.9
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
  /**
   * The answer repaired a concept that had fallen below its threshold.
   *
   * Only these answers get the minimum gain and move the spacing count; the
   * initial learning passes keep the documented 4 / 7 / 12 trajectory.
   */
  review?: boolean
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
  /** Legacy FSRS date; no longer written and no longer read by any queue. */
  due?: string
  /** Legacy FSRS card, kept so old files still parse; not used for scheduling. */
  srs: SrsCard
  /** Legacy settlement mark; the gate now derives this from the decay date. */
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
  /** Set when the answer repaired a concept that had fallen below its threshold. */
  review?: boolean
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

/** Half-life for a concept that has been successfully reviewed this many times. */
export function decayHalfLife(rounds: number): number {
  return Math.min(DECAY_HALF_LIFE_MAX, DECAY_HALF_LIFE_DAYS * Math.pow(DECAY_HALF_LIFE_GROWTH, Math.max(0, rounds)))
}

/**
 * Decay one estimate from `from` to `to`, toward a floor under the peak.
 *
 * Pure: it never writes, so a read is always a function of the ledger and the
 * clock, never of how often something was opened. `rounds` is the spacing the
 * review answers earned; more spaced success slows the same half-life curve.
 */
function decayTo(mastery: number, peak: number, from: string, to: string, rounds: number): number {
  const days = daysBetween(from, to)
  if (!Number.isFinite(days) || days <= 0) return mastery
  const floor = peak * DECAY_FLOOR_RATIO
  if (mastery <= floor) return mastery
  return clamp01(floor + (mastery - floor) * Math.pow(0.5, days / decayHalfLife(rounds)))
}

/**
 * How much spacing the ledger has earned.
 *
 * One count per local day with a passing review, not per answer: drilling the
 * same point ten times in one evening must not buy ten intervals. Each fail
 * halves it, the same way the reader asked for, so a bad day costs spacing
 * without wiping it out.
 */
export function roundsOf(evidence: Readonly<Record<string, ConceptEvidence>>): number {
  const entries = Object.entries(evidence).sort(
    ([leftKey, left], [rightKey, right]) => Date.parse(left.at) - Date.parse(right.at) || leftKey.localeCompare(rightKey),
  )
  let rounds = 0
  let lastReviewDay: string | undefined
  for (const [, entry] of entries) {
    if (entry.verdict === 'fail') {
      rounds = Math.floor(rounds / 2)
      continue
    }
    if (entry.review !== true || entry.verdict !== 'pass') continue
    const day = localDate(new Date(entry.at))
    if (day === lastReviewDay) continue
    rounds += 1
    lastReviewDay = day
  }
  return rounds
}

/** Mastery after idle decay. Pure: it never writes. */
export function decayedMastery(state: ConceptState, today: string = localDate()): number {
  if (state.lastAt === undefined) return state.mastery
  return decayTo(
    state.mastery,
    state.peak,
    localDate(new Date(state.lastAt)),
    today,
    roundsOf(state.evidence),
  )
}

/**
 * The day this concept is expected to fall below `threshold`.
 *
 * Undefined when the floor is already at or above the threshold: such a point
 * can never drop, so it needs no review date.
 */
export function reviewOn(state: ConceptState, threshold: number): string | undefined {
  if (state.lastAt === undefined) return undefined
  const lastDay = localDate(new Date(state.lastAt))
  const floor = state.peak * DECAY_FLOOR_RATIO
  if (threshold <= floor) return undefined
  if (state.mastery <= threshold) return lastDay
  const days =
    decayHalfLife(roundsOf(state.evidence)) * Math.log2((state.mastery - floor) / (threshold - floor))
  return addDays(lastDay, Math.max(1, Math.ceil(days)))
}

/**
 * Whether one concept can be trusted to stay at or above its threshold until
 * the deadline. A deadline that already passed asks the weaker question: is it
 * at target today? The goal gate and the Today panel both read this.
 */
export function retentionSafe(
  state: ConceptState | undefined,
  threshold: number,
  deadline: string,
  today: string = localDate(),
): boolean {
  if (state === undefined) return false
  const now = decayedMastery(state, today)
  if (now < threshold) return false
  // On the deadline day the goal is due: being at target now is enough. Before
  // it, the point must also be expected to stay above the line past it.
  if (today >= deadline) return true
  const on = reviewOn(state, threshold)
  return on === undefined || on > deadline
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
 * same ledger always yields the same number. Review answers earn spacing: a
 * passing one raises the floor gain and the half-life for the next segment.
 */
function fold(evidence: Record<string, ConceptEvidence>): ConceptState {
  const entries = Object.entries(evidence).sort(
    ([leftKey, left], [rightKey, right]) =>
      Date.parse(left.at) - Date.parse(right.at) || leftKey.localeCompare(rightKey),
  )
  let mastery = START_MASTERY
  let peak = START_MASTERY
  let rounds = 0
  let lastReviewDay: string | undefined
  let streak = 0
  let attempts = 0
  let correct = 0
  let lastAt: string | undefined
  let lastDay: string | undefined
  let srs = initialCard(3)
  for (const [, entry] of entries) {
    const day = localDate(new Date(entry.at))
    if (lastDay !== undefined) mastery = decayTo(mastery, peak, lastDay, day, rounds)
    if (entry.verdict === 'fail') {
      mastery = clamp01(mastery * FAIL_FACTOR)
      rounds = Math.floor(rounds / 2)
      streak += 1
    } else {
      const credit = entry.verdict === 'pass' ? 1 : 0.5
      const weight = entry.weight ?? 1
      let gain = LEARNING_RATE[entry.difficulty] * credit * weight * (1 - mastery)
      // A review pass must leave headroom above the threshold; without it a
      // level-4 point barely above 0.95 would fall back within days no matter
      // how much spacing it earned.
      if (entry.review === true && entry.verdict === 'pass') {
        gain = Math.max(gain, REVIEW_GAIN_FLOOR)
        if (day !== lastReviewDay) {
          rounds += 1
          lastReviewDay = day
        }
      }
      mastery = clamp01(mastery + gain)
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
  return {
    mastery,
    peak,
    streak,
    attempts,
    correct,
    ...(lastAt === undefined ? {} : { lastAt }),
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
): ConceptState {
  const state = existing ?? freshState()
  const at = input.at ?? new Date().toISOString()
  const entry: ConceptEvidence = {
    verdict: input.verdict,
    difficulty: input.difficulty ?? 2,
    at,
    ...(input.weight === undefined || input.weight === 1 ? {} : { weight: input.weight }),
    ...(input.review === true ? { review: true as const } : {}),
  }
  const evidence = { ...state.evidence, [input.fingerprint]: entry }
  return fold(evidence)
}

/** Threshold that a level requires. */
export function thresholdForLevel(level: MasteryLevel | undefined): number {
  return MASTERY_LEVELS.find(entry => entry.level === (level ?? 2))?.threshold ?? DEFAULT_TARGET
}

/** Chinese label of a level. */
export function levelLabel(level: MasteryLevel | undefined): string {
  return MASTERY_LEVELS.find(entry => entry.level === (level ?? 2))?.label ?? '会用'
}

/** One due concept for the review queue. */
export interface DueConcept {
  conceptId: string
  due: string
  overdueDays: number
  mastery: number
  target: number
}

/**
 * Concepts that have fallen below their goal threshold, most overdue first.
 *
 * The queue is the same predicate a section uses to decide it is no longer
 * learned, so a point cannot be "at target" and still ask for review. A point
 * already below its threshold at the last answer is due from that day.
 */
export function dueConcepts(
  file: KnowledgeFile,
  thresholdOf: (conceptId: string) => number,
  today: string = localDate(),
): DueConcept[] {
  const out: DueConcept[] = []
  for (const [conceptId, state] of Object.entries(file.concepts)) {
    const target = thresholdOf(conceptId)
    // Only a point that had reached the line can "fall below" it. Points still
    // in their first learning run are the section's job (接着读), not review.
    if (state.peak < target) continue
    const mastery = decayedMastery(state, today)
    if (mastery >= target) continue
    const due = reviewOn(state, target) ?? today
    out.push({
      conceptId,
      due,
      overdueDays: Math.max(0, daysBetween(due, today)),
      mastery,
      target,
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
 * Record one answer and rebuild the concept from its evidence.
 *
 * The ledger stores ability only: whether the answer repaired a point that had
 * fallen below its threshold (`review`) and whether it was won on appeal
 * (`weight`). Goal depth and deadlines are read by the gate, never written here.
 *
 * `at` is passed in tests; the caller may pass a fake date.
 */
export async function recordEvidence(paths: LibraryPaths, input: EvidenceInput): Promise<ConceptState> {
  let recorded: ConceptState | undefined
  await updateJson<KnowledgeFile>(paths.knowledgeFile, emptyKnowledge(), current => {
    const file: KnowledgeFile = { ...current, version: 1, concepts: current.concepts ?? {} }
    const state = applyEvidence(file.concepts[input.conceptId], input)
    file.concepts[input.conceptId] = state
    file.updatedAt = new Date().toISOString()
    recorded = state
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