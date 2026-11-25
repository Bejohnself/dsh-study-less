/**
 * The study service: the Host's single public face over the library.
 *
 * Both the HTTP routes and the agent tools drive this object, so a checkbox in
 * the browser and a tool call from the assistant change exactly the same state.
 */
import { readFile } from 'node:fs/promises'
import type { LibraryPaths } from '../core/paths.ts'
import { readProgress } from '../core/progress.ts'
import { normalizeSettings } from '../core/settings.ts'
import { readJson } from '../core/store.ts'
import { addDays, localDate } from '../core/time.ts'
import type { AttemptMove, BlockFile, BlockInput, ParagraphRecord, Coverage, MaterialManifest, PlanGeneration, PlanStepKind, Provenance, QuizBank, QuizItem, Rating, StructureNode, UnitMetaFile } from '../core/types.ts'
import type { ConceptCard, ConceptDetailView, PlanDetailView, PlanSummary, QuizSubmitView, TodayView } from '../core/views.ts'
import { ORIGINAL_PAGE_CAP, type CompleteOptions, type CompleteResult, type DueItem, type MaterialCard, type MaterialStateView, type PageSlice, type UnitView } from '../core/views.ts'
import { type ImportRequest, type ImportResult } from './import.ts'

import { StudyError } from './service/error.ts'
import { library, materialState, pdfSource, pdfAvailable, unit, unitMaterial, complete, uncomplete, importOp, importUpload, importFromUrl, structureSet, layout, mergeBlock, manifest, archiveMaterial, deleteMaterial } from './service/library.ts'
import { due, todayView, review, concepts, conceptView } from './service/learning.ts'
import { createGoal, promptPlanInChat, planList, planView, createPlan, updatePlan, closePlan, setPlanGeneration, deletePlan } from './service/plans.ts'
import { writeUnit, verifyUnit, writeConcepts, hasNotes, quiz, writeQuiz, writeBlocks, submitQuiz, attachInsights } from './service/authoring.ts'

export { StudyError }

/** Dependencies that make time testable. */
export interface StudyDeps {
  /** Local date override for tests. */
  today?: () => string
  /** Deliver the goal instruction into the conversation the user is watching. */
  promptSession?: (sessionId: string, text: string) => Promise<void>
}

/** One unit's raw material, used by the authoring tools. */
export interface UnitMaterial {
  material: MaterialManifest
  node: StructureNode
  /** Concatenated original text, capped. */
  text: string
  truncated: boolean
  concepts: string[]
  existingNotes: string | null
}

/** Result of writing one unit. */
export interface WriteUnitResult {
  material: string
  unit: string
  status: 'drafted'
  words: number
  concepts: string[]
  /** Non-blocking style advice, e.g. formulas typed as Unicode. */
  warnings: string[]
}

/** Actor-facing study service. */

export class StudyService {
  readonly paths: LibraryPaths
  /** Internal collaborators; visible so the operation modules can read the test clock. */
  readonly deps: StudyDeps
  /** Manual test clock: shifts reads of "today", never the stored dates. */
  private clockOffsetDays = 0

  constructor(paths: LibraryPaths, deps: StudyDeps = {}) {
    this.paths = paths
    this.deps = deps
  }

  today(): string {
    if (this.deps.today !== undefined) return this.deps.today()
    return this.clockOffsetDays === 0 ? localDate() : addDays(localDate(), this.clockOffsetDays)
  }

  /** Current test-clock offset, for the today panel and the HTTP check. */
  clockState(): { offsetDays: number; today: string } {
    return { offsetDays: this.clockOffsetDays, today: this.today() }
  }

  /** Move "today" one day forward. In memory only: a restart resets it. */
  advanceDay(): { offsetDays: number; today: string } {
    this.clockOffsetDays += 1
    return this.clockState()
  }

  resetClock(): { offsetDays: number; today: string } {
    this.clockOffsetDays = 0
    return this.clockState()
  }

  async preferences(): Promise<{ targetRetention: number; maxIntervalDays: number }> {
    const settings = normalizeSettings(await readJson<unknown>(this.paths.settingsFile, null))
    return { targetRetention: settings.study.targetRetention, maxIntervalDays: settings.study.maxIntervalDays }
  }

