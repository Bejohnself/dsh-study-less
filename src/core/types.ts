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

/** One material manifest (`materials/<mid>/manifest.json`). */export interface MaterialManifest {
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
  /** Hidden from the shelf but still readable and referenced by plans. */
  archived?: boolean
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
  /** Reading progress for generated books, keyed by book id. */
  books?: Record<string, BookProgress>
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

/** One distilled insight (`insights/<iid>.json`). */
export type InsightKind = 'principle' | 'formula' | 'contrast' | 'pitfall' | 'analogy' | 'method'

/** Where an insight came from. Page ranges are validated against that unit. */
export interface InsightSource {
  material: string
  unit: string
  page: number
  quote?: string
}

/** One "read the book down to one page" card. */
export interface InsightRecord {
  version: 1
  id: string
  title: string
  /** The one-sentence essence shown on cards. */
  oneLiner: string
  /** Markdown body; formulas use LaTeX. */
  body: string
  /** Optional display formula. */
  formula?: string
  concepts: string[]
  sources: InsightSource[]
  tags: string[]
  kind: InsightKind
  origin: 'manual' | 'generated'
  pinned: boolean
  generatedBy?: { engine: string; model?: string; promptVersion: string; at: string }
  createdAt: string
  updatedAt: string
}

/** Which backend a capability uses. */
export type EngineKind = 'dsh' | 'openai-compatible'

/** Text generation engine configuration. */
export interface TextEngineSettings {
  kind: EngineKind
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1. */
  baseURL?: string
  /** Stored key; never returned to the browser. Prefer apiKeyEnv. */
  apiKey?: string
  /** Environment variable that holds the key. */
  apiKeyEnv?: string
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

/** Optional media/embedding capability configuration. */
export interface CapabilitySettings {
  enabled: boolean
  baseURL?: string
  apiKey?: string
  apiKeyEnv?: string
  model?: string
  timeoutMs?: number
}

/** Animation backend: a generated self-contained page, or an async video job. */
export interface AnimationSettings extends CapabilitySettings {
  mode: 'svg-html' | 'video'
}

/** How units are generated and reviewed. */
export interface StudyPreferences {
  targetRetention: number
  maxIntervalDays: number
  /** Soft cap for new units per day; 0 means no cap. */
  dailyNewUnits: number
  autoQuiz: boolean
  autoInsight: boolean
  verifyNotes: boolean
  concurrency: number
  requestTimeoutMs: number
}

/** The single settings document (`settings.json`). */
export interface StudySettings {
  version: 1
  text: TextEngineSettings
  image: CapabilitySettings
  animation: AnimationSettings
  embedding: CapabilitySettings
  study: StudyPreferences
  updatedAt: string
}

/** A long-running generation job. */
export type JobKind =
  | 'plan'
  | 'unit'
  | 'quiz'
  | 'insight'
  | 'image'
  | 'animation'
  | 'index'
  | 'book-outline'
  | 'book-chapter'
  | 'book-continuity'
  | 'blocks'

/** Lifecycle of a generation job. */
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/** The target a job operates on. */
export interface JobTarget {
  material?: string
  unit?: string
  planId?: string
  concept?: string
  book?: string
  chapter?: string
}

/** One durable generation job (`jobs/<id>.json`). */
export interface GenerationJob {
  version: 1
  id: string
  kind: JobKind
  status: JobStatus
  target: JobTarget
  /** Progress in [0, 1]. */
  progress: number
  message?: string
  /** Small JSON result; large content stays in the library. */
  result?: unknown
  error?: string
  issues?: string[]
  usage?: { inputTokens?: number; outputTokens?: number }
  createdAt: string
  startedAt?: string
  endedAt?: string
}

/** A plan can remember which job last tried to fill it. */
export interface PlanGeneration {
  status: 'idle' | 'queued' | 'running' | 'done' | 'failed'
  /** Where the orchestration is running: the panel engine or the chat. */
  mode?: 'inline' | 'chat'
  jobId?: string
  error?: string
  updatedAt?: string
}

/** Kinds of steps a learning plan can hold. */
export type PlanStepKind = 'unit' | 'paper-pass' | 'drill' | 'compare'

/** Boundary decision of one step (docs/POSITIONING.md: 必读 / 略读 / 不读). */
export type Coverage = 'read' | 'skim' | 'skip'

/** How a conclusion was reached (归因三态). */
export type Provenance = 'independent' | 'judged' | 'adopted-unverified'

/** The five minimal moves a first attempt may take (最小反事实五式). */
export type AttemptMove = 'assumption' | 'constraint' | 'counterexample' | 'ablation' | 'transfer'

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
  /** Boundary decision; absent means 'read' (plans written before v0.4). */
  coverage?: Coverage
  /** Why this range can be left out; required when coverage is 'skip'. */
  skipReason?: string
}

/** One independent attempt: a small new thing done, not a page read. */
export interface AttemptRecord {
  id: string
  move: AttemptMove
  /** What was tried, in the user's own words. */
  what: string
  /** Where it got stuck; repeats become one StuckPoint. */
  stuck?: string
  provenance: Provenance
  /** Outcome, in the user's own words. */
  result?: string
  at: string
}

/** One sufficiency question of a goal (判定题). */
export interface SufficiencyItem {
  id: string
  q: string
  /** Effective conclusion: true only when the answer passed a check. */
  passed?: boolean
  /** Why this question is asked (the judge's rubric lives here). */
  why?: string
  /** The range this question points at, as `<materialId>:<unitId>`. */
  ref?: string
  /** The answer the user wrote before asking for a judgement. */
  answer?: string
  /** Verdict of the judge; `missing` says what was absent. */
  verdict?: JudgeVerdict
  missing?: string[]
  advice?: string
  judgedAt?: string
  judgedBy?: { engine: string; model?: string }
  /** The user overruled a negative verdict; always shown as 自评. */
  selfPass?: boolean
  selfPassReason?: string
}

/** How the judge scored one answer. */
export type JudgeVerdict = 'pass' | 'partial' | 'fail'

/** What a review card asks again. */
export type CardKind = 'judgement' | 'unit'

/**
 * One review card: the smallest thing the desk asks again.
 *
 * Cards are written only by a failed sufficiency question, so the review queue
 * never grows on its own and every card traces back to a goal the user set.
 */
export interface CardRecord {
  version: 1
  id: string
  kind: CardKind
  /** Goal the card belongs to; closing the goal retires its cards. */
  planId?: string
  /** Answer/context revealed after a recall attempt. */
  prompt: string
  detail?: string
  srs: SrsCard
  history: ReviewEvent[]
  due?: string
  lastReviewedAt?: string
  state: 'new' | 'learned' | 'suspended'
  createdAt: string
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
  /** What this goal must deliver; the boundary is projected from it. */
  deliverable?: string
  /** Local date `YYYY-MM-DD` the deliverable is due. */
  deadline?: string
  /** Who receives the deliverable. */
  audience?: string
  /** Evidence that the goal was reached on the user's own (append-only). */
  attempts?: AttemptRecord[]
  /** Questions whose answers mean "this is enough" (判定题). */
  sufficiency?: SufficiencyItem[]
  /** Closure gate threshold in [0, 1]; default 0.8. */
  threshold?: number
  closedAt?: string
  closureNote?: string
  /** Last inline-orchestration attempt, shown while the plan is a draft. */
  generation?: PlanGeneration
  /** Generated book compiled from this path, when one exists. */
  bookId?: string
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
  /** 1 = easy, 2 = normal, 3 = hard; absent means normal. */
  difficulty?: 1 | 2 | 3
  /** Optional explanation shown after answering. */
  explanation?: string
}

/** Quiz bank file (`units/<uid>/quiz.json`). */
export interface QuizBank {
  version: 1
  unit: string
  items: QuizItem[]
  updatedAt: string
}

/** A source unit and page range a generated chapter is built from. */
export interface BookSourceRef {
  material: string
  unit: string
  pageStart: number
  pageEnd: number
}

/** One chapter of a generated book. */
export interface BookChapterMeta {
  id: string
  order: number
  title: string
  /** Two-sentence summary used as context by the next chapter. */
  summary: string
  objectives: string[]
  prerequisites: string[]
  /** Why this chapter sits here in the narrative. */
  narrativeRole: string
  sourceRefs: BookSourceRef[]
  concepts: string[]
  status: 'outline' | 'draft' | 'done'
  wordCount?: number
  generatedAt?: string
}

/** One part of a generated book. */
export interface BookPart {
  id: string
  title: string
  chapterIds: string[]
}

/** A generated book (`books/<bid>/book.json`). */
export interface BookRecord {
  version: 1
  id: string
  planId?: string
  title: string
  subtitle?: string
  goal: string
  audience?: string
  status: 'outline' | 'drafting' | 'ready' | 'failed'
  sourceMaterials: string[]
  parts: BookPart[]
  chapters: BookChapterMeta[]
  createdAt: string
  updatedAt: string
  generatedBy?: { engine: string; model?: string; promptVersion: string; at: string }
}

/** Reading progress of one book chapter. */
export interface BookChapterProgress {
  readAt?: string
  lastQuizScore?: number
}

/** Reading progress of one book. */
export interface BookProgress {
  chapters: Record<string, BookChapterProgress>
}

/** Which question bank a practice session draws from. */
export type QuizSessionScope =
  | { kind: 'unit'; material: string; unit: string }
  | { kind: 'book'; book: string; chapter?: string }

/** A user's self-grade for a subjective question. */
export type QuizSelfGrade = 'correct' | 'partial' | 'wrong'

/** Why a session stopped. */
export type QuizEndReason = 'completed' | 'finished' | 'replaced' | 'bank-changed'

/**
 * One answered question in a session.
 *
 * The question/answer snapshots keep history readable after the bank is
 * regenerated: item ids are reused (`q1..qN`), so ids alone would point at a
 * different question. Older records lack the snapshots; readers fall back to
 * the bank and then to the id.
 */
export interface QuizSessionEntry {
  itemId: string
  answer?: unknown
  /** null means subjective / not objectively graded. */
  correct: boolean | null
  selfGrade?: QuizSelfGrade
  at: string
  /** Snapshot of what was asked. */
  question?: string
  type?: QuizItemType
  concepts?: string[]
  /** Human-readable answer: choice text for choices, text otherwise. */
  answerText?: string
  /** Reference answer / page, when the item has one. */
  expected?: string
  /** Rubric bullets for subjective items. */
  rubric?: string[]
  explanation?: string
}

/** One adaptive practice session (`quiz-sessions/<id>.json`). */
export interface QuizSession {
  version: 2
  id: string
  scope: QuizSessionScope
  status: 'active' | 'done'
  limit: number
  /** Item ids already answered and advanced past. */
  asked: string[]
  currentId?: string
  history: QuizSessionEntry[]
  startedAt: string
  updatedAt: string
  endedAt?: string
  /** Bank timestamp when the session started; a change invalidates it. */
  bankUpdatedAt?: string
  endedReason?: QuizEndReason
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
  /** Insight ids distilled from this unit. */
  insights?: string[]
  extras?: { anim?: string[]; code?: string[]; media?: string[]; image?: string[] }
}

/** What one guiding card asks the reader to do in their head (POSITIONING §3 阅读面). */
export type PromptKind = 'predict' | 'contrast' | 'recall' | 'transfer'

/**
 * One guiding card.
 *
 * There is no answer field on purpose: the rail asks and never explains. A card
 * that could carry an answer would drift back into being a summary.
 */
export interface PromptCard {
  kind: PromptKind
  /** One line pointing at what was just read; never restates a conclusion. */
  transition: string
  /** One question; at most one question mark. */
  question: string
}

/**
 * One semantic block: a contiguous paragraph range with at most one card.
 *
 * Paragraphs, not pages: a textbook page can hold two unrelated points, and a
 * block must be able to start in the middle of a page. Paragraph indices are
 * local to the unit. `startPage`/`endPage` are derived from the paragraph boxes
 * when the block is written, so they can never disagree with the layout.
 */
export interface BlockInput {
  /** Stable inside the unit, e.g. `b1`. */
  id: string
  /** First paragraph, 0-based, inclusive, unit-local. */
  startPara: number
  /** Last paragraph, 0-based, inclusive, unit-local. */
  endPara: number
  /** Rail heading, at most 10 characters. */
  title: string
  prompt?: PromptCard
}

/** A stored block: the input plus the page span derived from its paragraphs. */
export interface BlockRecord extends BlockInput {
  /** First page touched by the block, 1-based, inclusive. */
  startPage: number
  /** Last page touched by the block, 1-based, inclusive. */
  endPage: number
}

/** One paragraph of a unit's pages, positioned in 0..1 page units. */
export interface ParagraphRecord {
  /** Unit-local index, 0-based, in reading order. */
  index: number
  page: number
  x: number
  y: number
  w: number
  h: number
  text: string
}

/** `materials/<mid>/layout/p####.json` — one page of paragraph geometry. */
export interface PageLayoutFile {
  version: 1
  page: number
  width: number
  height: number
  paragraphs: Array<{ x: number; y: number; w: number; h: number; text: string }>
}

/**
 * `units/<uid>/blocks.json` — the reading surface.
 *
 * Blocks belong to the reading surface, never to the ledger: nothing here is a
 * progress record, and the closure gate reads the same blocks without learning
 * whether they were read.
 */
export interface BlockFile {
  version: 2
  unit: string
  /** Paragraph count the blocks were written against. */
  paragraphs: number
  blocks: BlockRecord[]
  generatedAt: string
}
