/**
 * Inline generation orchestration.
 *
 * This is the replacement for "send a prompt into the chat and hope": the same
 * service validates against the library and writes through the same gates the
 * agent tools use. Long work is queued, and a unit job may fold in quiz and
 * insight generation so one model pass over the section pays for all three.
 */
import { validateInsight } from '../core/insights.ts'
import { listManifests } from '../core/library.ts'
import type { LibraryPaths } from '../core/paths.ts'
import { readPlan } from '../core/plans.ts'
import { textReady } from '../core/settings.ts'
import type {
  InsightKind,
  InsightSource,
  MaterialManifest,
  PlanStepKind,
  QuizBank,
  QuizItem,
  QuizItemType,
  StudySettings,
} from '../core/types.ts'
import type { PlanDetailView } from '../core/views.ts'
import { JobQueue, type JobContext } from './jobs.ts'
import type { InsightService } from './insights.ts'
import {
  conceptInsightPrompt,
  insightPrompt,
  parseJsonObject,
  planPrompt,
  PROMPT_VERSION,
  quizPrompt,
  repairPrompt,
  unitPrompt,
} from './generate/prompts.ts'
import { textProviderFrom, type EngineDeps } from './providers/index.ts'
import type { SettingsService } from './settings.ts'
import { StudyError, type StudyService, type WriteUnitResult } from './service.ts'

