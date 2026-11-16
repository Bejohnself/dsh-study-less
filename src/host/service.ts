/**
 * The study service: the Host's single public face over the library.
 *
 * Both the HTTP routes and the agent tools drive this object, so a checkbox in
 * the browser and a tool call from the assistant change exactly the same state.
 */
import { createWriteStream } from 'node:fs'
import { readFile, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { validateBlocks } from '../core/blocks.ts'
import { assertConceptId, assertSegment, slugify, splitUnitKey, uniqueSlug, unitKey } from '../core/ids.ts'
import { deleteInsight, insightCard, listInsights, readInsight, writeInsight } from '../core/insights.ts'
import { listManifests, readManifest, structureNodeOf, unitMetaOf, writeManifest } from '../core/library.ts'
import type { LibraryPaths } from '../core/paths.ts'
import { upsertConcept, writeConcept } from '../core/concepts.ts'
import { dueUnits, emptyProgress, isWeak, markLearned, readProgress, recordAttempts, recordReview, unmarkLearned } from '../core/progress.ts'
import { listConcepts, readConcept } from '../core/concepts.ts'
import { deletePlan as removePlanFile, listPlans, nextStep as nextPlanStep, readPlan, validatePlan, writePlan } from '../core/plans.ts'
import { deleteCard, dueCards, judgementCardId, listCards, overdueDays, retirePlanCards, reviewCardOnce, upsertJudgementCard } from '../core/cards.ts'
import { coverageOf, deriveStuckPoints, gateStatus, planProgress, summarizeBoundary, thresholdOf } from '../core/planGate.ts'
import { gradeQuizItem } from '../core/quiz.ts'
import { normalizeSettings } from '../core/settings.ts'
import { hash32 } from '../core/srs.ts'
import { ratingFromScore } from '../core/srs.ts'
import { ensureDir, readJson, updateJson, writeJsonAtomic, writeTextAtomic } from '../core/store.ts'
import { addDays, localDate } from '../core/time.ts'
import type {
  AttemptMove,
  AttemptRecord,
  BlockFile,
  BlockInput,
  BlockRecord,
  CardRecord,
  PageLayoutFile,
  ParagraphRecord,
  Coverage,
  MaterialManifest,
  PlanGeneration,
  PlanRecord,
  PlanStep,
  PlanStepKind,
  Provenance,
  ProgressFile,
  QuizBank,
  QuizItem,
  Rating,
  StructureNode,
  UnitMetaFile,
  UnitProgress,
} from '../core/types.ts'
import { mathStyleWarnings, validateNotes, validateQuizBank } from '../core/validate.ts'
import type {
  CardView,
  ConceptCard,
  ConceptDetailView,
  ExtraAsset,
  NextStepView,
  PlanBrief,
  PlanDetailView,
  PlanStepView,
  PlanSummary,
  QuizSubmitView,
  TodayView,
} from '../core/views.ts'
import { ORIGINAL_PAGE_CAP, type CompleteOptions, type CompleteResult, type DueItem, type MaterialCard, type MaterialStateView, type PageSlice, type TocRow, type UnitView } from '../core/views.ts'
import { extractLayouts } from './pdf.ts'
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

  /** Study preferences; a missing or corrupt settings file uses defaults. */
  private async preferences(): Promise<{ targetRetention: number; maxIntervalDays: number }> {
    const settings = normalizeSettings(await readJson<unknown>(this.paths.settingsFile, null))
    return { targetRetention: settings.study.targetRetention, maxIntervalDays: settings.study.maxIntervalDays }
  }

  /** The shelf. Archived materials stay readable by id but are hidden here. */
  async library(includeArchived = false): Promise<MaterialCard[]> {
    const [manifests, progress] = await Promise.all([listManifests(this.paths), readProgress(this.paths)])
    return manifests
      .filter(manifest => includeArchived || manifest.archived !== true)
      .map(manifest => this.cardOf(manifest, progress))
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

  /**
   * The original PDF of one material.
   *
   * The path comes from the manifest, so it is resolved and jailed inside the
   * material directory before the route streams it.
   */
  async pdfSource(materialId: string): Promise<{ file: string; title: string; sha256?: string; pages: number }> {
    const manifest = await this.manifest(materialId)
    const file = this.paths.sourceFile(materialId, manifest.source.path)
    return {
      file,
      title: manifest.title,
      ...(manifest.source.sha256 === undefined ? {} : { sha256: manifest.source.sha256 }),
      pages: manifest.source.pages,
    }
  }

  /** Whether the original PDF is still on disk. */
  async pdfAvailable(materialId: string): Promise<boolean> {
    try {
      const { file } = await this.pdfSource(materialId)
      const info = await stat(file)
      return info.isFile() && info.size > 0
    } catch {
      return false
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
    const quiz = await readJson<QuizBank | null>(this.paths.quizFile(materialId, unitId), null)
    const blocks = await readJson<BlockFile | null>(this.paths.blocksFile(materialId, unitId), null)
    const insights: UnitView['insights'] = []
    for (const insightIdValue of meta?.insights ?? []) {
      const record = await readInsight(this.paths, insightIdValue)
      if (record !== null) insights.push(insightCard(record))
    }
    return {
      material: this.cardOf(manifest, progress),
      unit: { ...row, concepts: meta?.concepts ?? row.concepts },
      notes,
      pdfAvailable: await this.pdfAvailable(materialId),
      original: original.pages,
      truncated: original.truncated,
      quiz,
      extras: this.extrasOf(materialId, unitId, meta),
      insights,
      // A page-based blocks file from an older version is not readable by the
      // paragraph rail: treat it as "not generated" so the rail offers a rebuild.
      blocks: blocks !== null && blocks.version === 2 ? blocks.blocks : null,
    }
  }

  /** Build the media list of one unit from its metadata. */
  private extrasOf(materialId: string, unitId: string, meta: UnitMetaFile | null): ExtraAsset[] {
    const extras = meta?.extras
    if (extras === undefined) return []
    const names = [...(extras.image ?? []), ...(extras.anim ?? []), ...(extras.media ?? []), ...(extras.code ?? [])]
    const assets: ExtraAsset[] = []
    const seen = new Set<string>()
    for (const name of names) {
      if (seen.has(name) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) || name.includes('..')) continue
      seen.add(name)
      const lower = name.toLowerCase()
      const kind: ExtraAsset['kind'] = /\.(png|jpe?g|webp|gif|svg)$/.test(lower)
        ? 'image'
        : /\.(html?|svg)$/.test(lower)
          ? 'animation'
          : /\.(mp4|webm|mov)$/.test(lower)
            ? 'video'
            : /\.(js|ts|py|json|txt|md|css)$/.test(lower)
              ? 'code'
              : 'other'
      assets.push({
        name,
        kind,
        url: `/study-api/asset?mid=${encodeURIComponent(materialId)}&uid=${encodeURIComponent(unitId)}&name=${encodeURIComponent(name)}`,
      })
    }
    return assets
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
      const { done, total } = planProgress(plan)
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
      return {
        id: plan.id,
        goal: plan.goal,
        done,
        total,
        gateReady: gateStatus(plan).ready,
        ...(plan.deliverable === undefined ? {} : { deliverable: plan.deliverable }),
        ...(next === undefined ? {} : { next }),
      }
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
          next = {
            source: 'plan',
            planId: plan.id,
            materialId,
            unitId,
            title: node.title,
            materialTitle: manifest.title,
            why: step.why,
          }
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

    const dueCardViews = await this.dueCardList(date)
    const pinned = (await listInsights(this.paths)).find(record => record.pinned)

    return {
      date,
      dueCards: dueCardViews,
      due,
      weak: concepts.filter(concept => concept.weak).slice(0, 5),
      next,
      plans: planBriefs,
      learnedToday,
      ...(pinned === undefined ? {} : { pinnedInsight: insightCard(pinned) }),
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
    const preferences = await this.preferences()
    const { progress, unit } = await recordReview(this.paths, key, {
      rating: options.rating,
      quizScore: options.quizScore,
      today: this.today(),
      targetRetention: preferences.targetRetention,
      maxIntervalDays: preferences.maxIntervalDays,
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
      generation: { status: 'queued', mode: 'chat' },
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

  /**
   * Send an existing draft plan's orchestration prompt into the current
   * conversation. Used when inline generation failed and the user asks the chat
   * to take over, without creating a second plan.
   */
  async promptPlanInChat(
    planId: string,
    sessionId?: string,
  ): Promise<{ prompted: boolean; prompt: string; error?: string }> {
    const plan = await readPlan(this.paths, planId)
    if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
    const manifests = await listManifests(this.paths)
    const selected = plan.materials === undefined || plan.materials.length === 0 ? manifests.map(manifest => manifest.id) : plan.materials
    const chosen = selected
      .map(id => manifests.find(manifest => manifest.id === id))
      .filter((manifest): manifest is MaterialManifest => manifest !== undefined)
    if (chosen.length === 0) throw new StudyError('not-found', '计划的资料都不存在了')
    const prompt = this.goalPrompt(plan, chosen, 'deep')
    if (sessionId === undefined || this.deps.promptSession === undefined) {
      return { prompted: false, prompt }
    }
    try {
      await this.deps.promptSession(sessionId, prompt)
      plan.generation = { status: 'queued', mode: 'chat', updatedAt: new Date().toISOString() }
      await writePlan(this.paths, plan)
      return { prompted: true, prompt }
    } catch (error) {
      return { prompted: false, prompt, error: error instanceof Error ? error.message : String(error) }
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
      const { done } = planProgress(plan)
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
    const bounds = planProgress(plan)
    const pageOf = (target: string): { pageStart: number; pageEnd: number } | null => {
      try {
        const { materialId, unitId } = splitUnitKey(target)
        const node = manifests.find(manifest => manifest.id === materialId)?.structure.find(candidate => candidate.uid === unitId)
        return node === undefined ? null : { pageStart: node.pageStart, pageEnd: node.pageEnd }
      } catch {
        return null
      }
    }
    const attempts = [...(plan.attempts ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1))
    const goalById = new Map([[plan.id, plan.goal]])
    const cards = (await listCards(this.paths))
      .filter(card => card.planId === plan.id)
      .map(card => this.cardView(card, this.today(), goalById))
    return {
      plan: {
        id: plan.id,
        goal: plan.goal,
        status: plan.status,
        ...(plan.budget?.hoursPerWeek === undefined ? {} : { hoursPerWeek: plan.budget.hoursPerWeek }),
        ...(plan.brief === undefined ? {} : { brief: plan.brief }),
        ...(plan.bookId === undefined ? {} : { bookId: plan.bookId }),
        meta: {
          ...(plan.deliverable === undefined ? {} : { deliverable: plan.deliverable }),
          ...(plan.deadline === undefined ? {} : { deadline: plan.deadline }),
          ...(plan.audience === undefined ? {} : { audience: plan.audience }),
          threshold: thresholdOf(plan),
          ...(plan.closedAt === undefined ? {} : { closedAt: plan.closedAt }),
          ...(plan.closureNote === undefined ? {} : { closureNote: plan.closureNote }),
        },
        ...(plan.generation === undefined
          ? {}
          : {
              generation: {
                status: plan.generation.status,
                ...(plan.generation.mode === undefined ? {} : { mode: plan.generation.mode }),
                ...(plan.generation.jobId === undefined ? {} : { jobId: plan.generation.jobId }),
                ...(plan.generation.error === undefined ? {} : { error: plan.generation.error }),
              },
            }),
      },
      steps,
      done: bounds.done,
      total: bounds.total,
      boundary: summarizeBoundary(plan, pageOf),
      attempts,
      stuck: deriveStuckPoints(plan.attempts ?? []),
      sufficiency: plan.sufficiency ?? [],
      gate: gateStatus(plan),
      cards,
    }
  }

  /**
   * Replace the sufficiency questions of one goal.
   *
   * Questions with the same text keep their progress (answers, verdicts, card),
   * so regenerating does not throw away work; removed questions retire their
   * cards.
   */
  async recordQuestions(
    planId: string,
    items: Array<{ q: string; why?: string; ref?: string }>,
  ): Promise<PlanDetailView> {
    const plan = await readPlan(this.paths, planId)
    if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
    const previous = new Map((plan.sufficiency ?? []).map(item => [item.q, item]))
    const next: SufficiencyItem[] = []
    for (const input of items) {
      const q = input.q.trim()
      if (q.length === 0) continue
      const existing = previous.get(q)
      next.push({
        ...(existing ?? {}),
        id: existing?.id ?? `q-${crypto.randomUUID().slice(0, 8)}`,
        q,
        ...(input.why === undefined ? {} : { why: input.why }),
        ...(input.ref === undefined ? {} : { ref: input.ref }),
      })
    }
    if (next.length === 0) throw new StudyError('invalid', '没有可用的判定题')
    const kept = new Set(next.map(item => item.id))
    for (const item of plan.sufficiency ?? []) {
      if (!kept.has(item.id)) await deleteCard(this.paths, judgementCardId(plan.id, item.id))
    }
    plan.sufficiency = next
    await writePlan(this.paths, plan)
    return this.planView(planId)
  }

  /**
   * Write the verdict of one judgement and sync its card.
   *
   * The route owns the model call; this method only records the outcome, so the
   * service never depends on the generation layer.
   */
  async recordJudgement(
    planId: string,
    questionId: string,
    result: {
      answer: string
      verdict: 'pass' | 'partial' | 'fail'
      missing?: string[]
      advice?: string
      judgedBy?: { engine: string; model?: string }
    },
  ): Promise<PlanDetailView> {
    const plan = await readPlan(this.paths, planId)
    if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
    const item = (plan.sufficiency ?? []).find(candidate => candidate.id === questionId)
    if (item === undefined) throw new StudyError('invalid', '判定题不存在')
    const answer = result.answer.trim()
    if (answer.length === 0) throw new StudyError('invalid', '先写下你的答案，再请判定')
    item.answer = answer
    item.verdict = result.verdict
    item.passed = result.verdict === 'pass'
    item.judgedAt = new Date().toISOString()
    delete item.selfPass
    delete item.selfPassReason
    if (result.missing === undefined || result.missing.length === 0) delete item.missing
    else item.missing = result.missing
    if (result.advice === undefined || result.advice.length === 0) delete item.advice
    else item.advice = result.advice
    if (result.judgedBy === undefined) delete item.judgedBy
    else item.judgedBy = result.judgedBy
    await writePlan(this.paths, plan)
    const feedback = [result.advice, ...(result.missing ?? [])].filter(item => item !== undefined && item.length > 0)
    if (result.verdict === 'pass') {
      await deleteCard(this.paths, judgementCardId(plan.id, item.id))
    } else {
      await upsertJudgementCard(this.paths, {
        planId: plan.id,
        questionId: item.id,
        prompt: item.q,
        detail: feedback.length === 0 ? `目标：${plan.goal}` : `目标：${plan.goal}\n\n判定：${result.verdict}\n${feedback.join('\n')}`,
        today: this.today(),
      })
    }
    return this.planView(planId)
  }

  /** Create and validate a plan. */
  async createPlan(input: {
    goal: string
    steps: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string; coverage?: Coverage; skipReason?: string }>
    hoursPerWeek?: number
    id?: string
    deliverable?: string
    deadline?: string
    audience?: string
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
      ...(input.deliverable === undefined || input.deliverable.trim().length === 0 ? {} : { deliverable: input.deliverable.trim() }),
      ...(input.deadline === undefined || input.deadline.trim().length === 0 ? {} : { deadline: input.deadline.trim() }),
      ...(input.audience === undefined || input.audience.trim().length === 0 ? {} : { audience: input.audience.trim() }),
      steps: input.steps.map((step, index) => ({
        n: index + 1,
        kind: step.kind,
        ...(step.target === undefined ? {} : { target: step.target }),
        ...(step.concepts === undefined ? {} : { concepts: step.concepts }),
        ...(step.materials === undefined ? {} : { materials: step.materials }),
        why: step.why,
        done: false,
        ...(step.coverage === undefined ? {} : { coverage: step.coverage }),
        ...(step.skipReason === undefined ? {} : { skipReason: step.skipReason }),
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
    const plan = await readPlan(this.paths, planId)
    if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)

    if (input.setGoal !== undefined) {
      if (input.setGoal.trim().length === 0) throw new StudyError('invalid', '目标不能为空')
      plan.goal = input.setGoal.trim()
    }
    if (input.setStatus !== undefined) {
      plan.status = input.setStatus
      if (input.setStatus === 'active') {
        delete plan.closedAt
        delete plan.closureNote
      }
    }
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
      plan.generation = { status: 'done', updatedAt: new Date().toISOString() }
    }

    if (input.setMeta !== undefined) {
      const meta = input.setMeta
      if ('deliverable' in meta) {
        const value = meta.deliverable?.trim() ?? ''
        if (value.length === 0) delete plan.deliverable
        else plan.deliverable = value
      }
      if ('deadline' in meta) {
        const value = meta.deadline?.trim() ?? ''
        if (value.length === 0) delete plan.deadline
        else plan.deadline = value
      }
      if ('audience' in meta) {
        const value = meta.audience?.trim() ?? ''
        if (value.length === 0) delete plan.audience
        else plan.audience = value
      }
      if (meta.threshold !== undefined) plan.threshold = Math.min(1, Math.max(0, meta.threshold))
    }
    if (input.setCoverage !== undefined) {
      const step = plan.steps.find(candidate => candidate.n === input.setCoverage!.n)
      if (step === undefined) throw new StudyError('invalid', `计划没有第 ${input.setCoverage.n} 步`)
      const reason = input.setCoverage.reason?.trim() ?? ''
      if (input.setCoverage.coverage === 'skip' && reason.length === 0) {
        throw new StudyError('invalid', '标为「不读」时必须写清理由：为什么这段对目标不需要')
      }
      step.coverage = input.setCoverage.coverage
      if (input.setCoverage.coverage === 'skip') step.skipReason = reason
      else delete step.skipReason
    }
    if (input.addAttempt !== undefined) {
      const what = input.addAttempt.what.trim()
      if (what.length === 0) throw new StudyError('invalid', '尝试内容不能为空')
      const stuck = input.addAttempt.stuck?.trim() ?? ''
      const result = input.addAttempt.result?.trim() ?? ''
      const record: AttemptRecord = {
        id: `a-${crypto.randomUUID().slice(0, 8)}`,
        move: input.addAttempt.move,
        what,
        provenance: input.addAttempt.provenance,
        at: new Date().toISOString(),
        ...(stuck.length === 0 ? {} : { stuck }),
        ...(result.length === 0 ? {} : { result }),
      }
      plan.attempts = [...(plan.attempts ?? []), record]
    }
    if (input.removeAttempt !== undefined) {
      plan.attempts = (plan.attempts ?? []).filter(attempt => attempt.id !== input.removeAttempt)
    }
    if (input.replaceSufficiency !== undefined) {
      const previous = new Map((plan.sufficiency ?? []).map(item => [item.q, item]))
      const next: SufficiencyItem[] = []
      for (const item of input.replaceSufficiency) {
        const q = item.q.trim()
        if (q.length === 0) continue
        const existing = previous.get(q)
        const passed = item.passed ?? existing?.passed
        next.push({
          ...(existing ?? {}),
          id: existing?.id ?? `q-${crypto.randomUUID().slice(0, 8)}`,
          q,
          ...(passed === undefined ? {} : { passed }),
        })
      }
      const kept = new Set(next.map(item => item.id))
      for (const item of plan.sufficiency ?? []) {
        if (!kept.has(item.id)) await deleteCard(this.paths, judgementCardId(plan.id, item.id))
      }
      plan.sufficiency = next
    }
    if (input.toggleSufficiency !== undefined) {
      const item = (plan.sufficiency ?? []).find(candidate => candidate.id === input.toggleSufficiency!.id)
      if (item === undefined) throw new StudyError('invalid', '判定题不存在')
      const passed = input.toggleSufficiency.passed
      const reason = input.toggleSufficiency.reason?.trim() ?? ''
      const answer = input.toggleSufficiency.answer?.trim() ?? ''
      if (answer.length > 0) item.answer = answer
      // Manual control is the self-evaluation path: it only applies when there is
      // no verdict, or when the user overrules one with a written reason.
      if (passed && item.verdict !== undefined && item.verdict !== 'pass') {
        if (reason.length === 0) {
          throw new StudyError('invalid', '要推翻判定结果，必须写清为什么你认为已经达到标准')
        }
        item.selfPass = true
        item.selfPassReason = reason
      } else if (passed) {
        delete item.selfPassReason
        if (item.verdict === undefined) item.selfPass = true
      } else {
        delete item.selfPass
        delete item.selfPassReason
      }
      item.passed = passed
      // A failed question is the only thing that writes a review card; a passed
      // one retires it. That is what keeps the queue from growing on its own.
      if (item.passed) {
        await deleteCard(this.paths, judgementCardId(plan.id, item.id))
      } else {
        await upsertJudgementCard(this.paths, {
          planId: plan.id,
          questionId: item.id,
          prompt: item.q,
          detail: `目标：${plan.goal}`,
          today: this.today(),
        })
      }
    }

    const [manifests, concepts] = await Promise.all([listManifests(this.paths), listConcepts(this.paths)])
    const issues = validatePlan(plan, this.planTargets(manifests, concepts))
    if (issues.length > 0) throw new StudyError('invalid', '计划未通过校验', { issues })
    await writePlan(this.paths, plan)
    return this.planView(planId)
  }

  /**
   * Close one goal once the closure gate passes (docs/POSITIONING.md §4).
   *
   * Closing is the product's core action: the ranges, the attempts and the
   * reviews stop asking for anything. A goal that does not pass the gate can
   * only be paused, never completed.
   */
  async closePlan(planId: string, note?: string): Promise<PlanDetailView> {
    const plan = await readPlan(this.paths, planId)
    if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
    const gate = gateStatus(plan)
    if (!gate.ready) throw new StudyError('invalid', '结案门未通过', { issues: gate.reasons })
    plan.status = 'done'
    plan.closedAt = new Date().toISOString()
    const reason = note?.trim() ?? ''
    if (reason.length === 0) delete plan.closureNote
    else plan.closureNote = reason
    await writePlan(this.paths, plan)
    // Closing means nothing comes back: the goal's cards leave the queue.
    await retirePlanCards(this.paths, plan.id)
    return this.planView(planId)
  }

  /** Patch the generation status shown while a plan is still a draft. */
  async setPlanGeneration(planId: string, generation: PlanGeneration): Promise<void> {
    const plan = await readPlan(this.paths, planId)
    if (plan === null) return
    plan.generation = { ...generation, updatedAt: new Date().toISOString() }
    await writePlan(this.paths, plan)
  }

  /** Resolve one card for the panel. */
  private cardView(card: CardRecord, today: string, goalById: ReadonlyMap<string, string>): CardView {
    const goal = card.planId === undefined ? undefined : goalById.get(card.planId)
    return {
      id: card.id,
      kind: card.kind,
      ...(card.planId === undefined ? {} : { planId: card.planId }),
      ...(goal === undefined ? {} : { goal }),
      prompt: card.prompt,
      ...(card.detail === undefined ? {} : { detail: card.detail }),
      due: card.due ?? today,
      overdueDays: overdueDays(card.due, today),
      reps: card.srs.reps,
      ...(card.srs.lastRating === undefined ? {} : { lastRating: card.srs.lastRating }),
    }
  }

  /** Cards due today or earlier, most overdue first. */
  async dueCardList(date = this.today()): Promise<CardView[]> {
    const [cards, plans] = await Promise.all([listCards(this.paths), listPlans(this.paths)])
    const goalById = new Map(plans.map(plan => [plan.id, plan.goal]))
    return dueCards(cards, date).map(card => this.cardView(card, date, goalById))
  }

  /** Record one rating on a card and return its next due date. */
  async reviewCard(cardId: string, rating: Rating): Promise<{ card: CardView; due: string }> {
    const preferences = await this.preferences()
    const today = this.today()
    const card = await reviewCardOnce(this.paths, cardId, {
      rating,
      today,
      targetRetention: preferences.targetRetention,
      maxIntervalDays: preferences.maxIntervalDays,
    })
    const plans = await listPlans(this.paths)
    const goalById = new Map(plans.map(plan => [plan.id, plan.goal]))
    return { card: this.cardView(card, today, goalById), due: card.due ?? today }
  }

  /** Resolve one plan step into human labels. */
  private stepView(
    step: PlanStep,
    manifests: readonly MaterialManifest[],
    conceptById: ReadonlyMap<string, { id: string; name: string }>,
    progress: ProgressFile,
  ): PlanStepView {
    const view: PlanStepView = {
      n: step.n,
      kind: step.kind,
      why: step.why,
      done: step.done,
      coverage: coverageOf(step),
      ...(step.skipReason === undefined ? {} : { skipReason: step.skipReason }),
    }
    if (step.target !== undefined) {
      try {
        const { materialId, unitId } = splitUnitKey(step.target)
        const manifest = manifests.find(candidate => candidate.id === materialId)
        const node = manifest?.structure.find(candidate => candidate.uid === unitId)
        if (manifest !== undefined && node !== undefined) {
          view.target = {
            materialId,
            unitId,
            title: node.title,
            materialTitle: manifest.title,
            pageStart: node.pageStart,
            pageEnd: node.pageEnd,
          }
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
    const previous = await readJson<UnitMetaFile | null>(this.paths.unitMetaFile(materialId, unitId), null)
    const meta: UnitMetaFile = {
      version: 1,
      material: materialId,
      unit: unitId,
      title: node.title,
      concepts: input.concepts.map(concept => concept.id),
      pageRefs: [...new Set(input.pageRefs)].sort((a, b) => a - b),
      generatedBy: { at: now, promptVersion: 'v1' },
      ...(previous?.insights === undefined ? {} : { insights: previous.insights }),
      ...(previous?.extras === undefined ? {} : { extras: previous.extras }),
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

  /** Record one insight id on a unit's metadata. */
  async attachInsights(materialId: string, unitId: string, insightIds: readonly string[]): Promise<void> {
    const manifest = await this.manifest(materialId)
    structureNodeOf(manifest, unitId)
    const meta = await readJson<UnitMetaFile | null>(this.paths.unitMetaFile(materialId, unitId), null)
    if (meta === null) return
    meta.insights = [...new Set([...(meta.insights ?? []), ...insightIds])]
    await writeJsonAtomic(this.paths.unitMetaFile(materialId, unitId), meta)
  }

  /** The quiz bank of one unit, when it exists. */
  async quiz(materialId: string, unitId: string): Promise<QuizBank | null> {
    const manifest = await this.manifest(materialId)
    structureNodeOf(manifest, unitId)
    return readJson<QuizBank | null>(this.paths.quizFile(materialId, unitId), null)
  }

  /** Validate and write a generated quiz bank. */
  async writeQuiz(materialId: string, unitId: string, items: readonly QuizItem[]): Promise<QuizBank> {
    const manifest = await this.manifest(materialId)
    const node = structureNodeOf(manifest, unitId)
    const issues = validateQuizBank(items, { pageStart: node.pageStart, pageEnd: node.pageEnd })
    if (issues.length > 0) throw new StudyError('invalid', '练习题未通过校验', { issues })
    const bank: QuizBank = {
      version: 1,
      unit: unitId,
      items: items.map(item => ({ ...item })),
      updatedAt: new Date().toISOString(),
    }
    await writeJsonAtomic(this.paths.quizFile(materialId, unitId), bank)
    return bank
  }

  /**
   * Write one unit's semantic blocks.
   *
   * Blocks are the reading surface: nothing here is progress, so this method
   * never touches progress.json and the closure gate never asks what was read.
   * Page spans are derived from the paragraph boxes, never taken from the model.
   */
  async writeBlocks(materialId: string, unitId: string, blocks: readonly BlockInput[]): Promise<BlockFile> {
    const manifest = await this.manifest(materialId)
    const node = structureNodeOf(manifest, unitId)
    const paragraphs = await this.layout(materialId, node.pageStart, node.pageEnd)
    if (paragraphs.length === 0) {
      throw new StudyError('invalid', '这一节抽取不到文字层，不能按段落分块')
    }
    const cleaned: BlockInput[] = blocks.map(block => ({
      id: block.id.trim(),
      startPara: block.startPara,
      endPara: block.endPara,
      title: block.title.replace(/\s+/gu, ' ').trim(),
      ...(block.prompt === undefined
        ? {}
        : {
            prompt: {
              kind: block.prompt.kind,
              transition: block.prompt.transition.replace(/\s+/gu, ' ').trim(),
              question: block.prompt.question.replace(/\s+/gu, ' ').trim(),
            },
          }),
    }))
    const issues = validateBlocks(cleaned, { paragraphs: paragraphs.length })
    if (issues.length > 0) throw new StudyError('invalid', '引导卡未通过校验', { issues })

    const records: BlockRecord[] = []
    for (const block of cleaned) {
      const first = paragraphs[block.startPara]
      const last = paragraphs[block.endPara]
      if (first === undefined || last === undefined) {
        throw new StudyError('invalid', `第 ${block.id} 块的段落超出范围`)
      }
      records.push({ ...block, startPage: first.page, endPage: last.page })
    }

    const file: BlockFile = {
      version: 2,
      unit: unitId,
      paragraphs: paragraphs.length,
      blocks: records,
      generatedAt: new Date().toISOString(),
    }
    await writeJsonAtomic(this.paths.blocksFile(materialId, unitId), file)
    return file
  }

  /**
   * Paragraph geometry of a page range, cached per page on disk.
   *
   * Extraction is the expensive part (a PDF open plus one text pass per page),
   * so each page is laid out once and then served from `materials/<mid>/layout`.
   * Indices are unit-local and ordered page by page, which is what blocks quote.
   */
  async layout(materialId: string, from: number, to: number): Promise<ParagraphRecord[]> {
    const manifest = await this.manifest(materialId)
    const first = Math.max(1, Math.min(from, to))
    const last = Math.min(manifest.source.pages, Math.max(from, to))
    if (last < first) return []

    const pages: number[] = []
    for (let page = first; page <= last; page += 1) pages.push(page)

    const loaded = new Map<number, PageLayoutFile>()
    const missing: number[] = []
    for (const page of pages) {
      const file = await readJson<PageLayoutFile | null>(this.paths.layoutFile(materialId, page), null)
      if (file === null || file.version !== 1) missing.push(page)
      else loaded.set(page, file)
    }
    if (missing.length > 0) {
      const bytes = await readFile(this.paths.sourceFile(materialId, manifest.source.path))
      const extracted = await extractLayouts(new Uint8Array(bytes), missing)
      for (const page of extracted) {
        const file: PageLayoutFile = {
          version: 1,
          page: page.page,
          width: page.width,
          height: page.height,
          paragraphs: page.paragraphs,
        }
        await writeJsonAtomic(this.paths.layoutFile(materialId, page.page), file)
        loaded.set(page.page, file)
      }
    }

    const out: ParagraphRecord[] = []
    for (const page of pages) {
      const file = loaded.get(page)
      if (file === undefined) continue
      for (const paragraph of file.paragraphs) {
        out.push({
          index: out.length,
          page,
          x: paragraph.x,
          y: paragraph.y,
          w: paragraph.w,
          h: paragraph.h,
          text: paragraph.text,
        })
      }
    }
    return out
  }

  /**
   * Fold one block into the previous one.
   *
   * The only correction the reading surface allows: when自动分块 put a boundary
   * in the wrong place, merging is enough. Splitting or editing cards would
   * turn the rail into a content editor (POSITIONING §3 阅读面).
   */
  async mergeBlock(materialId: string, unitId: string, blockId: string): Promise<BlockFile> {
    const file = await readJson<BlockFile | null>(this.paths.blocksFile(materialId, unitId), null)
    if (file === null) throw new StudyError('not-found', '这一节还没有生成引导')
    const index = file.blocks.findIndex(block => block.id === blockId)
    if (index < 0) throw new StudyError('not-found', `找不到这一块：${blockId}`)
    if (index === 0) throw new StudyError('invalid', '第一块没有上一块可并')
    const asInput = (block: BlockRecord): BlockInput => ({
      id: block.id,
      startPara: block.startPara,
      endPara: block.endPara,
      title: block.title,
      ...(block.prompt === undefined ? {} : { prompt: block.prompt }),
    })
    const previous = file.blocks[index - 1]!
    const current = file.blocks[index]!
    const merged: BlockInput = {
      ...asInput(previous),
      endPara: current.endPara,
      ...(previous.prompt === undefined && current.prompt !== undefined ? { prompt: current.prompt } : {}),
    }
    return this.writeBlocks(materialId, unitId, [
      ...file.blocks.slice(0, index - 1).map(asInput),
      merged,
      ...file.blocks.slice(index + 1).map(asInput),
    ])
  }

  /** Grade a quiz submission and fold the objective results into concept mastery. */
  async submitQuiz(
    materialId: string,
    unitId: string,
    answers: ReadonlyArray<{ itemId: string; answer: unknown }>,
  ): Promise<QuizSubmitView> {
    const bank = await this.quiz(materialId, unitId)
    if (bank === null) throw new StudyError('not-found', '这一节还没有练习题，先让 AI 生成一组')
    const byId = new Map(bank.items.map(item => [item.id, item]))
    const attempts: Array<{ conceptId: string; correct: boolean }> = []
    const rows: QuizSubmitView['attempts'] = []
    let objective = 0
    let correct = 0
    for (const answer of answers) {
      const item = byId.get(answer.itemId)
      if (item === undefined) continue
      const verdict = gradeQuizItem(item, answer.answer)
      const expected =
        item.type === 'choice' && item.answerIndex !== undefined
          ? item.choices?.[item.answerIndex]
          : item.type === 'cloze'
            ? item.answer
            : item.type === 'evidence' && item.page !== undefined
              ? `p${item.page}`
              : undefined
      rows.push({
        itemId: item.id,
        correct: verdict.correct,
        ...(expected === undefined ? {} : { expected }),
      })
      if (verdict.correct !== null) {
        objective += 1
        if (verdict.correct) correct += 1
        for (const conceptId of item.concepts) attempts.push({ conceptId, correct: verdict.correct })
      }
    }
    if (attempts.length > 0) await recordAttempts(this.paths, attempts)
    const score = objective === 0 ? 0.5 : correct / objective
    return { score, ratingSuggestion: ratingFromScore(score), attempts: rows }
  }

  /** Hide or restore a material on the shelf. */
  async archiveMaterial(materialId: string, archived: boolean): Promise<MaterialManifest> {
    const manifest = await this.manifest(materialId)
    manifest.archived = archived
    await writeManifest(this.paths, manifest)
    return manifest
  }

  /** Delete one plan file. */
  async deletePlan(planId: string): Promise<{ deleted: boolean }> {
    const plan = await readPlan(this.paths, planId)
    if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
    return { deleted: await removePlanFile(this.paths, planId) }
  }

  /**
   * Delete one material and its derived data.
   *
   * The material directory is removed first, then concept occurrences,
   * insights and progress entries that point at it are cleaned so the library
   * does not keep phantom cards or broken source links.
   */
  async deleteMaterial(materialId: string): Promise<{ deleted: boolean }> {
    await this.manifest(materialId)
    await rm(this.paths.materialDir(materialId), { recursive: true, force: true })

    const removedConcepts = new Set<string>()
    for (const concept of await listConcepts(this.paths)) {
      const next = concept.occurrences.filter(occurrence => occurrence.material !== materialId)
      if (next.length === concept.occurrences.length) continue
      if (next.length === 0) {
        removedConcepts.add(concept.id)
        await unlink(this.paths.conceptFile(concept.id)).catch(() => undefined)
      } else {
        concept.occurrences = next
        await writeConcept(this.paths, concept)
      }
    }

    for (const insight of await listInsights(this.paths)) {
      const next = insight.sources.filter(source => source.material !== materialId)
      if (next.length === insight.sources.length) continue
      if (next.length === 0) {
        await deleteInsight(this.paths, insight.id)
      } else {
        insight.sources = next
        await writeInsight(this.paths, insight)
      }
    }

    await updateJson<ProgressFile>(this.paths.progressFile, emptyProgress(), current => {
      let changed = false
      for (const key of Object.keys(current.units)) {
        if (key.startsWith(`${materialId}:`)) {
          delete current.units[key]
          changed = true
        }
      }
      for (const conceptId of removedConcepts) {
        if (current.concepts[conceptId] !== undefined) {
          delete current.concepts[conceptId]
          changed = true
        }
      }
      if (!changed) return current
      current.revision += 1
      current.updatedAt = new Date().toISOString()
      return current
    })

    return { deleted: true }
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
      ...(manifest.archived === true ? { archived: true } : {}),
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
