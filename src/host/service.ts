/**
 * The study service: the Host's single public face over the library.
 *
 * Both the HTTP routes and the agent tools drive this object, so a checkbox in
 * the browser and a tool call from the assistant change exactly the same state.
 */
import { createWriteStream } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { assertConceptId, assertSegment, slugify, splitUnitKey, uniqueSlug, unitKey } from '../core/ids.ts'
import { listManifests, readManifest, structureNodeOf, unitMetaOf, writeManifest } from '../core/library.ts'
import type { LibraryPaths } from '../core/paths.ts'
import { upsertConcept } from '../core/concepts.ts'
import { dueUnits, isWeak, markLearned, readProgress, recordReview, unmarkLearned } from '../core/progress.ts'
import { listConcepts, readConcept } from '../core/concepts.ts'
import { listPlans, nextStep as nextPlanStep, readPlan, validatePlan, writePlan } from '../core/plans.ts'
import { hash32 } from '../core/srs.ts'
import { ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from '../core/store.ts'
import { addDays, localDate } from '../core/time.ts'
import type {
  MaterialManifest,
  PlanRecord,
  PlanStep,
  PlanStepKind,
  ProgressFile,
  QuizBank,
  Rating,
  StructureNode,
  UnitMetaFile,
  UnitProgress,
} from '../core/types.ts'
import { mathStyleWarnings, validateNotes } from '../core/validate.ts'
import type {
  ConceptCard,
  ConceptDetailView,
  NextStepView,
  PlanBrief,
  PlanDetailView,
  PlanStepView,
  PlanSummary,
  TodayView,
} from '../core/views.ts'
import { ORIGINAL_PAGE_CAP, type CompleteOptions, type CompleteResult, type DueItem, type MaterialCard, type MaterialStateView, type PageSlice, type TocRow, type UnitView } from '../core/views.ts'
import { importMaterial, titleFromName, type ImportRequest, type ImportResult } from './import.ts'

/** A domain refusal with a stable machine code. */
export class StudyError extends Error {
  readonly code: 'not-found' | 'conflict' | 'invalid' | 'unsupported'
  readonly details?: unknown

  constructor(
    code: 'not-found' | 'conflict' | 'invalid' | 'unsupported',
    message: string,
    details?: unknown,
  ) {
    super(message)
    this.name = 'StudyError'
    this.code = code
    this.details = details
  }
}

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
  private readonly deps: StudyDeps

  constructor(paths: LibraryPaths, deps: StudyDeps = {}) {
    this.paths = paths
    this.deps = deps
  }

  /** The local date the service considers "today". */
  today(): string {
    return this.deps.today?.() ?? localDate()
  }

  /** The shelf. */
  async library(): Promise<MaterialCard[]> {
    const [manifests, progress] = await Promise.all([listManifests(this.paths), readProgress(this.paths)])
    return manifests.map(manifest => this.cardOf(manifest, progress))
  }

  /** One material with its table of contents and due list. */
  async materialState(materialId: string): Promise<MaterialStateView> {
    const [manifest, progress] = await Promise.all([this.manifest(materialId), readProgress(this.paths)])
    const today = this.today()
    const dueKeys = new Set(dueUnits(progress, today).map(entry => entry.key))
    const toc: TocRow[] = manifest.structure.map(node => {
      const key = unitKey(materialId, node.uid)
      return this.rowOf(materialId, node, manifest, progress, dueKeys.has(key))
    })
    const next = toc.find(row => row.state === 'new')?.uid
    return {
      material: this.cardOf(manifest, progress),
      toc,
      due: toc.filter(row => dueKeys.has(unitKey(materialId, row.uid))).map(row => row.uid),
      next,
    }
  }

  /** The reader payload for one unit. */
  async unit(materialId: string, unitId: string): Promise<UnitView> {
    const [manifest, progress, notes] = await Promise.all([
      this.manifest(materialId),
      readProgress(this.paths),
      this.readNotes(materialId, unitId),
    ])
    const node = structureNodeOf(manifest, unitId)
    const row = this.rowOf(materialId, node, manifest, progress, false)
    const original = await this.readPages(materialId, node.pageStart, node.pageEnd)
    const meta = await readJson<UnitMetaFile | null>(this.paths.unitMetaFile(materialId, unitId), null)
    return {
      material: this.cardOf(manifest, progress),
      unit: { ...row, concepts: meta?.concepts ?? row.concepts },
      notes,
      original: original.pages,
      truncated: original.truncated,
    }
  }

  /** Everything an authoring agent needs to write one unit. */
  async unitMaterial(materialId: string, unitId: string, maxChars = 12_000): Promise<UnitMaterial> {
    const manifest = await this.manifest(materialId)
    const node = structureNodeOf(manifest, unitId)
    const original = await this.readPages(materialId, node.pageStart, node.pageEnd)
    const meta = await readJson<UnitMetaFile | null>(this.paths.unitMetaFile(materialId, unitId), null)
    const joined = original.pages.map(page => `[p${page.page}]\n${page.text}`).join('\n\n')
    const clipped = joined.length > maxChars ? joined.slice(0, maxChars) : joined
    return {
      material: manifest,
      node,
      text: clipped,
      truncated: joined.length > clipped.length,
      concepts: meta?.concepts ?? [],
      existingNotes: await this.readNotes(materialId, unitId),
    }
  }

  /** Mark a unit learned (the checkbox). */
  async complete(materialId: string, unitId: string, options: CompleteOptions = {}): Promise<CompleteResult> {
    const manifest = await this.manifest(materialId)
    const node = structureNodeOf(manifest, unitId)
    await this.assertRevision(options.revision)
    const key = unitKey(materialId, unitId)
    const before = await readProgress(this.paths)
    if (before.units[key] !== undefined && before.units[key]!.state !== 'new') {
      const current = before.units[key]!
      return {
        unit: this.rowOf(materialId, node, manifest, before, false),
        due: current.due ?? addDays(this.today(), 1),
        revision: before.revision,
        note: '这一节此前已经打过勾。',
      }
    }
    const { progress, unit } = await markLearned(this.paths, key, {
      rating: options.rating,
      today: options.today ?? this.today(),
    })
    return {
      unit: this.rowOf(materialId, node, manifest, progress, false),
      due: unit.due ?? addDays(this.today(), 1),
      revision: progress.revision,
      note: `已记下首次学习，明天进入复习队列（${unit.due}）。`,
    }
  }

  /** Undo the checkbox. */
  async uncomplete(materialId: string, unitId: string): Promise<{ revision: number }> {
    const manifest = await this.manifest(materialId)
    structureNodeOf(manifest, unitId)
    const progress = await unmarkLearned(this.paths, unitKey(materialId, unitId))
    return { revision: progress.revision }
  }

  /** Today's due units, across every material. */
  async due(today = this.today()): Promise<DueItem[]> {
    const [manifests, progress] = await Promise.all([listManifests(this.paths), readProgress(this.paths)])
    const byId = new Map(manifests.map(manifest => [manifest.id, manifest]))
    const items: DueItem[] = []
    for (const entry of dueUnits(progress, today)) {
      const [materialId, unitId] = entry.key.split(':') as [string, string]
      const manifest = byId.get(materialId)
      if (manifest === undefined) continue
      const node = manifest.structure.find(candidate => candidate.uid === unitId)
      if (node === undefined) continue
      items.push({
        key: entry.key,
        materialId,
        unitId,
        title: node.title,
        materialTitle: manifest.title,
        due: entry.due,
        overdueDays: entry.overdueDays,
      })
    }
    return items
  }

  /** Concept list with mastery and where each concept appears. */
  async concepts(): Promise<ConceptCard[]> {
    const [records, progress] = await Promise.all([listConcepts(this.paths), readProgress(this.paths)])
    return records.map(record => {
      const entry = progress.concepts[record.id]
      return {
        id: record.id,
        name: record.name,
        mastery: entry?.mastery ?? 0.5,
        occurrences: record.occurrences.length,
        materials: [...new Set(record.occurrences.map(occurrence => occurrence.material))],
        weak: entry !== undefined && isWeak(entry),
      }
    })
  }

  /** One concept with every occurrence resolved to a jumpable unit. */
  async conceptView(conceptId: string): Promise<ConceptDetailView> {
    const record = await readConcept(this.paths, conceptId)
    if (record === null) throw new StudyError('not-found', `概念不存在：${conceptId}`)
    const [manifests, progress] = await Promise.all([listManifests(this.paths), readProgress(this.paths)])
    const byId = new Map(manifests.map(manifest => [manifest.id, manifest]))
    const occurrences: ConceptDetailView['occurrences'] = []
    for (const occurrence of record.occurrences) {
      const manifest = byId.get(occurrence.material)
      const node = manifest?.structure.find(candidate => candidate.uid === occurrence.unit)
      if (manifest === undefined || node === undefined) continue
      occurrences.push({
        materialId: manifest.id,
        materialTitle: manifest.title,
        unitId: node.uid,
        unitTitle: node.title,
        page: occurrence.page,
        role: occurrence.role,
      })
    }
    return {
      concept: {
        id: record.id,
        name: record.name,
        aliases: record.aliases,
        definition: record.definition,
        prereqOf: record.prereqOf,
        related: record.related,
      },
      ...(progress.concepts[conceptId] === undefined ? {} : { mastery: progress.concepts[conceptId] }),
      occurrences,
    }
  }

  /** The Today page: due reviews, the next step and the weakest concepts. */
  async todayView(): Promise<TodayView> {
    const date = this.today()
    const [due, manifests, progress, plans, concepts] = await Promise.all([
      this.due(date),
      listManifests(this.paths),
      readProgress(this.paths),
      listPlans(this.paths),
      this.concepts(),
    ])

    const activePlans = plans.filter(plan => plan.status === 'active')
    const planBriefs: PlanBrief[] = activePlans.map(plan => {
      const done = plan.steps.filter(step => step.done).length
      const step = nextPlanStep(plan)
      let next: PlanBrief['next']
      if (step?.target !== undefined) {
        try {
          const { materialId, unitId } = splitUnitKey(step.target)
          const manifest = manifests.find(candidate => candidate.id === materialId)
          const node = manifest?.structure.find(candidate => candidate.uid === unitId)
          if (manifest !== undefined && node !== undefined) {
            next = { materialId, unitId, title: node.title }
          }
        } catch {
          next = undefined
        }
      }
      return { id: plan.id, goal: plan.goal, done, total: plan.steps.length, ...(next === undefined ? {} : { next }) }
    })

    let next: NextStepView | null = null
    for (const plan of activePlans) {
      const step = nextPlanStep(plan)
      if (step?.target === undefined) continue
      try {
        const { materialId, unitId } = splitUnitKey(step.target)
        const manifest = manifests.find(candidate => candidate.id === materialId)
        const node = manifest?.structure.find(candidate => candidate.uid === unitId)
        if (manifest !== undefined && node !== undefined) {
          next = { source: 'plan', materialId, unitId, title: node.title, materialTitle: manifest.title, why: step.why }
          break
        }
      } catch {
        continue
      }
    }
    if (next === null) {
      for (const manifest of manifests) {
        const node = manifest.structure.find(candidate => {
          const entry = progress.units[unitKey(manifest.id, candidate.uid)]
          return entry === undefined || entry.state === 'new' || entry.state === 'suspended'
        })
        if (node !== undefined) {
          next = {
            source: 'material',
            materialId: manifest.id,
            unitId: node.uid,
            title: node.title,
            materialTitle: manifest.title,
            why: '书序下一节',
          }
          break
        }
      }
    }

    const learnedToday = Object.values(progress.units).filter(entry => {
      const first = entry.firstLearnedAt === undefined ? '' : localDate(new Date(entry.firstLearnedAt))
      const last = entry.lastReviewedAt === undefined ? '' : localDate(new Date(entry.lastReviewedAt))
      return first === date || last === date
    }).length

    return {
      date,
      due,
      weak: concepts.filter(concept => concept.weak).slice(0, 5),
      next,
      plans: planBriefs,
      learnedToday,
    }
  }

  /** Record one review rating. */
  async review(
    materialId: string,
    unitId: string,
    options: { rating: Rating; quizScore?: number; revision?: number },
  ): Promise<CompleteResult> {
    const manifest = await this.manifest(materialId)
    const node = structureNodeOf(manifest, unitId)
    await this.assertRevision(options.revision)
    const key = unitKey(materialId, unitId)
    const { progress, unit } = await recordReview(this.paths, key, {
      rating: options.rating,
      quizScore: options.quizScore,
      today: this.today(),
    })
    return {
      unit: this.rowOf(materialId, node, manifest, progress, false),
      due: unit.due ?? addDays(this.today(), 1),
      revision: progress.revision,
      note: `已记录评级 ${options.rating}，下次复习 ${unit.due}。`,
    }
  }

  /**
   * Create a goal placeholder and hand the orchestration to the current chat.
   *
   * The Host writes a draft plan (so the Path page can show "编排中") and then
   * queues one instruction into the conversation the user is looking at. The
   * Agent there fills the steps and rewrites the chosen units with the study
   * tools; nothing here calls a model directly.
   */
  async createGoal(input: {
    goal: string
    brief?: string
    materials: readonly string[]
    hoursPerWeek?: number
    depth?: 'deep' | 'overview'
    sessionId?: string
  }): Promise<{ planId: string; prompted: boolean; error?: string; prompt: string }> {
    const goal = input.goal.trim()
    if (goal.length === 0) throw new StudyError('invalid', '目标不能为空')
    if (input.materials.length === 0) throw new StudyError('invalid', '至少选择一份资料')
    const manifests = await listManifests(this.paths)
    const chosen = input.materials.map(id => {
      const manifest = manifests.find(candidate => candidate.id === id)
      if (manifest === undefined) throw new StudyError('not-found', `资料不存在：${id}`)
      return manifest
    })

    const plans = await listPlans(this.paths)
    const planId = uniqueSlug(slugify(goal, `g-${hash32(goal).toString(36)}`), new Set(plans.map(plan => plan.id)))
    const now = new Date().toISOString()
    const plan: PlanRecord = {
      id: planId,
      goal,
      status: 'draft',
      ...(input.brief === undefined || input.brief.trim().length === 0 ? {} : { brief: input.brief.trim() }),
      materials: [...input.materials],
      ...(input.hoursPerWeek === undefined ? {} : { budget: { hoursPerWeek: input.hoursPerWeek } }),
      steps: [],
      createdAt: now,
      updatedAt: now,
    }
    await writePlan(this.paths, plan)

    const prompt = this.goalPrompt(plan, chosen, input.depth ?? 'deep')
    if (input.sessionId === undefined || this.deps.promptSession === undefined) {
      return { planId, prompted: false, prompt }
    }
    try {
      await this.deps.promptSession(input.sessionId, prompt)
      return { planId, prompted: true, prompt }
    } catch (error) {
      return { planId, prompted: false, error: error instanceof Error ? error.message : String(error), prompt }
    }
  }

  /** The instruction queued into the conversation for one goal. */
  private goalPrompt(plan: PlanRecord, manifests: readonly MaterialManifest[], depth: 'deep' | 'overview'): string {
    const catalogue = manifests
      .map(manifest => {
        const rows = manifest.structure.slice(0, 60).map(node => `    - ${node.uid}｜${node.title}（p${node.pageStart}${node.pageEnd > node.pageStart ? `–${node.pageEnd}` : ''}）`)
        const more = manifest.structure.length > 60 ? `    …共 ${manifest.structure.length} 个单元` : ''
        return `- ${manifest.id}｜《${manifest.title}》｜${manifest.type}｜${manifest.units.length} 单元\n${rows.join('\n')}${more}`
      })
      .join('\n')
    const hours = plan.budget?.hoursPerWeek === undefined ? '未指定' : `每周约 ${plan.budget.hoursPerWeek} 小时`
    const mode = depth === 'deep' ? '精读（逐节重写）' : '速览（只做总览、论文关键节与对比）'
    return [
      '用户在学习桌里新建了一个学习目标，请在本次会话中完成「编排 + 重写」。',
      '',
      `目标：${plan.goal}`,
      ...(plan.brief === undefined ? [] : [`补充说明：${plan.brief}`]),
      `深度：${mode}`,
      `时间预算：${hours}`,
      `计划 id：${plan.id}`,
      '',
      '只用这些选定资料：',
      catalogue,
      '',
      '请按顺序执行：',
      `1. 用 study_library 确认资料与单元；然后用 study_plan_update 把计划 ${plan.id} 的步骤写出来（unit / paper-pass / drill / compare，每步 why 必须呼应目标，只选真正相关的单元）。Host 会在步骤写入后把它转为 active。`,
      '2. 从最核心的单元开始：study_unit_material → 按目标重写精读稿（保留固定八节，其中「逐步讲解」优先展开与目标相关的部分，并在「常见误区」后加一段「与目标的关系」）→ study_unit_write → study_unit_verify。',
      '3. 先做 1 节样例，让我确认风格，再继续其余单元；不要一次生成整本书。',
      '4. 全部完成后用三句话总结这条路径与下一步。',
    ].join('\n')
  }

  /**
   * Import an uploaded PDF: the bytes stream to a temp file, import, delete.
   * @param stream - the request body.
   * @param fileName - original file name, for the title fallback.
   */
  async importUpload(stream: AsyncIterable<Uint8Array | Buffer>, fileName: string): Promise<ImportResult> {
    const dir = join(this.paths.root, 'tmp')
    await ensureDir(dir)
    const temp = join(dir, `upload-${crypto.randomUUID()}.pdf`)
    try {
      await pipeline(Readable.from(stream), createWriteStream(temp))
      return await this.import({ filePath: temp, origin: `upload:${fileName}`, title: titleFromName(fileName) })
    } finally {
      await unlink(temp).catch(() => undefined)
    }
  }

  /**
   * Import one arXiv paper by URL or id.
   * @param url - an arxiv.org link or a bare `YYMM.NNNNN` id.
   */
  async importFromUrl(url: string): Promise<ImportResult> {
    const id = /(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(url.trim())?.[1]
    if (id === undefined) throw new StudyError('invalid', '目前只支持 arXiv 链接，例如 https://arxiv.org/abs/1706.03762')
    const response = await fetch(`https://arxiv.org/pdf/${id}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
      headers: { 'user-agent': 'dsh-study/0.1 (local study library)' },
    })
    if (!response.ok || response.body === null) {
      throw new StudyError('invalid', `arXiv 下载失败（HTTP ${response.status}）`)
    }
    const dir = join(this.paths.root, 'tmp')
    await ensureDir(dir)
    const temp = join(dir, `arxiv-${id.replace('.', '-')}-${crypto.randomUUID()}.pdf`)
    try {
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(temp))
      return await this.import({
        filePath: temp,
        origin: `https://arxiv.org/abs/${id}`,
        type: 'paper',
        title: `arXiv ${id}`,
      })
    } finally {
      await unlink(temp).catch(() => undefined)
    }
  }

  /** Every plan with its progress. */
  async planList(): Promise<PlanSummary[]> {
    const [plans, manifests] = await Promise.all([listPlans(this.paths), listManifests(this.paths)])
    const byId = new Map(manifests.map(manifest => [manifest.id, manifest]))
    return plans.map(plan => {
      const done = plan.steps.filter(step => step.done).length
      const step = nextPlanStep(plan)
      let next: string | undefined
      if (step?.target !== undefined) {
        try {
          const { materialId, unitId } = splitUnitKey(step.target)
          next = byId.get(materialId)?.structure.find(node => node.uid === unitId)?.title
        } catch {
          next = undefined
        }
      }
      return {
        id: plan.id,
        goal: plan.goal,
        status: plan.status,
        done,
        total: plan.steps.length,
        ...(next === undefined ? {} : { next }),
      }
    })
  }

  /** One plan with resolved steps. */
  async planView(planId: string): Promise<PlanDetailView> {
    const plan = await readPlan(this.paths, planId)
    if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
    const [manifests, progress, concepts] = await Promise.all([
      listManifests(this.paths),
      readProgress(this.paths),
      listConcepts(this.paths),
    ])
    const conceptById = new Map(concepts.map(concept => [concept.id, concept]))
    const steps = plan.steps.map(step => this.stepView(step, manifests, conceptById, progress))
    return {
      plan: {
        id: plan.id,
        goal: plan.goal,
        status: plan.status,
        ...(plan.budget?.hoursPerWeek === undefined ? {} : { hoursPerWeek: plan.budget.hoursPerWeek }),
        ...(plan.brief === undefined ? {} : { brief: plan.brief }),
      },
      steps,
      done: steps.filter(step => step.done).length,
      total: steps.length,
    }
  }

  /** Create and validate a plan. */
  async createPlan(input: {
    goal: string
    steps: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string }>
    hoursPerWeek?: number
    id?: string
  }): Promise<PlanDetailView> {
    const [manifests, concepts, plans] = await Promise.all([
      listManifests(this.paths),
      listConcepts(this.paths),
      listPlans(this.paths),
    ])
    const taken = new Set(plans.map(plan => plan.id))
    const plan: PlanRecord = {
      id: input.id ?? uniqueSlug(slugify(input.goal, 'plan'), taken),
      goal: input.goal.trim(),
      status: 'active',
      ...(input.hoursPerWeek === undefined ? {} : { budget: { hoursPerWeek: input.hoursPerWeek } }),
      steps: input.steps.map((step, index) => ({
        n: index + 1,
        kind: step.kind,
        ...(step.target === undefined ? {} : { target: step.target }),
        ...(step.concepts === undefined ? {} : { concepts: step.concepts }),
        ...(step.materials === undefined ? {} : { materials: step.materials }),
        why: step.why,
        done: false,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const issues = validatePlan(plan, this.planTargets(manifests, concepts))
    if (issues.length > 0) throw new StudyError('invalid', '计划未通过校验', { issues })
    await writePlan(this.paths, plan)
    return this.planView(plan.id)
  }

  /** Patch one plan: step completion, status, goal or a whole new step list. */
  async updatePlan(
    planId: string,
    input: {
      setStep?: { n: number; done: boolean }
      setStatus?: 'active' | 'paused' | 'done'
      setGoal?: string
      replaceSteps?: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string }>
    },
  ): Promise<PlanDetailView> {
    const plan = await readPlan(this.paths, planId)
    if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)

    if (input.setGoal !== undefined) {
      if (input.setGoal.trim().length === 0) throw new StudyError('invalid', '目标不能为空')
      plan.goal = input.setGoal.trim()
    }
    if (input.setStatus !== undefined) plan.status = input.setStatus
    if (input.setStep !== undefined) {
      const step = plan.steps.find(candidate => candidate.n === input.setStep!.n)
      if (step === undefined) throw new StudyError('invalid', `计划没有第 ${input.setStep.n} 步`)
      step.done = input.setStep.done
    }
    if (input.replaceSteps !== undefined) {
      if (plan.steps.length === 0 && plan.status === 'draft') plan.status = 'active'
      plan.steps = input.replaceSteps.map((step, index) => ({
        n: index + 1,
        kind: step.kind,
        ...(step.target === undefined ? {} : { target: step.target }),
        ...(step.concepts === undefined ? {} : { concepts: step.concepts }),
        ...(step.materials === undefined ? {} : { materials: step.materials }),
        why: step.why,
        done: false,
      }))
    }

    const [manifests, concepts] = await Promise.all([listManifests(this.paths), listConcepts(this.paths)])
    const issues = validatePlan(plan, this.planTargets(manifests, concepts))
    if (issues.length > 0) throw new StudyError('invalid', '计划未通过校验', { issues })
    await writePlan(this.paths, plan)
    return this.planView(planId)
  }

  /** Resolve one plan step into human labels. */
  private stepView(
    step: PlanStep,
    manifests: readonly MaterialManifest[],
    conceptById: ReadonlyMap<string, { id: string; name: string }>,
    progress: ProgressFile,
  ): PlanStepView {
    const view: PlanStepView = { n: step.n, kind: step.kind, why: step.why, done: step.done }
    if (step.target !== undefined) {
      try {
        const { materialId, unitId } = splitUnitKey(step.target)
        const manifest = manifests.find(candidate => candidate.id === materialId)
        const node = manifest?.structure.find(candidate => candidate.uid === unitId)
        if (manifest !== undefined && node !== undefined) {
          view.target = { materialId, unitId, title: node.title, materialTitle: manifest.title }
        }
      } catch {
        // A stale target is dropped from the view; validatePlan refuses new ones.
      }
    }
    if (step.concepts !== undefined) {
      view.concepts = step.concepts.map(id => ({
        id,
        name: conceptById.get(id)?.name ?? id,
        mastery: progress.concepts[id]?.mastery ?? 0.5,
      }))
    }
    if (step.materials !== undefined) {
      view.materials = step.materials.map(id => ({
        id,
        title: manifests.find(manifest => manifest.id === id)?.title ?? id,
      }))
    }
    return view
  }

  /** Target resolver used by plan validation. */
  private planTargets(
    manifests: readonly MaterialManifest[],
    concepts: ReadonlyArray<{ id: string }>,
  ): { hasUnit(key: string): boolean; hasConcept(id: string): boolean; hasMaterial(id: string): boolean } {
    const conceptIds = new Set(concepts.map(concept => concept.id))
    return {
      hasUnit: key => {
        let materialId: string
        let unitId: string
        try {
          const parts = splitUnitKey(key)
          materialId = parts.materialId
          unitId = parts.unitId
        } catch {
          return false
        }
        return manifests.some(manifest => manifest.id === materialId && manifest.structure.some(node => node.uid === unitId))
      },
      hasConcept: id => conceptIds.has(id),
      hasMaterial: id => manifests.some(manifest => manifest.id === id),
    }
  }

  /** Import one PDF. */
  async import(request: ImportRequest): Promise<ImportResult> {
    return importMaterial(this.paths, request)
  }

  /** Replace a material's structure (agent correction after import). */
  async structureSet(materialId: string, nodes: readonly StructureNode[]): Promise<MaterialManifest> {
    const manifest = await this.manifest(materialId)
    if (nodes.length === 0) throw new StudyError('invalid', '结构不能为空')
    const seen = new Set<string>()
    for (const node of nodes) {
      assertSegment(node.uid, 'unit id')
      if (seen.has(node.uid)) throw new StudyError('invalid', `重复的单元 id：${node.uid}`)
      seen.add(node.uid)
      if (node.pageStart < 1 || node.pageEnd < node.pageStart || node.pageEnd > manifest.source.pages) {
        throw new StudyError('invalid', `单元 ${node.uid} 的页码范围非法：${node.pageStart}-${node.pageEnd}`)
      }
    }
    const previous = new Map(manifest.units.map(unit => [unit.uid, unit]))
    manifest.structure = nodes.map(node => ({ ...node }))
    manifest.units = nodes.map(node => previous.get(node.uid) ?? { uid: node.uid, status: 'new' as const, concepts: [] })
    await writeManifest(this.paths, manifest)
    return manifest
  }

  /** Write one unit's notes and concepts after validation. */
  async writeUnit(
    materialId: string,
    unitId: string,
    input: {
      notes: string
      pageRefs: readonly number[]
      concepts: ReadonlyArray<{ id: string; name?: string; definition?: string }>
    },
  ): Promise<WriteUnitResult> {
    const manifest = await this.manifest(materialId)
    const node = structureNodeOf(manifest, unitId)
    for (const concept of input.concepts) assertConceptId(concept.id)
    const validation = validateNotes({
      markdown: input.notes,
      pageRefs: input.pageRefs,
      concepts: input.concepts.map(concept => concept.id),
      range: { pageStart: node.pageStart, pageEnd: node.pageEnd },
    })
    if (!validation.ok) {
      throw new StudyError('invalid', '精读稿未通过校验', { issues: validation.issues })
    }

    const now = new Date().toISOString()
    const meta: UnitMetaFile = {
      version: 1,
      material: materialId,
      unit: unitId,
      title: node.title,
      concepts: input.concepts.map(concept => concept.id),
      pageRefs: [...new Set(input.pageRefs)].sort((a, b) => a - b),
      generatedBy: { at: now, promptVersion: 'v1' },
    }
    await writeTextAtomic(this.paths.notesFile(materialId, unitId), input.notes.trimEnd() + '\n')
    await writeJsonAtomic(this.paths.unitMetaFile(materialId, unitId), meta)

    for (const concept of input.concepts) {
      await upsertConcept(this.paths, {
        id: concept.id,
        name: concept.name ?? concept.id,
        definition: concept.definition,
        occurrences: [
          {
            material: materialId,
            unit: unitId,
            page: input.pageRefs[0] ?? node.pageStart,
            role: 'definition',
          },
        ],
      })
    }

    const unit = manifest.units.find(candidate => candidate.uid === unitId)
    if (unit !== undefined) {
      unit.status = 'drafted'
      unit.concepts = input.concepts.map(concept => concept.id)
      unit.words = input.notes.length
    }
    await writeManifest(this.paths, manifest)

    return {
      material: materialId,
      unit: unitId,
      status: 'drafted',
      words: input.notes.length,
      concepts: input.concepts.map(concept => concept.id),
      warnings: mathStyleWarnings(input.notes),
    }
  }

  /** Record a verification verdict for one unit. */
  async verifyUnit(
    materialId: string,
    unitId: string,
    input: { verdict: 'pass' | 'fail'; issues?: readonly string[] },
  ): Promise<{ status: UnitMetaFile['verification'] }> {
    const manifest = await this.manifest(materialId)
    structureNodeOf(manifest, unitId)
    const meta = await readJson<UnitMetaFile | null>(this.paths.unitMetaFile(materialId, unitId), null)
    if (meta === null) throw new StudyError('invalid', '这一节还没有精读稿，先写再校验')
    const verification = {
      verdict: input.verdict,
      issues: [...(input.issues ?? [])],
      at: new Date().toISOString(),
    }
    meta.verification = verification
    await writeJsonAtomic(this.paths.unitMetaFile(materialId, unitId), meta)

    const unit = manifest.units.find(candidate => candidate.uid === unitId)
    if (unit !== undefined) unit.status = input.verdict === 'pass' ? 'verified' : 'drafted'
    await writeManifest(this.paths, manifest)
    return { status: verification }
  }

  /** The quiz bank of one unit, when it exists. */
  async quiz(materialId: string, unitId: string): Promise<QuizBank | null> {
    const manifest = await this.manifest(materialId)
    structureNodeOf(manifest, unitId)
    return readJson<QuizBank | null>(this.paths.quizFile(materialId, unitId), null)
  }

  /** Read a manifest or throw a typed refusal. */
  async manifest(materialId: string): Promise<MaterialManifest> {
    try {
      assertSegment(materialId, 'material id')
      return await readManifest(this.paths, materialId)
    } catch (error) {
      if (error instanceof StudyError) throw error
      if (error instanceof Error && error.message.startsWith('unknown material')) {
        throw new StudyError('not-found', `资料不存在：${materialId}`)
      }
      throw error
    }
  }

  /** Build the library card of one material. */
  private cardOf(manifest: MaterialManifest, progress: ProgressFile): MaterialCard {
    const today = this.today()
    const dueKeys = new Set(dueUnits(progress, today).map(entry => entry.key))
    let learned = 0
    let due = 0
    for (const unit of manifest.units) {
      const key = unitKey(manifest.id, unit.uid)
      const entry = progress.units[key]
      if (entry !== undefined && (entry.state === 'learned' || entry.state === 'reviewing')) learned += 1
      if (dueKeys.has(key)) due += 1
    }
    const verified = manifest.units.filter(unit => unit.status === 'verified').length
    return {
      id: manifest.id,
      type: manifest.type,
      title: manifest.title,
      ...(manifest.subtitle === undefined ? {} : { subtitle: manifest.subtitle }),
      authors: manifest.authors,
      ...(manifest.year === undefined ? {} : { year: manifest.year }),
      ...(manifest.venue === undefined ? {} : { venue: manifest.venue }),
      pages: manifest.source.pages,
      importedAt: manifest.source.importedAt,
      units: manifest.units.length,
      verifiedUnits: verified,
      learnedUnits: learned,
      dueCount: due,
      status: learned === 0 ? 'new' : learned >= manifest.units.length ? 'done' : 'learning',
      tags: manifest.tags,
    }
  }

  /** Build one TOC row. */
  private rowOf(
    materialId: string,
    node: StructureNode,
    manifest: MaterialManifest,
    progress: ProgressFile,
    due: boolean,
  ): TocRow {
    const meta = unitMetaOf(manifest, node.uid)
    const entry: UnitProgress | undefined = progress.units[unitKey(materialId, node.uid)]
    return {
      uid: node.uid,
      title: node.title,
      kind: node.kind,
      ...(node.pass === undefined ? {} : { pass: node.pass }),
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      status: meta?.status ?? 'new',
      state: entry?.state ?? 'new',
      ...(entry?.due === undefined ? {} : { due: entry.due }),
      concepts: meta?.concepts ?? [],
    }
  }

  /** Read notes, or null when none exist. */
  private async readNotes(materialId: string, unitId: string): Promise<string | null> {
    try {
      return await readFile(this.paths.notesFile(materialId, unitId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  /** Read the page slices of a range, capped. */
  private async readPages(
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

  /** Optimistic concurrency: the client's revision must match. */
  private async assertRevision(revision?: number): Promise<void> {
    if (revision === undefined) return
    const progress = await readProgress(this.paths)
    if (progress.revision !== revision) {
      throw new StudyError('conflict', '进度已被其他操作更新，请刷新后重试', { revision: progress.revision })
    }
  }
}
