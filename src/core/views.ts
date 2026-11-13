/**
 * Views the Host serves to the browser and the shapes both halves share.
 *
 * These are wire shapes, not files: they are computed from manifests, progress
 * and content on demand.
 */
import type {
  AnimationSettings,
  BookChapterMeta,
  BookRecord,
  CapabilitySettings,
  GenerationJob,
  InsightKind,
  InsightRecord,
  JobStatus,
  MaterialType,
  QuizBank,
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
  original: PageSlice[]
  /** True when the page range was clipped by the server cap. */
  truncated: boolean
  /** Quiz bank, when one has been generated. */
  quiz: QuizBank | null
  /** Media extras generated for this unit. */
  extras: ExtraAsset[]
  /** Insights distilled from this unit. */
  insights: InsightCard[]
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
}

/** Everything the Today page needs in one read. */
export interface TodayView {
  date: string
  due: DueItem[]
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
  target?: { materialId: string; unitId: string; title: string; materialTitle: string }
  concepts?: Array<{ id: string; name: string; mastery: number }>
  materials?: Array<{ id: string; title: string }>
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
    generation?: { status: string; mode?: 'inline' | 'chat'; jobId?: string; error?: string }
  }
  steps: PlanStepView[]
  done: number
  total: number
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
}

/** Feedback revealed after one answer. */
export interface QuizFeedbackView {
  itemId: string
  correct: boolean | null
  expected?: string
  rubric?: string[]
  explanation?: string
  /** True when a subjective answer needs a self-grade before advancing. */
  needsSelfGrade?: boolean
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
  }
  item?: QuizItemView
  summary?: QuizSessionSummary
}

/** The result of one answer, including the next item when available. */
export interface QuizAnswerView {
  session: QuizSessionView['session']
  feedback: QuizFeedbackView
  next?: QuizItemView
  summary?: QuizSessionSummary
}

/** Final summary of one practice session. */
export interface QuizSessionSummary {
  asked: number
  correct: number
  objective: number
  score: number
  ratingSuggestion: Rating
  weakConcepts: Array<{ id: string; name: string }>
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