/** What the generation layer depends on. */
export interface GenerationDeps extends EngineDeps {
  service: StudyService
  insights: InsightService
  settings: SettingsService
  jobs: JobQueue
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
export interface GenerateInsightInput {
  material?: string
  unit?: string
  concept?: string
}

type Prompt = { system: string; user: string }

function issuesOf(error: unknown): string[] {
  if (error instanceof StudyError && typeof error.details === 'object' && error.details !== null) {
    const issues = (error.details as { issues?: unknown }).issues
    if (Array.isArray(issues)) return issues.map(String)
  }
  return [error instanceof Error ? error.message : String(error)]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new StudyError('invalid', `${label} 必须是非空字符串`)
  return value.trim()
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new StudyError('invalid', `${label} 必须是数组`)
  return value
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const PLAN_KINDS: PlanStepKind[] = ['unit', 'paper-pass', 'drill', 'compare']
const QUIZ_TYPES: QuizItemType[] = ['recall', 'choice', 'cloze', 'apply', 'evidence']
const INSIGHT_KINDS: InsightKind[] = ['principle', 'formula', 'contrast', 'pitfall', 'analogy', 'method']

/** The inline generation engine. */
export class GenerationService {
  private readonly paths: LibraryPaths
  private readonly deps: GenerationDeps

  constructor(paths: LibraryPaths, deps: GenerationDeps) {
    this.paths = paths
    this.deps = deps
  }

  /** Whether the text engine is usable without the chat fallback. */
  async textReady(): Promise<boolean> {
    return this.ready(await this.deps.settings.current())
  }

  private ready(settings: StudySettings): boolean {
    if (!textReady(settings)) return false
    // The DSH route only exists when the Host actually exposes `llm`; a test
    // seam that injects a provider is equally usable.
    return settings.text.kind !== 'dsh' || this.deps.llm !== undefined || this.deps.textProvider !== undefined
  }

  /** Queue a plan-orchestration job. The draft plan is written immediately. */
  async generatePlan(input: GeneratePlanInput): Promise<{ planId: string; jobId: string }> {
    if (!(await this.textReady())) {
      throw new StudyError('unsupported', '还没有配置文本引擎；可以先交给当前对话生成，或到设置里配置模型')
    }
    const goal = input.goal.trim()
    if (goal.length === 0) throw new StudyError('invalid', '目标不能为空')
    if (input.materials.length === 0) throw new StudyError('invalid', '至少选择一份资料')
    const goalResult = await this.deps.service.createGoal({
      goal,
      ...(input.brief === undefined ? {} : { brief: input.brief }),
      materials: input.materials,
      ...(input.hoursPerWeek === undefined ? {} : { hoursPerWeek: input.hoursPerWeek }),
      depth: input.depth ?? 'deep',
    })
    const job = await this.deps.jobs.create('plan', { planId: goalResult.planId }, context =>
      this.runPlan(goalResult.planId, input, context),
    )
    await this.deps.service.setPlanGeneration(goalResult.planId, { status: 'queued', jobId: job.id })
    return { planId: goalResult.planId, jobId: job.id }
  }

  /** Queue one unit's notes (and optional quiz/insights). */
  async generateUnit(input: GenerateUnitInput): Promise<{ jobId: string }> {
    if (!(await this.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
    await this.deps.service.manifest(input.material)
    const job = await this.deps.jobs.create('unit', { material: input.material, unit: input.unit }, context =>
      this.runUnit(input, context),
    )
    return { jobId: job.id }
  }

  /** Queue one quiz bank. */
  async generateQuiz(input: GenerateQuizInput): Promise<{ jobId: string }> {
    if (!(await this.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
    const job = await this.deps.jobs.create('quiz', { material: input.material, unit: input.unit }, context =>
      this.runQuiz(input.material, input.unit, context),
    )
    return { jobId: job.id }
  }

  /** Queue insight extraction for a unit or a cross-material concept. */
  async generateInsights(input: GenerateInsightInput): Promise<{ jobId: string }> {
    if (!(await this.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
    if (input.unit !== undefined && input.material !== undefined) {
      const job = await this.deps.jobs.create('insight', { material: input.material, unit: input.unit }, context =>
        this.runUnitInsights(input.material!, input.unit!, context),
      )
      return { jobId: job.id }
    }
    if (input.concept !== undefined) {
      const job = await this.deps.jobs.create('insight', { concept: input.concept }, context =>
        this.runConceptInsights(input.concept!, context),
      )
      return { jobId: job.id }
    }
    throw new StudyError('invalid', '需要指定 unit 或 concept')
  }

  /** Test the current settings for one capability. */
  async testEngine(kind: 'text' | 'image' | 'animation' | 'embedding'): Promise<Record<string, unknown>> {
    const settings = await this.deps.settings.current()
    const started = Date.now()
    try {
      if (kind === 'text') {
        const provider = textProviderFrom(settings, this.deps)
        const result = await provider.complete({ system: '只回复两个字：可用', user: '测试连接' })
        return {
          ok: true,
          engine: provider.name,
          ...(result.model === undefined ? {} : { model: result.model }),
          latencyMs: Date.now() - started,
          reply: result.text.slice(0, 60),
        }
      }
      if (kind === 'embedding') {
        const { embeddingProviderFrom } = await import('./providers/index.ts')
        const provider = embeddingProviderFrom(settings)
        const vectors = await provider.embed(['study desk'])
        return { ok: true, engine: provider.name, latencyMs: Date.now() - started, dimensions: vectors[0]?.length ?? 0 }
      }
      return { ok: false, engine: kind, message: '该能力将在后续阶段接入；当前只启用文本引擎。' }
    } catch (error) {
      return {
        ok: false,
        engine: kind,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async requireSettings(): Promise<StudySettings> {
    const settings = await this.deps.settings.current()
    if (!this.ready(settings)) throw new StudyError('unsupported', '还没有可用的文本引擎')
    return settings
  }

  /**
   * Complete one JSON contract, repairing once with the validation issues.
   *
   * `accept` must validate before writing; the repair call therefore never leaves
   * a half-written unit behind.
   */
  private async completeJson<T>(context: JobContext, prompt: Prompt, accept: (parsed: unknown) => Promise<T>): Promise<T> {
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
      throw new StudyError('invalid', '模型输出未通过校验', { issues: issuesOf(error) })
    }
  }

  private async runPlan(planId: string, input: GeneratePlanInput, context: JobContext): Promise<PlanDetailView> {
    await this.deps.service.setPlanGeneration(planId, { status: 'running', jobId: context.job.id })
    try {
      const plan = await readPlan(this.paths, planId)
      if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
      const all = await listManifests(this.paths)
      const chosen = (plan.materials ?? input.materials)
        .map(id => all.find(manifest => manifest.id === id))
        .filter((manifest): manifest is MaterialManifest => manifest !== undefined)
      if (chosen.length === 0) throw new StudyError('not-found', '计划的资料都不存在了')
      const concepts = (await this.deps.service.concepts()).map(concept => ({
        id: concept.id,
        name: concept.name,
        mastery: concept.mastery,
      }))
      const prompt = planPrompt({
        goal: plan.goal,
        ...(plan.brief === undefined ? {} : { brief: plan.brief }),
        depth: input.depth ?? 'deep',
        ...(plan.budget?.hoursPerWeek === undefined ? {} : { hoursPerWeek: plan.budget.hoursPerWeek }),
        manifests: chosen,
        concepts,
      })
      let count = 0
      await this.completeJson(context, prompt, async parsed => {
        const steps = normalizePlanSteps(parsed)
        count = steps.length
        await this.deps.service.updatePlan(planId, { replaceSteps: steps })
      })
      await this.deps.service.setPlanGeneration(planId, { status: 'done', jobId: context.job.id })
      context.report(1, `已生成 ${count} 步`)
      return await this.deps.service.planView(planId)
    } catch (error) {
      await this.deps.service.setPlanGeneration(planId, {
        status: 'failed',
        jobId: context.job.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async runUnit(input: GenerateUnitInput, context: JobContext): Promise<Record<string, unknown>> {
    const material = await this.deps.service.unitMaterial(input.material, input.unit, input.maxChars ?? 24_000)
    let goal: string | undefined
    let why: string | undefined
    if (input.planId !== undefined) {
      const plan = await readPlan(this.paths, input.planId)
      const target = `${input.material}:${input.unit}`
      const step = plan?.steps.find(candidate => candidate.target === target)
      goal = plan?.goal
      why = step?.why
    }
    const prompt = unitPrompt({
      material: material.material,
      unit: {
        uid: material.node.uid,
        title: material.node.title,
        pageStart: material.node.pageStart,
        pageEnd: material.node.pageEnd,
        kind: material.node.kind,
        ...(material.node.pass === undefined ? {} : { pass: material.node.pass }),
      },
      pageText: material.text,
      existingConcepts: material.concepts,
      ...(goal === undefined ? {} : { goal }),
      ...(why === undefined ? {} : { why }),
    })
    let written: WriteUnitResult | undefined
    await this.completeJson(context, prompt, async parsed => {
      const data = normalizeUnitOutput(parsed)
      written = await this.deps.service.writeUnit(input.material, input.unit, data)
    })
    if (written === undefined) throw new StudyError('invalid', '精读稿没有写入')
    const settings = await this.deps.settings.current()
    const warnings = [...written.warnings]
    let quizItems = 0
    let insightIds: string[] = []
    if (settings.study.autoQuiz) {
      try {
        const bank = await this.runQuizInternal(input.material, input.unit, context, 0.9)
        quizItems = bank.items.length
      } catch (error) {
        warnings.push(`练习题生成失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (settings.study.autoInsight) {
      try {
        insightIds = await this.runUnitInsightsInternal(input.material, input.unit, context, 0.94)
      } catch (error) {
        warnings.push(`洞察提炼失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    context.report(1, '完成')
    return {
      material: input.material,
      unit: input.unit,
      words: written.words,
      concepts: written.concepts,
      quizItems,
      insightIds,
      warnings,
    }
  }

  private async runQuiz(material: string, unit: string, context: JobContext): Promise<{ items: number }> {
    const bank = await this.runQuizInternal(material, unit, context, 0.1)
    context.report(1, `已生成 ${bank.items.length} 题`)
    return { items: bank.items.length }
  }

  private async runQuizInternal(materialId: string, unitId: string, context: JobContext, base: number): Promise<QuizBank> {
    const unit = await this.deps.service.unit(materialId, unitId)
    if (unit.notes === null) throw new StudyError('invalid', '这一节还没有精读稿，先写精读再出题')
    const node = unit.unit
    const prompt = quizPrompt({
      materialTitle: unit.material.title,
      unitTitle: node.title,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      notes: unit.notes,
      concepts: node.concepts,
      count: 5,
    })
    context.report(base, '正在出题…')
    let bank: QuizBank | undefined
    await this.completeJson(context, prompt, async parsed => {
      const items = normalizeQuizItems(parsed)
      bank = await this.deps.service.writeQuiz(materialId, unitId, items)
    })
    if (bank === undefined) throw new StudyError('invalid', '练习题没有写入')
    return bank
  }

  private async runUnitInsights(material: string, unit: string, context: JobContext): Promise<{ ids: string[] }> {
    const ids = await this.runUnitInsightsInternal(material, unit, context, 0.1)
    context.report(1, `已提炼 ${ids.length} 条`)
    return { ids }
  }

  private async runUnitInsightsInternal(materialId: string, unitId: string, context: JobContext, base: number): Promise<string[]> {
    const unit = await this.deps.service.unit(materialId, unitId)
    if (unit.notes === null) throw new StudyError('invalid', '这一节还没有精读稿，先写精读再提炼')
    const node = unit.unit
    const prompt = insightPrompt({
      materialTitle: unit.material.title,
      unitTitle: node.title,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      notes: unit.notes,
      concepts: node.concepts,
      count: 3,
    })
    context.report(base, '正在提炼洞察…')
    let ids: string[] = []
    await this.completeJson(context, prompt, async parsed => {
      const records = normalizeInsightBatch(parsed, {
        material: materialId,
        unit: unitId,
        range: { pageStart: node.pageStart, pageEnd: node.pageEnd },
      })
      const written: string[] = []
      for (const record of records) {
        const saved = await this.deps.insights.upsertGenerated({
          ...record,
          sourceKey: `${materialId}:${unitId}`,
          origin: 'generated',
          generatedBy: { engine: (await this.deps.settings.current()).text.kind, promptVersion: PROMPT_VERSION, at: new Date().toISOString() },
        })
        written.push(saved.id)
      }
      ids = written
      await this.deps.service.attachInsights(materialId, unitId, written)
    })
    return ids
  }

  private async runConceptInsights(conceptId: string, context: JobContext): Promise<{ ids: string[] }> {
    const view = await this.deps.service.conceptView(conceptId)
    if (view.occurrences.length === 0) throw new StudyError('invalid', '这个概念还没有任何出现位置')
    const occurrences: Array<{
      materialId: string
      materialTitle: string
      unitId: string
      unitTitle: string
      page: number
      range: { pageStart: number; pageEnd: number }
      notes: string
    }> = []
    for (const occurrence of view.occurrences.slice(0, 6)) {
      const material = await this.deps.service.unitMaterial(occurrence.materialId, occurrence.unitId, 8_000)
      const unit = await this.deps.service.unit(occurrence.materialId, occurrence.unitId)
      occurrences.push({
        materialId: occurrence.materialId,
        materialTitle: occurrence.materialTitle,
        unitId: occurrence.unitId,
        unitTitle: occurrence.unitTitle,
        page: occurrence.page,
        range: { pageStart: material.node.pageStart, pageEnd: material.node.pageEnd },
        notes: unit.notes ?? material.text,
      })
    }
    const prompt = conceptInsightPrompt({
      concept: { id: view.concept.id, name: view.concept.name, definition: view.concept.definition },
      occurrences,
    })
    const ranges = new Map<string, { pageStart: number; pageEnd: number }>()
    for (const occurrence of occurrences) {
      ranges.set(`${occurrence.materialId}:${occurrence.unitId}`, occurrence.range)
    }
    let ids: string[] = []
    await this.completeJson(context, prompt, async parsed => {
      const records = normalizeInsightBatch(parsed, undefined, ranges)
      const written: string[] = []
      for (const record of records) {
        const saved = await this.deps.insights.create({
          ...record,
          origin: 'generated',
          generatedBy: { engine: (await this.deps.settings.current()).text.kind, promptVersion: PROMPT_VERSION, at: new Date().toISOString() },
        })
        written.push(saved.id)
      }
      ids = written
    })
    context.report(1, `已合并 ${ids.length} 条`)
    return { ids }
  }
}

/** Normalize a plan answer; throws with all shape issues. */
function normalizePlanSteps(parsed: unknown): Array<{
  kind: PlanStepKind
  target?: string
  concepts?: string[]
  materials?: string[]
  why: string
}> {
  const body = asRecord(parsed)
  const raw = asArray(body.steps, 'steps')
  const issues: string[] = []
  const steps: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string }> = []
  raw.forEach((entry, index) => {
    const row = asRecord(entry)
    const kind = row.kind
    if (typeof kind !== 'string' || !PLAN_KINDS.includes(kind as PlanStepKind)) {
      issues.push(`第 ${index + 1} 步 kind 非法`)
      return
    }
    const why = typeof row.why === 'string' ? row.why.trim() : ''
    if (why.length === 0) issues.push(`第 ${index + 1} 步缺少 why`)
    const step: { kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string } = {
      kind: kind as PlanStepKind,
      why,
    }
    if (kind === 'unit' || kind === 'paper-pass') {
      if (typeof row.target !== 'string' || !row.target.includes(':')) issues.push(`第 ${index + 1} 步缺少 target`)
      else step.target = row.target.trim()
    } else if (kind === 'drill') {
      if (!Array.isArray(row.concepts) || row.concepts.length === 0) issues.push(`第 ${index + 1} 步缺少 concepts`)
      else step.concepts = row.concepts.map(String)
    } else if (kind === 'compare') {
      if (!Array.isArray(row.materials) || row.materials.length < 2) issues.push(`第 ${index + 1} 步 compare 至少需要两份资料`)
      else step.materials = row.materials.map(String)
    }
    steps.push(step)
  })
  if (steps.length === 0) issues.push('steps 为空')
  if (issues.length > 0) throw new StudyError('invalid', '计划结构不合法', { issues })
  return steps
}

/** Normalize the unit-notes answer. */
function normalizeUnitOutput(parsed: unknown): {
  notes: string
  pageRefs: number[]
  concepts: Array<{ id: string; name?: string; definition?: string }>
} {
  const body = asRecord(parsed)
  const notes = asString(body.notes, 'notes')
  const pageRefs = asArray(body.pageRefs, 'pageRefs')
    .map(value => asNumber(value))
    .filter((value): value is number => value !== undefined)
  const concepts = asArray(body.concepts, 'concepts').map(entry => {
    const row = asRecord(entry)
    const id = asString(row.id, 'concept.id')
    return {
      id,
      ...(typeof row.name === 'string' && row.name.trim().length > 0 ? { name: row.name.trim() } : {}),
      ...(typeof row.definition === 'string' && row.definition.trim().length > 0 ? { definition: row.definition.trim() } : {}),
    }
  })
  return { notes, pageRefs, concepts }
}

/** Normalize the quiz answer into typed items. */
function normalizeQuizItems(parsed: unknown): QuizItem[] {
  const body = asRecord(parsed)
  const raw = asArray(body.items, 'items')
  const issues: string[] = []
  const items: QuizItem[] = []
  raw.forEach((entry, index) => {
    const row = asRecord(entry)
    const typeValue = typeof row.type === 'string' ? row.type : ''
    if (!QUIZ_TYPES.includes(typeValue as QuizItemType)) {
      issues.push(`第 ${index + 1} 题 type 非法`)
      return
    }
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    if (question.length === 0) issues.push(`第 ${index + 1} 题缺少题干`)
    const concepts = Array.isArray(row.concepts) ? row.concepts.map(String) : []
    if (concepts.length === 0) issues.push(`第 ${index + 1} 题没有挂概念`)
    const item: QuizItem = {
      id: `q${index + 1}`,
      type: typeValue as QuizItemType,
      question,
      concepts,
      origin: 'generated',
      ...(asNumber(row.page) === undefined ? {} : { page: asNumber(row.page)! }),
      ...(Array.isArray(row.choices) ? { choices: row.choices.map(String) } : {}),
      ...(asNumber(row.answerIndex) === undefined ? {} : { answerIndex: asNumber(row.answerIndex)! }),
      ...(typeof row.answer === 'string' ? { answer: row.answer } : {}),
      ...(Array.isArray(row.rubric) ? { rubric: row.rubric.map(String) } : {}),
    }
    items.push(item)
  })
  if (items.length === 0) issues.push('items 为空')
  if (issues.length > 0) throw new StudyError('invalid', '练习题结构不合法', { issues })
  return items
}

/** Normalize one or more generated insight cards. */
function normalizeInsightBatch(
  parsed: unknown,
  unitContext?: { material: string; unit: string; range: { pageStart: number; pageEnd: number } },
  ranges?: ReadonlyMap<string, { pageStart: number; pageEnd: number }>,
): Array<{
  title: string
  oneLiner: string
  body: string
  formula?: string
  concepts: string[]
  sources: InsightSource[]
  tags: string[]
  kind: InsightKind
}> {
  const body = asRecord(parsed)
  const raw = asArray(body.insights, 'insights')
  const issues: string[] = []
  const records: Array<{
    title: string
    oneLiner: string
    body: string
    formula?: string
    concepts: string[]
    sources: InsightSource[]
    tags: string[]
    kind: InsightKind
  }> = []
  raw.forEach((entry, index) => {
    const row = asRecord(entry)
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const oneLiner = typeof row.oneLiner === 'string' ? row.oneLiner.trim() : ''
    const text = typeof row.body === 'string' ? row.body.trim() : ''
    const conceptIds = Array.isArray(row.concepts) ? row.concepts.map(String) : []
    const rawSources = Array.isArray(row.sources) ? row.sources : []
    const sources: InsightSource[] = []
    for (const source of rawSources) {
      const sourceRow = asRecord(source)
      const page = asNumber(sourceRow.page)
      if (page === undefined) continue
      const material = typeof sourceRow.material === 'string' ? sourceRow.material : unitContext?.material
      const unit = typeof sourceRow.unit === 'string' ? sourceRow.unit : unitContext?.unit
      if (material === undefined || unit === undefined) continue
      sources.push({
        material,
        unit,
        page,
        ...(typeof sourceRow.quote === 'string' && sourceRow.quote.trim().length > 0 ? { quote: sourceRow.quote.trim() } : {}),
      })
    }
    const kind = typeof row.kind === 'string' && INSIGHT_KINDS.includes(row.kind as InsightKind) ? (row.kind as InsightKind) : 'principle'
    const record = {
      title,
      oneLiner,
      body: text,
      ...(typeof row.formula === 'string' && row.formula.trim().length > 0 ? { formula: row.formula.trim() } : {}),
      concepts: conceptIds,
      sources,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      kind,
    }
    const mappedRanges = ranges ?? new Map(
      unitContext === undefined
        ? []
        : [[`${unitContext.material}:${unitContext.unit}`, unitContext.range] as const],
    )
    const validation = validateInsight({ ...record, ranges: mappedRanges })
    if (validation.length > 0) issues.push(...validation.map(issue => `第 ${index + 1} 条：${issue}`))
    records.push(record)
  })
  if (records.length === 0) issues.push('insights 为空')
  if (issues.length > 0) throw new StudyError('invalid', '洞察结构不合法', { issues })
  return records
}
