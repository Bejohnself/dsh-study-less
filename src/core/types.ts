/**
 * Domain types shared by the Host half, the browser half and future tests.
 *
 * One library holds many materials (books, papers, articles). A material is cut
 * into units: a book section, a paper reading pass, or an article section. Units
 * and concepts both carry progress; plans stitch units from several materials
 * into one goal.
 */

/** What kind of source a material is. */
export type MaterialType = 'book' | 'paper' | 'article'

/** One learnable slice of a material. */
export type UnitKind = 'section' | 'pass'

/** Pipeline status of a unit's study material. */
export type UnitStatus = 'new' | 'materials' | 'drafted' | 'verified'

/** Learning state of a unit. */
export type UnitState = 'new' | 'learned' | 'reviewing' | 'suspended'

/** Review rating, low to high. */
export type Rating = 1 | 2 | 3 | 4

/** Where a review event came from. */
export type ReviewSource = 'first-learn' | 'review' | 'manual'

/** Source file facts recorded at import time. */
export interface MaterialSource {
  /** Path relative to the material directory. */
  path: string
  /** sha256 of the imported bytes. */
  sha256: string
  /** Page count of the source document. */
  pages: number
  /** ISO timestamp of the import. */
  importedAt: string
  /** Original path or URL the user pointed at, if any. */
  origin?: string
}

/** One structural node of a material (section, chapter or reading pass). */
export interface StructureNode {
  /** Stable unit id, unique inside the material. */
  uid: string
  kind: UnitKind
  title: string
  /** Heading depth; 1 is a chapter. */
  level?: number
  /** Reading pass number for paper passes. */
  pass?: number
  /** First page, 1-based, inclusive. */
  pageStart: number
  /** Last page, 1-based, inclusive. */
  pageEnd: number
}

/** Per-unit pipeline metadata stored in the material manifest. */
export interface UnitMeta {
  uid: string
  status: UnitStatus
  /** Global concept ids this unit teaches. */
  concepts: string[]
  /** Approximate size of the generated notes. */
  words?: number
  /** Last generation errors, if any. */
  issues?: string[]
}

/** A paper claim with its evidence pointer. */
export interface Claim {
  id: string
  claim: string
  /** Structural section title or uid the claim lives in. */
  section: string
  evidence: {
    kind: 'figure' | 'table' | 'equation' | 'section'
    page: number
    label?: string
  }
  strength?: '核心' | '支撑'
}

/** One material manifest (`materials/<mid>/manifest.json`). */
export interface MaterialManifest {
  version: 1
  id: string
  type: MaterialType
  title: string
  subtitle?: string
  authors: string[]
  year?: number
  venue?: string
  tags: string[]
  identifiers: { arxiv?: string; doi?: string; url?: string }
  source: MaterialSource
  /** Ordered structure; the recommended path follows this order per material. */
  structure: StructureNode[]
  /** Per-unit pipeline status, keyed by uid. */
  units: UnitMeta[]
  /** Paper claims (papers only). */
  claims?: Claim[]
  createdAt: string
  updatedAt: string
}

/** FSRS-lite card state. */
export interface SrsCard {
  /** Stability in days. */
  S: number
  /** Difficulty in [1, 10]. */
  D: number
  reps: number
  lapses: number
  lastRating?: Rating
}

/** One review event kept in the unit history. */
export interface ReviewEvent {
  at: string
  rating: Rating
  quizScore?: number
  source: ReviewSource
}

/** Learning progress of one unit. */
export interface UnitProgress {
  state: UnitState
  firstLearnedAt?: string
  lastReviewedAt?: string
  /** Local date `YYYY-MM-DD` this unit is next due. */
  due?: string
  srs: SrsCard
  history: ReviewEvent[]
}

/** Concept mastery tracked across the whole library. */
export interface ConceptProgress {
  /** Mastery in [0, 1]. */
  mastery: number
  attempts: number
  correct: number
  /** Consecutive wrong answers. */
  streak: number
  lastSeen?: string
}

/** The single progress document (`progress.json`). */
export interface ProgressFile {
  version: 1
  /** Bumped on every write; clients send it back as If-Match. */
  revision: number
  /** Keyed by `<materialId>:<unitId>`. */
  units: Record<string, UnitProgress>
  /** Keyed by concept id. */
  concepts: Record<string, ConceptProgress>
  /** Local date of the last review push, for idempotency. */
  lastPushedDate?: string
  updatedAt: string
}

/** Where a concept shows up in the library. */
export interface ConceptOccurrence {
  material: string
  unit: string
  page: number
  role: 'definition' | 'method' | 'evidence' | 'critique' | 'use'
}

/** A global concept (`concepts/<cid>.json`). */
export interface ConceptRecord {
  id: string
  name: string
  aliases: string[]
  definition: string
  occurrences: ConceptOccurrence[]
  /** Concepts that depend on this one. */
  prereqOf: string[]
  related: string[]
  updatedAt: string
}

/** Kinds of steps a learning plan can hold. */
export type PlanStepKind = 'unit' | 'paper-pass' | 'drill' | 'compare'

/** One step of a learning plan. */
export interface PlanStep {
  n: number
  kind: PlanStepKind
  /** `<materialId>:<unitId>` for unit and paper-pass steps. */
  target?: string
  /** Concept ids for drill steps. */
  concepts?: string[]
  /** Material ids for compare steps. */
  materials?: string[]
  why: string
  done: boolean
}

/** A goal-driven learning plan (`plans/<pid>.json`). */
export interface PlanRecord {
  id: string
  goal: string
  status: 'draft' | 'active' | 'paused' | 'done'
  /** Free-form description of what the user wants out of this goal. */
  brief?: string
  /** Materials the user picked for this goal. */
  materials?: string[]
  budget?: { hoursPerWeek?: number }
  steps: PlanStep[]
  createdAt: string
  updatedAt: string
}

/** One item of a unit's quiz bank. */
export type QuizItemType = 'recall' | 'choice' | 'cloze' | 'apply' | 'evidence'

/** One quiz item. */
export interface QuizItem {
  id: string
  type: QuizItemType
  question: string
  /** For choice items. */
  choices?: string[]
  /** Correct choice index for choice items. */
  answerIndex?: number
  /** Answer for cloze items. */
  answer?: string
  /** Reference answer / rubric bullets for recall and apply items. */
  rubric?: string[]
  /** Global concept ids this item trains. */
  concepts: string[]
  /** Where the item came from. */
  origin: 'book-exercise' | 'paper-claim' | 'generated' | 'weakness'
  /** Page anchor inside the material. */
  page?: number
}

/** Quiz bank file (`units/<uid>/quiz.json`). */
export interface QuizBank {
  version: 1
  unit: string
  items: QuizItem[]
  updatedAt: string
}

/** Generated notes metadata (`units/<uid>/meta.json`). */
export interface UnitMetaFile {
  version: 1
  material: string
  unit: string
  title: string
  /** Global concept ids introduced by this unit. */
  concepts: string[]
  /** Page references used by the notes, each must be inside the unit range. */
  pageRefs: number[]
  /** Prompt/model provenance. */
  generatedBy?: { model?: string; promptVersion?: string; at: string }
  /** Verification result once a second agent checked the notes. */
  verification?: { verdict: 'pass' | 'fail'; issues: string[]; at: string }
  extras?: { anim?: string[]; code?: string[]; media?: string[] }
}
