/**
 * Views the Host serves to the browser and the shapes both halves share.
 *
 * These are wire shapes, not files: they are computed from manifests, progress
 * and content on demand.
 */
import type { BoundarySummary } from './planGate.ts'
import type {
  AnimationSettings,
  AttemptMove,
  AttemptRecord,
  BlockRecord,
  BookChapterMeta,
  BookRecord,
  CapabilitySettings,
  GenerationJob,
  InsightKind,
  InsightRecord,
  JobStatus,
  MaterialType,
  Coverage,
  QuizBank,
  QuizEndReason,
  QuizItemType,
  QuizJudgeRecord,
  QuizAppealRecord,
  QuizSelfGrade,
  Provenance,
  Rating,
  StudyPreferences,
  TextEngineSettings,
  UnitKind,
  UnitState,
  UnitStatus,
} from './types.ts'

/** One card on the library shelf. */
export interface MaterialCard {
  id: string
  type: MaterialType
  title: string
  subtitle?: string
  authors: string[]
  year?: number
  venue?: string
  pages: number
  importedAt: string
  /** Total units in the material. */
  units: number
  /** Units whose notes passed verification. */
  verifiedUnits: number
  /** Units the user has completed at least once. */
  learnedUnits: number
  /** Units due for review today. */
  dueCount: number
  /** Overall state derived from learnedUnits. */
  status: 'new' | 'learning' | 'done'
  tags: string[]
  /** Hidden from the shelf but still readable by id. */
  archived?: boolean
}

/** One row of the table of contents. */
export interface TocRow {
  uid: string
  title: string
  kind: UnitKind
  pass?: number
  pageStart: number
  pageEnd: number
  status: UnitStatus
  state: UnitState
  due?: string
  concepts: string[]
}

/** One page of original text. */
export interface PageSlice {
  page: number
  text: string
}

/** Material detail payload. */
export interface MaterialStateView {
  material: MaterialCard
  toc: TocRow[]
  /** Keys of units due today, most urgent first. */
  due: string[]
  /** The next unit in book order that has not been learned. */
  next?: string
}

/** One extra asset attached to a unit. */
export interface ExtraAsset {
  name: string
  kind: 'image' | 'animation' | 'video' | 'code' | 'other'
  url: string
}

/** Reader payload for one unit. */
export interface UnitView {
  material: MaterialCard
  unit: TocRow
  notes: string | null
  /** Whether the original PDF is still on disk (the reader shows it first). */
  pdfAvailable: boolean
  original: PageSlice[]
  /** True when the page range was clipped by the server cap. */
  truncated: boolean
  /** Quiz bank, when one has been generated. */
  quiz: QuizBank | null
  /** Media extras generated for this unit. */
  extras: ExtraAsset[]
  /** Insights distilled from this unit. */
  insights: InsightCard[]
  /**
   * Semantic blocks with their guiding cards, when generated.
   *
   * Null means "not generated yet": the rail shows one quiet line and a button
   * instead of guessing. Blocks are reading surface, never progress.
   */
  blocks: BlockRecord[] | null
}

/** One item of the "ready to review" list. */
export interface DueItem {
  key: string
  materialId: string
  unitId: string
  title: string
  materialTitle: string
  due: string
  overdueDays: number
}

/** Result of completing a unit. */
export interface CompleteResult {
  unit: TocRow
  due: string
  revision: number
  note: string
}

/** Options accepted when completing a unit. */
export interface CompleteOptions {
  rating?: Rating
  /** Client's last seen progress revision, for optimistic concurrency. */
  revision?: number
  today?: string
}

/** One concept on the concept list. */
export interface ConceptCard {
  id: string
  name: string
  /** Mastery in [0, 1]; 0.5 when never practised. */
  mastery: number
  occurrences: number
  materials: string[]
  weak: boolean
}

/** One concept occurrence resolved to human labels. */
export interface ConceptOccurrenceView {
  materialId: string
  materialTitle: string
  unitId: string
  unitTitle: string
  page: number
  role: 'definition' | 'method' | 'evidence' | 'critique' | 'use'
}

/** Concept detail payload. */
export interface ConceptDetailView {
  concept: {
    id: string
    name: string
    aliases: string[]
    definition: string
    prereqOf: string[]
    related: string[]
  }
  mastery?: { mastery: number; attempts: number; correct: number; streak: number; lastSeen?: string }
  occurrences: ConceptOccurrenceView[]
}

/** The next thing the desk suggests. */
export interface NextStepView {
  /** Where the suggestion came from. */
  source: 'plan' | 'material'
  /** The goal this step belongs to, so the reader can show its context. */
  planId?: string
  materialId: string
  unitId: string
  title: string
  materialTitle: string
  why: string
}