  async readNotes(materialId: string, unitId: string): Promise<string | null> {
    try {
      return await readFile(this.paths.notesFile(materialId, unitId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async readPages(
    materialId: string,
    pageStart: number,
    pageEnd: number,
  ): Promise<{ pages: PageSlice[]; truncated: boolean }> {
    const pages: PageSlice[] = []
    const cap = Math.min(pageEnd, pageStart + ORIGINAL_PAGE_CAP - 1)
    for (let page = pageStart; page <= cap; page += 1) {
      try {
        const text = await readFile(this.paths.pageFile(materialId, page), 'utf8')
        pages.push({ page, text: text.replace(/^<!-- page \d+ -->\n/, '') })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
    }
    return { pages, truncated: cap < pageEnd }
  }

  async assertRevision(revision?: number): Promise<void> {
    if (revision === undefined) return
    const progress = await readProgress(this.paths)
    if (progress.revision !== revision) {
      throw new StudyError('conflict', '进度已被其他操作更新，请刷新后重试', { revision: progress.revision })
    }
  }

  async library(includeArchived = false): Promise<MaterialCard[]> {
    return library(this, includeArchived)
  }

  async materialState(materialId: string): Promise<MaterialStateView> {
    return materialState(this, materialId)
  }

  async pdfSource(materialId: string): Promise<{ file: string; title: string; sha256?: string; pages: number }> {
    return pdfSource(this, materialId)
  }

  async pdfAvailable(materialId: string): Promise<boolean> {
    return pdfAvailable(this, materialId)
  }

  async unit(materialId: string, unitId: string): Promise<UnitView> {
    return unit(this, materialId, unitId)
  }

  async unitMaterial(materialId: string, unitId: string, maxChars = 12_000): Promise<UnitMaterial> {
    return unitMaterial(this, materialId, unitId, maxChars)
  }

  async complete(materialId: string, unitId: string, options: CompleteOptions = {}): Promise<CompleteResult> {
    return complete(this, materialId, unitId, options)
  }

  async uncomplete(materialId: string, unitId: string): Promise<{ revision: number }> {
    return uncomplete(this, materialId, unitId)
  }

  async due(today = this.today()): Promise<DueItem[]> {
    return due(this, today)
  }

  async concepts(): Promise<ConceptCard[]> {
    return concepts(this)
  }

  async conceptView(conceptId: string): Promise<ConceptDetailView> {
    return conceptView(this, conceptId)
  }

  async todayView(): Promise<TodayView> {
    return todayView(this)
  }

  async review(
    materialId: string,
    unitId: string,
    options: { rating: Rating; quizScore?: number; revision?: number },
  ): Promise<CompleteResult> {
    return review(this, materialId, unitId, options)
  }

  async createGoal(input: {
    goal: string
    brief?: string
    materials: readonly string[]
    hoursPerWeek?: number
    depth?: 'deep' | 'overview'
    sessionId?: string
  }): Promise<{ planId: string; prompted: boolean; error?: string; prompt: string }> {
    return createGoal(this, input)
  }

  async promptPlanInChat(
    planId: string,
    sessionId?: string,
  ): Promise<{ prompted: boolean; prompt: string; error?: string }> {
    return promptPlanInChat(this, planId, sessionId)
  }

  async importUpload(stream: AsyncIterable<Uint8Array | Buffer>, fileName: string): Promise<ImportResult> {
    return importUpload(this, stream, fileName)
  }

  async importFromUrl(url: string): Promise<ImportResult> {
    return importFromUrl(this, url)
  }

  async planList(): Promise<PlanSummary[]> {
    return planList(this)
  }

  async planView(planId: string): Promise<PlanDetailView> {
    return planView(this, planId)
  }

  async createPlan(input: {
    goal: string
    steps: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string; coverage?: Coverage; skipReason?: string }>
    hoursPerWeek?: number
    id?: string
    deliverable?: string
    deadline?: string
    audience?: string
  }): Promise<PlanDetailView> {
    return createPlan(this, input)
  }

  async updatePlan(
    planId: string,
    input: {
      setStatus?: 'active' | 'paused' | 'done'
      setGoal?: string
      replaceSteps?: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string; level?: 1 | 2 | 3 | 4 }>
      /** Depth required of one step's section. */
      setLevel?: { n: number; level: 1 | 2 | 3 | 4 }
      /** Goal facts: deliverable, deadline and audience. null clears a field. */
      setMeta?: { deliverable?: string | null; deadline?: string | null; audience?: string | null; threshold?: number }
      /** Crop one step: read, skim or skip (skip needs a reason). */
      setCoverage?: { n: number; coverage: Coverage; reason?: string }
      addAttempt?: { move: AttemptMove; what: string; stuck?: string; provenance: Provenance; result?: string }
      removeAttempt?: string
      replaceSufficiency?: Array<{ q: string; passed?: boolean }>
      toggleSufficiency?: { id: string; passed: boolean; reason?: string; answer?: string }
    },
  ): Promise<PlanDetailView> {
    return updatePlan(this, planId, input)
  }

  async closePlan(planId: string, note?: string): Promise<PlanDetailView> {
    return closePlan(this, planId, note)
  }

  async setPlanGeneration(planId: string, generation: PlanGeneration): Promise<void> {
    return setPlanGeneration(this, planId, generation)
  }

  async import(request: ImportRequest): Promise<ImportResult> {
    return importOp(this, request)
  }

  async structureSet(materialId: string, nodes: readonly StructureNode[]): Promise<MaterialManifest> {
    return structureSet(this, materialId, nodes)
  }

  async writeUnit(
    materialId: string,
    unitId: string,
    input: {
      notes: string
      pageRefs: readonly number[]
      concepts: ReadonlyArray<{ id: string; name?: string; definition?: string }>
    },
  ): Promise<WriteUnitResult> {
    return writeUnit(this, materialId, unitId, input)
  }

  async verifyUnit(
    materialId: string,
    unitId: string,
    input: { verdict: 'pass' | 'fail'; issues?: readonly string[] },
  ): Promise<{ status: UnitMetaFile['verification'] }> {
    return verifyUnit(this, materialId, unitId, input)
  }

  async attachInsights(materialId: string, unitId: string, insightIds: readonly string[]): Promise<void> {
    return attachInsights(this, materialId, unitId, insightIds)
  }

  async hasNotes(materialId: string, unitId: string): Promise<boolean> {
    return hasNotes(this, materialId, unitId)
  }

  async quiz(materialId: string, unitId: string): Promise<QuizBank | null> {
    return quiz(this, materialId, unitId)
  }

  async writeConcepts(
    materialId: string,
    unitId: string,
    concepts: ReadonlyArray<{ id: string; name: string; definition?: string; page?: number }>,
  ): Promise<string[]> {
    return writeConcepts(this, materialId, unitId, concepts)
  }

  async writeQuiz(materialId: string, unitId: string, items: readonly QuizItem[]): Promise<QuizBank> {
    return writeQuiz(this, materialId, unitId, items)
  }

  async writeBlocks(materialId: string, unitId: string, blocks: readonly BlockInput[]): Promise<BlockFile> {
    return writeBlocks(this, materialId, unitId, blocks)
  }

  async layout(materialId: string, from: number, to: number): Promise<ParagraphRecord[]> {
    return layout(this, materialId, from, to)
  }

  async mergeBlock(materialId: string, unitId: string, blockId: string): Promise<BlockFile> {
    return mergeBlock(this, materialId, unitId, blockId)
  }

  async submitQuiz(
    materialId: string,
    unitId: string,
    answers: ReadonlyArray<{ itemId: string; answer: unknown }>,
  ): Promise<QuizSubmitView> {
    return submitQuiz(this, materialId, unitId, answers)
  }

  async archiveMaterial(materialId: string, archived: boolean): Promise<MaterialManifest> {
    return archiveMaterial(this, materialId, archived)
  }

  async deletePlan(planId: string): Promise<{ deleted: boolean; sessions: number; books: number }> {
    return deletePlan(this, planId)
  }

  async deleteMaterial(materialId: string): Promise<{ deleted: boolean }> {
    return deleteMaterial(this, materialId)
  }

  async manifest(materialId: string): Promise<MaterialManifest> {
    return manifest(this, materialId)
  }
}
