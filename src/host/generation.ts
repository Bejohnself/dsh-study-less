/**
 * Inline generation orchestration.
 *
 * This is the replacement for "send a prompt into the chat and hope": the same
 * service validates against the library and writes through the same gates the
 * agent tools use. Long work is queued, and a unit job may fold in quiz and
 * insight generation so one model pass over the section pays for all three.
 */
import type { LibraryPaths } from '../core/paths.ts'
import { textReady } from '../core/settings.ts'
import type { QuizBank, QuizItem, StudySettings } from '../core/types.ts'
import type { BookChapterView, BookSummary, PlanDetailView } from '../core/views.ts'
import { JobQueue, type JobContext } from './jobs.ts'
import type { InsightService } from './insights.ts'
import { parseJsonObject, repairPrompt } from './generate/prompts.ts'
import { textProviderFrom, type EngineDeps } from './providers/index.ts'
import type { JudgePromptInput, MasteryQuizPromptInput, QuestionPromptInput, QuizJudgePromptInput, SectionJudgePromptInput } from './generate/prompts.ts'
import type { SettingsService } from './settings.ts'
import type { BookService } from './books.ts'
import { StudyError, type StudyService } from './service.ts'
import { ask, generateMasteryQuiz, generateQuestions, judgeAnswer, judgeQuizAnswer, judgeSectionPassed, testEngine } from './generation/chat.ts'
import { generatePlan, retryPlan, runPlan } from './generation/plan.ts'
import { generateUnit, runUnit } from './generation/unit.ts'
import { generateQuiz, moreQuizItems, runQuiz, runQuizInternal, type MoreQuizItemsInput } from './generation/quiz.ts'
import { extractConcepts, type ExtractedConcept } from './generation/concepts.ts'
import { generateBlocks, runBlocks } from './generation/blocks.ts'
import { generateInsights, runUnitInsights, runUnitInsightsInternal, runConceptInsights } from './generation/insight.ts'
import { generateBookOutline, generateBookChapter, generateBookContinuity, runBookOutline, runBookChapter, runBookContinuity } from './generation/book.ts'
import { issuesOf } from './generation/normalize.ts'

/**
 * The small window's only job: answer the one spot being read, then leave.
 *
 * The answer is never stored (POSITIONING §6 B). Length is capped in the prompt
 * because a long answer is how a question window turns into another lecture.
 */

/** What the generation layer depends on. */
export interface GenerationDeps extends EngineDeps {
  service: StudyService
  insights: InsightService
  settings: SettingsService
  jobs: JobQueue
  books: BookService
}

/** Plan generation input. */
export interface GeneratePlanInput {
  goal: string
  brief?: string
  materials: string[]
  hoursPerWeek?: number
  depth?: 'deep' | 'overview'
}

/** Unit generation input. */
export interface GenerateUnitInput {
  material: string
  unit: string
  planId?: string
  /** Maximum source characters sent to the model. */
  maxChars?: number
}

/** Quiz generation input. */
export interface GenerateQuizInput {
  material: string
  unit: string
}

/** Insight generation input: one unit or one cross-material concept. */
export interface GenerateBlocksInput {
  material: string
  unit: string
}

export interface GenerateInsightInput {
  material?: string
  unit?: string
  concept?: string
}

type Prompt = { system: string; user: string }

/** A judgement is a short call; do not let it hang the panel. */

/** One question the generator wrote. */
export interface GeneratedQuestion {
  q: string
  why?: string
  ref?: string
}

/** What the judge decided about one written answer. */
export interface JudgeResult {
  verdict: 'pass' | 'partial' | 'fail'
  missing: string[]
  advice?: string
  confidence: number
  engine: string
  model?: string
}


/** The inline generation engine. */

export class GenerationService {
  readonly paths: LibraryPaths
  readonly deps: GenerationDeps

  constructor(paths: LibraryPaths, deps: GenerationDeps) {
    this.paths = paths
    this.deps = deps
  }

  async textReady(): Promise<boolean> {
    return this.ready(await this.deps.settings.current())
  }

  ready(settings: StudySettings): boolean {
    if (!textReady(settings)) return false
    // The DSH route only exists when the Host actually exposes `llm`; a test
    // seam that injects a provider is equally usable.
    return settings.text.kind !== 'dsh' || this.deps.llm !== undefined || this.deps.textProvider !== undefined
  }

  async requireSettings(): Promise<StudySettings> {
    const settings = await this.deps.settings.current()
    if (!this.ready(settings)) throw new StudyError('unsupported', '还没有可用的文本引擎')
    return settings
  }

  async completeJson<T>(context: JobContext, prompt: Prompt, accept: (parsed: unknown) => Promise<T>): Promise<T> {
    const settings = await this.requireSettings()
    const provider = textProviderFrom(settings, this.deps)
    context.report(0.12, '正在生成…')
    const first = await provider.complete({
      system: prompt.system,
      user: prompt.user,
      signal: context.signal,
      onProgress: chars => context.report(0.12 + Math.min(0.55, (chars / 8000) * 0.55), `生成中… ${chars} 字`),
    })
    context.report(0.7, '校验输出…')
    let issues: string[]
    try {
      return await accept(parseJsonObject(first.text))
    } catch (error) {
      issues = issuesOf(error)
    }
    context.report(0.78, '正在修复校验问题…')
    const repair = repairPrompt(first.text, issues)
    const second = await provider.complete({
      system: repair.system,
      user: repair.user,
      signal: context.signal,
      onProgress: chars => context.report(0.78 + Math.min(0.15, (chars / 8000) * 0.15), `修复中… ${chars} 字`),
    })
    try {
      return await accept(parseJsonObject(second.text))
    } catch (error) {
      const issues = issuesOf(error)
      console.error('[dsh-study-less] generation validation failed:', issues, '\nraw:', second.text.slice(0, 4000))
      throw new StudyError('invalid', '模型输出未通过校验', { issues })
    }
  }