/** An active plan rolled into a summary. */
export interface PlanBrief {
  id: string
  goal: string
  done: number
  total: number
  next?: { materialId: string; unitId: string; title: string }
  /** What this goal must deliver; the Today page shows it above the next step. */
  deliverable?: string
  /** Whether the closure gate is already satisfied. */
  gateReady: boolean
}

/** One review card as the panel shows it. */

/** Everything the Today page needs in one read. */
/** The knowledge-space slice of the today panel. */
export interface KnowledgeToday {
  /** Concepts with any recorded state. */
  total: number
  settled: number
  due: Array<{
    conceptId: string
    name: string
    due: string
    overdueDays: number
    mastery: number
    target: number
    /** First place this concept appears, for a focused review. */
    materialId?: string
    unitId?: string
  }>
  below: Array<{
    conceptId: string
    name: string
    mastery: number
    target: number
    settled: boolean
  }>
}

/** The active goal as the today panel shows it. */
export interface GoalToday {
  id: string
  goal: string
  deliverable?: string
  deadline?: string
  /** Concepts at their level threshold / concepts in scope. */
  passed: number
  total: number
  /** Required sections that still carry no knowledge points. */
  missingSections: number
  readyToClose: boolean
}

export interface TodayView {
  date: string
  /** Knowledge-point state: what is due and what is below target. */
  knowledge?: KnowledgeToday
  /** The goal driving today; absent means free practice only. */
  goal?: GoalToday
  weak: ConceptCard[]
  next: NextStepView | null
  plans: PlanBrief[]
  /** Units completed today, for the streak line. */
  learnedToday: number
  /** One pinned insight to keep the distilled layer in the daily loop. */
  pinnedInsight?: InsightCard
}

/** One plan step resolved for the UI. */
export interface PlanStepView {
  n: number
  kind: 'unit' | 'paper-pass' | 'drill' | 'compare'
  why: string
  done: boolean
  /** Boundary decision; old plans read as 'read'. */
  coverage: Coverage
  skipReason?: string
  target?: { materialId: string; unitId: string; title: string; materialTitle: string; pageStart: number; pageEnd: number }
  concepts?: Array<{ id: string; name: string; mastery: number }>
  materials?: Array<{ id: string; title: string }>
  /** Knowledge progress of the section: concepts at threshold and average mastery. */
  progress?: { passed: number; total: number; mastery: number }
  /** The same step the Today page would suggest next. */
  current?: boolean
  /** Depth this goal asks of this section; absent means 会用. */
  level?: 1 | 2 | 3 | 4
}

/** One attempt as the panel shows it. */
export interface AttemptView extends AttemptRecord {
  move: AttemptMove
  provenance: Provenance
}

/** The goal's own facts, editable in the panel. */
export interface PlanMetaView {
  deliverable?: string
  deadline?: string
  audience?: string
  threshold: number
  closedAt?: string
  closureNote?: string
}

/**
 * One section of a goal, with the depth it asks for and its progress.
 *
 * The section is the unit of requirement: concepts come from the unit itself
 * (`units/<uid>/meta`), the goal only decides how deep this section must go.
 */
export interface PlanSectionView {
  /** `<material>:<unit>` */
  target: string
  title: string
  /** 1 了解 / 2 会用 / 3 能讲 / 4 创新. */
  level: 1 | 2 | 3 | 4
  /** Required mastery threshold for the level. */
  threshold: number
  concepts: string[]
  /** Current decayed mastery; the weakest concept of the section wins. */
  mastery: number
  /** Weakest concept's historical peak, when the section has concepts. */
  peak?: number
  /** Every concept of the section is at its threshold. */
  atTarget: boolean
  conceptStates: Array<{ id: string; name: string; mastery: number; threshold: number; atTarget: boolean }>
}

/** One plan in full. */
export interface PlanDetailView {
  plan: {
    id: string
    goal: string
    status: 'draft' | 'active' | 'paused' | 'done'
    hoursPerWeek?: number
    brief?: string
    bookId?: string
    meta: PlanMetaView
    generation?: { status: string; mode?: 'inline' | 'chat'; jobId?: string; error?: string }
  }
  steps: PlanStepView[]
  done: number
  total: number
  /** Page arithmetic of the crop list. */
  boundary: BoundarySummary
  /** Independent attempts, newest first. */
  attempts: AttemptView[]
  /** The sections this goal requires, with their depth and knowledge progress. */
  sections: PlanSectionView[]
  /** Knowledge-space closure: concepts at level threshold + review settled. */
  goalProgress: { passed: number; total: number; missingSections: number; ready: boolean; reasons: string[] }
}

/** One plan in a list. */
export interface PlanSummary {
  id: string
  goal: string
  status: 'draft' | 'active' | 'paused' | 'done'
  done: number
  total: number
  next?: string
}