  async generatePlan(input: GeneratePlanInput): Promise<{ planId: string; jobId: string }> {
    return generatePlan(this, input)
  }

  async retryPlan(planId: string): Promise<{ planId: string; jobId: string }> {
    return retryPlan(this, planId)
  }

  async generateUnit(input: GenerateUnitInput): Promise<{ jobId: string }> {
    return generateUnit(this, input)
  }

  async ask(input: { material: string; unit: string; page?: number; question: string }): Promise<{ answer: string }> {
    return ask(this, input)
  }

  async generateQuiz(input: GenerateQuizInput): Promise<{ jobId: string }> {
    return generateQuiz(this, input)
  }

  async generateBlocks(input: GenerateBlocksInput): Promise<{ jobId: string }> {
    return generateBlocks(this, input)
  }

  async generateInsights(input: GenerateInsightInput): Promise<{ jobId: string }> {
    return generateInsights(this, input)
  }

  async generateBookOutline(planId: string): Promise<{ jobId: string }> {
    return generateBookOutline(this, planId)
  }

  async generateBookChapter(bookId: string, chapterId: string): Promise<{ jobId: string }> {
    return generateBookChapter(this, bookId, chapterId)
  }

  async generateBookContinuity(bookId: string): Promise<{ jobId: string }> {
    return generateBookContinuity(this, bookId)
  }

  async runBookOutline(planId: string, context: JobContext): Promise<BookSummary> {
    return runBookOutline(this, planId, context)
  }

  async runBookChapter(bookId: string, chapterId: string, context: JobContext): Promise<BookChapterView> {
    return runBookChapter(this, bookId, chapterId, context)
  }

  async runBookContinuity(bookId: string, context: JobContext): Promise<{ verdict: string; issues: unknown[] }> {
    return runBookContinuity(this, bookId, context)
  }

  async generateQuestions(input: QuestionPromptInput, signal?: AbortSignal): Promise<{ questions: GeneratedQuestion[]; engine: string; model?: string }> {
    return generateQuestions(this, input, signal)
  }

  async judgeAnswer(input: JudgePromptInput, signal?: AbortSignal): Promise<JudgeResult> {
    return judgeAnswer(this, input, signal)
  }

  async judgeQuizAnswer(input: QuizJudgePromptInput, signal?: AbortSignal): Promise<JudgeResult> {
    return judgeQuizAnswer(this, input, signal)
  }

  async masteryQuiz(input: MasteryQuizPromptInput, signal?: AbortSignal): Promise<{ items: QuizItem[]; engine: string; model?: string }> {
    return generateMasteryQuiz(this, input, signal)
  }

  /** Confirm that every knowledge point of one section has passed. */
  async sectionPassed(input: SectionJudgePromptInput, signal?: AbortSignal): Promise<JudgeResult> {
    return judgeSectionPassed(this, input, signal)
  }

  /** Write extra questions for the points still pending in a session. */
  async moreQuizItems(input: MoreQuizItemsInput): Promise<QuizItem[]> {
    return moreQuizItems(this, input)
  }

  /** Extract the knowledge points of one unit, so practice has a target list. */
  async extractConcepts(input: { material: string; unit: string }): Promise<ExtractedConcept[]> {
    return extractConcepts(this, input)
  }

  async testEngine(kind: 'text' | 'image' | 'animation' | 'embedding'): Promise<Record<string, unknown>> {
    return testEngine(this, kind)
  }

  async runPlan(planId: string, input: GeneratePlanInput, context: JobContext): Promise<PlanDetailView> {
    return runPlan(this, planId, input, context)
  }

  async runUnit(input: GenerateUnitInput, context: JobContext): Promise<Record<string, unknown>> {
    return runUnit(this, input, context)
  }

  async runQuiz(material: string, unit: string, context: JobContext): Promise<{ items: number }> {
    return runQuiz(this, material, unit, context)
  }

  async runBlocks(input: GenerateBlocksInput, context: JobContext): Promise<Record<string, unknown>> {
    return runBlocks(this, input, context)
  }

  async runQuizInternal(materialId: string, unitId: string, context: JobContext, base: number): Promise<QuizBank> {
    return runQuizInternal(this, materialId, unitId, context, base)
  }

  async runUnitInsights(material: string, unit: string, context: JobContext): Promise<{ ids: string[] }> {
    return runUnitInsights(this, material, unit, context)
  }

  async runUnitInsightsInternal(materialId: string, unitId: string, context: JobContext, base: number): Promise<string[]> {
    return runUnitInsightsInternal(this, materialId, unitId, context, base)
  }

  async runConceptInsights(conceptId: string, context: JobContext): Promise<{ ids: string[] }> {
    return runConceptInsights(this, conceptId, context)
  }
}