/** One insight on a list. */
export interface InsightCard {
  id: string
  title: string
  oneLiner: string
  kind: InsightKind
  concepts: string[]
  tags: string[]
  pinned: boolean
  origin: 'manual' | 'generated'
  sourceCount: number
  updatedAt: string
}

/** One insight with its sources and concepts resolved for the UI. */
export interface InsightDetailView {
  insight: InsightRecord
  sources: Array<{
    materialId: string
    materialTitle: string
    unitId: string
    unitTitle: string
    page: number
    quote?: string
  }>
  concepts: Array<{ id: string; name: string }>
}

/** One engine as the settings form sees it: a stored key is never returned. */
export interface TextEngineView {
  kind: TextEngineSettings['kind']
  baseURL?: string
  apiKeySet: boolean
  apiKeyEnv?: string
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

/** One optional capability as the settings form sees it. */
export interface CapabilityView {
  enabled: boolean
  baseURL?: string
  apiKeySet: boolean
  apiKeyEnv?: string
  model?: string
  timeoutMs?: number
}

/** One generated-book card. */
export interface BookSummary {
  id: string
  planId?: string
  title: string
  subtitle?: string
  status: 'outline' | 'drafting' | 'ready' | 'failed'
  chapters: number
  done: number
}

/** One chapter card on the book cover. */
export interface BookChapterCard {
  id: string
  order: number
  title: string
  summary: string
  objectives: string[]
  sourceCount: number
  status: 'outline' | 'draft' | 'done'
  wordCount?: number
  read: boolean
}

/** The book cover payload. */
export interface BookView {
  book: BookRecord
  chapters: BookChapterCard[]
}

/** One chapter with its rendered content and neighbours. */
export interface BookChapterView {
  book: { id: string; title: string }
  chapter: BookChapterMeta
  content: string
  prev?: { id: string; title: string }
  next?: { id: string; title: string }
  sources: Array<{
    materialId: string
    materialTitle: string
    unitId: string
    unitTitle: string
    pageStart: number
    pageEnd: number
  }>
  quiz: QuizBank | null
}

/** Settings payload; secrets are reduced to `apiKeySet`. */
/** One model call's token/cost summary for inline display. */
export interface UsageCallView {
  inputTokens: number
  cacheReadTokens?: number
  outputTokens: number
  cost?: number
  currency: string
  priceSource: 'api' | 'user' | 'mixed' | 'none'
}

/** One aggregate bucket for the settings usage panel. */
export interface UsageTotalsView {
  calls: number
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  cost: number
  pricedCalls: number
  unpricedCalls: number
}

/** The usage ledger as the settings panel reads it. */
export interface UsageSummaryView {
  currency: string
  totals: UsageTotalsView
  today: UsageTotalsView & { date: string }
  /** One bucket per day, oldest first; absent days simply have no calls. */
  days: Array<UsageTotalsView & { date: string }>
}

export interface SettingsView {
  text: TextEngineView
  image: CapabilityView
  animation: CapabilityView & { mode: AnimationSettings['mode'] }
  embedding: CapabilityView
  study: StudyPreferences
  /** True when the text engine can run without the chat fallback. */
  textReady: boolean
  updatedAt: string
}

/** One generation job as the browser polls it. */
export type JobView = GenerationJob

/** Result of submitting a quiz. */
export interface QuizSubmitView {
  score: number
  ratingSuggestion: Rating
  attempts: Array<{ itemId: string; correct: boolean | null; expected?: string }>
}

/** A question safe to send before the answer is revealed. */
export interface QuizItemView {
  id: string
  type: 'recall' | 'choice' | 'cloze' | 'apply' | 'evidence'
  question: string
  choices?: string[]
  concepts: string[]
  page?: number
  difficulty?: 1 | 2 | 3
  masteryTitle?: string
}

/** The answer a test shortcut fills in; only served for the current item. */
export interface QuizReferenceView {
  answer: string
  /** Zero-based choice index, for choice questions only. */
  index?: number
  /** exact: stored answer; rubric: the AI's scoring points stand in; none: nothing stored. */
  source: 'exact' | 'rubric' | 'none'
}

/** Feedback revealed after one answer. */
export interface QuizFeedbackView {
  itemId: string
  correct: boolean | null
  /** Present when the reader graded a subjective answer themselves. */
  selfGrade?: QuizSelfGrade
  expected?: string
  rubric?: string[]
  explanation?: string
  /** True when a subjective answer needs a self-grade before advancing. */
  needsSelfGrade?: boolean
  /** Why the automatic judge was not used; the reader self-grades instead. */
  judgeUnavailable?: string
  /** Model verdict on a written answer. */
  judged?: QuizJudgeRecord
  /** Re-judging rounds; the last verdict is the current one. */
  appeals?: QuizAppealRecord[]
  /** Cost of the model call that produced this feedback, when there was one. */
  usage?: UsageCallView
}

/** One answered item, rendered from the session's own snapshot. */
export interface QuizHistoryEntryView {
  itemId: string
  question: string
  type: QuizItemType
  answerText: string
  correct: boolean | null
  selfGrade?: QuizSelfGrade
  judged?: QuizJudgeRecord
  appeals?: QuizAppealRecord[]
  expected?: string
  rubric?: string[]
  explanation?: string
  at: string
}

/** Why a unit run writes no progress. */
/** Why a section cannot be practiced: practice only ever runs inside a goal. */
export type QuizBlockReason = 'no-goal' | 'outside-goal' | 'no-concepts'

/** One knowledge point of a section, measured against its goal threshold. */
export interface QuizPointView {
  id: string
  name: string
  /** Decayed mastery today, 0–1. */
  mastery: number
  /** Goal threshold for this point, 0–1. */
  threshold: number
  atTarget: boolean
  /** Latest verdict of this session's answers on the point, when any. */
  answered?: 'pass' | 'partial' | 'fail'
}

/** Progress and current item of one session. */
export interface QuizSessionView {
  session: {
    id: string
    status: 'active' | 'done'
    asked: number
    limit: number
    correct: number
    objective: number
    /** Points of this run's target set that reached their threshold. */
    atTarget?: { passed: number; total: number }
    /** A focused review of one due concept, not a section pass. */
    review?: true
    /** Legacy: a run recorded before practice became goal-only. Never written now. */
    free?: boolean
    startedAt: string
    updatedAt: string
    endedReason?: QuizEndReason
  }
  /** One row per knowledge point this run measures; empty for book chapters. */
  points: QuizPointView[]
  item?: QuizItemView
  history: QuizHistoryEntryView[]
  summary?: QuizSessionSummary
}

/** The result of one answer, including the next item when available. */
export interface QuizAnswerView {
  session: QuizSessionView['session']
  /** Knowledge points after this answer wrote its evidence. */
  points: QuizPointView[]
  feedback: QuizFeedbackView
  history: QuizHistoryEntryView[]
  next?: QuizItemView
  summary?: QuizSessionSummary
}

/** One past or active session in a unit's practice index. */
export interface QuizSessionRecordView {
  id: string
  status: 'active' | 'done'
  asked: number
  limit: number
  correct: number
  objective: number
  score: number
  startedAt: string
  updatedAt: string
  endedAt?: string
  endedReason?: QuizEndReason
}

/** What the practice page needs before it starts: bank state and sessions. */
export interface QuizSessionIndexView {
  bank: {
    items: number
    defaultLimit: number
    notes: boolean
    updatedAt?: string
  }
  /** Every knowledge point of this section, whether open or already at target. */
  points: QuizPointView[]
  /** How many of those points are still short of their threshold. */
  open: number
  /** Every point is at its threshold: a new run has nothing left to prove. */
  ready: boolean
  /** The goal covers this section but it carries no knowledge points yet. */
  needsConcepts: boolean
  /** A text engine is available, so concepts and questions can be written. */
  canGenerate: boolean
  /** The active goal driving this section, when one covers it. */
  goal?: { id: string }
  /** Set when practice is not available: the page says why instead of offering a run. */
  blocked?: QuizBlockReason
  active: QuizSessionView | null
  recent: QuizSessionRecordView[]
}

/** Final summary of one practice session. */
export interface QuizSessionSummary {
  asked: number
  correct: number
  /** Answers that count as evidence: objective or model-judged. */
  objective: number
  score: number
  /**
   * passed: every target point reached its threshold. failed: the run ended
   * with points short. incomplete: stopped early, replaced or free practice.
   */
  verdict: 'passed' | 'failed' | 'incomplete'
  /** Ledger state of this run's target set when it closed. */
  points: QuizPointView[]
  atTarget?: { passed: number; total: number }
  /** Points still short of threshold, weakest gap first. */
  gap: QuizPointView[]
  /** A focused review of one due concept. */
  review?: true
  /** Legacy: a run recorded before practice became goal-only. */
  free?: boolean
}

/** Settings update body. */
export interface SettingsUpdate {
  text?: Partial<TextEngineSettings>
  image?: Partial<CapabilitySettings>
  animation?: Partial<AnimationSettings>
  embedding?: Partial<CapabilitySettings>
  study?: Partial<StudyPreferences>
}

/** Generation job statuses in display order. */
export const JOB_STATUS_ORDER: JobStatus[] = ['queued', 'running', 'done', 'failed', 'cancelled']

/** Server cap for one original-page read. */
export const ORIGINAL_PAGE_CAP = 30

/** Maximum source file size accepted at import. */
export const MAX_SOURCE_BYTES = 512 * 1024 * 1024
