/**
 * Goal operations: plans, cutting boundaries, attempts, judgement and closure.
 *
 * Free functions over StudyService. The class in ../service.ts keeps the signatures and
 * forwards here, so routes, tools and tests keep talking to the service object.
 */
import { readdir, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { slugify, splitUnitKey, uniqueSlug } from '../../core/ids.ts'
import { listManifests } from '../../core/library.ts'
import { listConcepts } from '../../core/concepts.ts'
import {
  decayedMastery,
  ensureKnowledge,
  retentionSafe,
  thresholdForLevel,
  type KnowledgeFile,
} from '../../core/knowledge.ts'
import { deletePlan as removePlanFile, goalSections, listPlans, nextStep as nextPlanStep, readPlan, validatePlan, writePlan } from '../../core/plans.ts'
import { planProgress, summarizeBoundary, thresholdOf } from '../../core/planGate.ts'
import { hash32 } from '../../core/srs.ts'

import { readJson } from '../../core/store.ts'
import type { LibraryPaths } from '../../core/paths.ts'
import type { AttemptMove, AttemptRecord, Coverage, MasteryLevel, MaterialManifest, PlanGeneration, PlanRecord, PlanStep, PlanStepKind, Provenance, QuizSession, UnitMetaFile } from '../../core/types.ts'
import type { PlanDetailView, PlanSectionView, PlanSummary } from '../../core/views.ts'
import { goalPrompt } from '../service/prompts.ts'
import { planTargets, stepView } from '../service/views.ts'
import { StudyError } from './error.ts'
import type { StudyService } from '../service.ts'

/** One goal at a time: creation is refused while any plan is still open. */
function assertSingleGoal(plans: readonly PlanRecord[]): void {
  const open = plans.find(plan => plan.status !== 'done')
  if (open === undefined) return
  throw new StudyError('conflict', `目前已有目标「${open.goal}」，一个书桌同时只跑一个；先结案或删掉它再加新的`)
}

export async function createGoal(svc: StudyService, input: {
  goal: string
  brief?: string
  materials: readonly string[]
  hoursPerWeek?: number
  depth?: 'deep' | 'overview'
  sessionId?: string
  deliverable?: string
  deadline?: string
  audience?: string
}): Promise<{ planId: string; prompted: boolean; error?: string; prompt: string }> {
  const goal = input.goal.trim()
  if (goal.length === 0) throw new StudyError('invalid', '目标不能为空')
  if (input.materials.length === 0) throw new StudyError('invalid', '至少选择一份资料')
  const manifests = await listManifests(svc.paths)
  const chosen = input.materials.map(id => {
    const manifest = manifests.find(candidate => candidate.id === id)
    if (manifest === undefined) throw new StudyError('not-found', `资料不存在：${id}`)
    return manifest
  })

  const plans = await listPlans(svc.paths)
  assertSingleGoal(plans)
  const planId = uniqueSlug(slugify(goal, `g-${hash32(goal).toString(36)}`), new Set(plans.map(plan => plan.id)))
  const now = new Date().toISOString()
  const plan: PlanRecord = {
    id: planId,
    goal,
    status: 'draft',
    ...(input.brief === undefined || input.brief.trim().length === 0 ? {} : { brief: input.brief.trim() }),
    materials: [...input.materials],
    ...(input.hoursPerWeek === undefined ? {} : { budget: { hoursPerWeek: input.hoursPerWeek } }),
    ...(input.deliverable === undefined || input.deliverable.trim().length === 0 ? {} : { deliverable: input.deliverable.trim() }),
    ...(input.deadline === undefined || input.deadline.trim().length === 0 ? {} : { deadline: input.deadline.trim() }),
    ...(input.audience === undefined || input.audience.trim().length === 0 ? {} : { audience: input.audience.trim() }),
    steps: [],
    generation: { status: 'queued', mode: 'chat' },
    createdAt: now,
    updatedAt: now,
  }
  await writePlan(svc.paths, plan)

  const prompt = goalPrompt(plan, chosen, input.depth ?? 'deep')
  if (input.sessionId === undefined || svc.deps.promptSession === undefined) {
    return { planId, prompted: false, prompt }
  }
  try {
    await svc.deps.promptSession(input.sessionId, prompt)
    return { planId, prompted: true, prompt }
  } catch (error) {
    return { planId, prompted: false, error: error instanceof Error ? error.message : String(error), prompt }
  }
}

export async function promptPlanInChat(svc: StudyService, 
  planId: string,
  sessionId?: string,
  ): Promise<{ prompted: boolean; prompt: string; error?: string }> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  const manifests = await listManifests(svc.paths)
  const selected = plan.materials === undefined || plan.materials.length === 0 ? manifests.map(manifest => manifest.id) : plan.materials
  const chosen = selected
    .map(id => manifests.find(manifest => manifest.id === id))
    .filter((manifest): manifest is MaterialManifest => manifest !== undefined)
  if (chosen.length === 0) throw new StudyError('not-found', '计划的资料都不存在了')
  const prompt = goalPrompt(plan, chosen, 'deep')
  if (sessionId === undefined || svc.deps.promptSession === undefined) {
    return { prompted: false, prompt }
  }
  try {
    await svc.deps.promptSession(sessionId, prompt)
    plan.generation = { status: 'queued', mode: 'chat', updatedAt: new Date().toISOString() }
    await writePlan(svc.paths, plan)
    return { prompted: true, prompt }
  } catch (error) {
    return { prompted: false, prompt, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function planList(svc: StudyService): Promise<PlanSummary[]> {
  const [plans, manifests, knowledge] = await Promise.all([
    listPlans(svc.paths),
    listManifests(svc.paths),
    ensureKnowledge(svc.paths),
  ])
  const byId = new Map(manifests.map(manifest => [manifest.id, manifest]))
  const today = svc.today()
  const summaries: PlanSummary[] = []
  for (const plan of plans) {
    const learnedForPlan = learnedTargets((await goalConceptLevels(svc, plan)).sections, knowledge, today)
    const { done } = planProgress(plan, learnedSteps(learnedForPlan))
    const step = nextPlanStep(plan, learnedSteps(learnedForPlan))
    let next: string | undefined
    if (step?.target !== undefined) {
      try {
        const { materialId, unitId } = splitUnitKey(step.target)
        next = byId.get(materialId)?.structure.find(node => node.uid === unitId)?.title
      } catch {
        next = undefined
      }
    }
    summaries.push({
      id: plan.id,
      goal: plan.goal,
      status: plan.status,
      done,
      total: plan.steps.length,
      ...(next === undefined ? {} : { next }),
    })
  }
  return summaries
}

/**
 * The sections a goal requires and the concepts they carry.
 *
 * A goal owns no concept list: concepts live on the section
 * (`units/<uid>/meta.json`), so adding one there makes every goal that reads
 * that section see it. The goal only decides how deep each section goes.
 */
export async function goalConceptLevels(
  svc: StudyService,
  plan: PlanRecord,
): Promise<{
  levels: Map<string, MasteryLevel>
  sections: Array<{ target: string; level: MasteryLevel; concepts: string[] }>
  /** Required sections that carry no knowledge points yet, in route order. */
  missing: Array<{ target: string; title: string; level: MasteryLevel }>
}> {
  const manifests = await listManifests(svc.paths)
  const levels = new Map<string, MasteryLevel>()
  const sections: Array<{ target: string; level: MasteryLevel; concepts: string[] }> = []
  const missing: Array<{ target: string; title: string; level: MasteryLevel }> = []
  for (const section of goalSections(plan)) {
    let concepts: string[] = []
    let title = section.target
    try {
      const { materialId, unitId } = splitUnitKey(section.target)
      const node = manifests
        .find(manifest => manifest.id === materialId)
        ?.structure.find(candidate => candidate.uid === unitId)
      if (node === undefined) continue
      title = node.title
      const meta = await readJson<UnitMetaFile | null>(svc.paths.unitMetaFile(materialId, unitId), null)
      concepts = meta?.concepts ?? []
    } catch {
      continue
    }
    if (concepts.length === 0) missing.push({ target: section.target, title, level: section.level })
    sections.push({ target: section.target, level: section.level, concepts })
    for (const conceptId of concepts) {
      const existing = levels.get(conceptId)
      if (existing === undefined || section.level > existing) levels.set(conceptId, section.level)
    }
  }
  return { levels, sections, missing }
}

/**
 * Targets whose knowledge points all reached that section's threshold.
 *
 * A section is done exactly when this set contains it: there is no manual tick
 * any more, so the ledger alone decides both completion and the next pointer.
 */
export function learnedTargets(
  sections: ReadonlyArray<{ target: string; level: MasteryLevel; concepts: string[] }>,
  knowledge: KnowledgeFile,
  today: string,
): Set<string> {
  const out = new Set<string>()
  for (const section of sections) {
    if (section.concepts.length === 0) continue
    const threshold = thresholdForLevel(section.level)
    const learned = section.concepts.every(conceptId => {
      const state = knowledge.concepts[conceptId]
      return state !== undefined && decayedMastery(state, today) >= threshold
    })
    if (learned) out.add(section.target)
  }
  return out
}

/** `nextStep` predicate over the targets `learnedTargets` returned. */
export function learnedSteps(learned: ReadonlySet<string>): (step: PlanStep) => boolean {
  return step => step.target !== undefined && learned.has(step.target)
}

/**
 * What still blocks closing this goal, from the knowledge space.
 *
 * A goal closes when every concept of every required section is at that
 * section's level threshold and would be remembered past the deadline.
 */
export async function goalProgressOf(
  svc: StudyService,
  plan: PlanRecord,
): Promise<{ passed: number; total: number; missingSections: number; ready: boolean; reasons: string[] }> {
  const reasons: string[] = []
  if ((plan.deliverable ?? '').trim().length === 0) {
    reasons.push('缺少交付物：先写清这次要交出什么')
  }
  if ((plan.deadline ?? '').trim().length === 0) {
    reasons.push('缺少期限：它决定什么时候算完成')
  }
  const { levels, missing } = await goalConceptLevels(svc, plan)
  // A required section without knowledge points is invisible to the ledger;
  // naming it is what stops a goal from closing while half of it was never
  // measured.
  for (const section of missing.slice(0, 3)) {
    reasons.push(`「${section.title}」还没有知识点：先在目标页补上，否则结案会漏掉这一节`)
  }
  if (missing.length > 3) reasons.push(`还有 ${missing.length - 3} 节没有知识点`)
  if (levels.size === 0) {
    if (missing.length === 0) reasons.push('目标里的节还没有知识点：先练一节，知识点会挂到那一节上')
    return { passed: 0, total: 0, missingSections: missing.length, ready: false, reasons }
  }
  const knowledge = await ensureKnowledge(svc.paths)
  const today = svc.today()
  const deadline = plan.deadline
  let passed = 0
  let behind = 0
  let toReview = 0
  for (const [conceptId, level] of levels) {
    const state = knowledge.concepts[conceptId]
    const threshold = thresholdForLevel(level)
    const now = state === undefined ? 0 : decayedMastery(state, today)
    if (now < threshold) {
      behind += 1
      continue
    }
    passed += 1
    // At target today but not yet safe: the decay would drop it before the
    // deadline. This is the only reason a fully-passed goal waits.
    if (deadline !== undefined && !retentionSafe(state, threshold, deadline, today)) toReview += 1
  }
  if (behind > 0) reasons.push(`知识点 ${passed}/${levels.size}：还有 ${behind} 个没到档位`)
  if (deadline !== undefined && today < deadline && toReview > 0) {
    reasons.push(`还有 ${toReview} 个知识点会在期限前掉档：复习一次，把下一次到期排到期限之后`)
  }
  return { passed, total: levels.size, missingSections: missing.length, ready: reasons.length === 0, reasons }
}

export async function planView(svc: StudyService, planId: string): Promise<PlanDetailView> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  const [manifests, concepts, knowledge] = await Promise.all([
    listManifests(svc.paths),
    listConcepts(svc.paths),
    ensureKnowledge(svc.paths),
  ])
  const today = svc.today()
  const conceptById = new Map(concepts.map(concept => [concept.id, concept]))
  const masteryOf = (conceptId: string): number => {
    const state = knowledge.concepts[conceptId]
    return state === undefined ? 0.5 : decayedMastery(state, today)
  }
  const { sections } = await goalConceptLevels(svc, plan)
  const sectionViews: PlanSectionView[] = sections.map(section => {
    const threshold = thresholdForLevel(section.level)
    const conceptStates = section.concepts.map(id => {
      const mastery = masteryOf(id)
      return {
        id,
        name: conceptById.get(id)?.name ?? id,
        mastery,
        threshold,
        atTarget: mastery >= threshold,
      }
    })
    const weakest = conceptStates.length === 0 ? 0 : Math.min(...conceptStates.map(state => state.mastery))
    const peaks = section.concepts
      .map(id => knowledge.concepts[id]?.peak)
      .filter((value): value is number => typeof value === 'number')
    const peak = peaks.length === 0 ? undefined : Math.min(...peaks)
    const { materialId, unitId } = splitUnitKey(section.target)
    const title = manifests
      .find(manifest => manifest.id === materialId)
      ?.structure.find(node => node.uid === unitId)?.title ?? section.target
    return {
      target: section.target,
      title,
      level: section.level,
      threshold,
      concepts: [...section.concepts],
      mastery: weakest,
      ...(peak === undefined ? {} : { peak }),
      atTarget: conceptStates.length > 0 && conceptStates.every(state => state.atTarget),
      conceptStates,
    }
  })
  // Completion and the next pointer both read the ledger: a section is done
  // when its knowledge points reach their threshold, with no manual tick.
  const learned = learnedTargets(
    sectionViews.map(section => ({ target: section.target, level: section.level, concepts: section.concepts })),
    knowledge,
    today,
  )
  const currentN = nextPlanStep(plan, learnedSteps(learned))?.n
  const steps = plan.steps.map(step => {
    const view = stepView(step, manifests, conceptById, masteryOf, learned)
    if (step.n === currentN) view.current = true
    if (view.target !== undefined) {
      const target = `${view.target.materialId}:${view.target.unitId}`
      const section = sectionViews.find(candidate => candidate.target === target)
      if (section !== undefined) {
        // A section without points has nothing to show as a ratio; the knowledge
        // block below names the gap instead of printing "0/0".
        if (section.conceptStates.length > 0) {
          view.progress = {
            passed: section.conceptStates.filter(state => state.atTarget).length,
            total: section.conceptStates.length,
            mastery: section.mastery,
          }
        }
        view.level = section.level
      }
    }
    return view
  })
  const bounds = planProgress(plan, learnedSteps(learned))
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
    sections: sectionViews,
    goalProgress: await goalProgressOf(svc, plan),
  }
}

export async function createPlan(svc: StudyService, input: {
  goal: string
  steps: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string; coverage?: Coverage; skipReason?: string; level?: MasteryLevel }>
  hoursPerWeek?: number
  id?: string
  deliverable?: string
  deadline?: string
  audience?: string
}): Promise<PlanDetailView> {
  const [manifests, concepts, plans] = await Promise.all([
    listManifests(svc.paths),
    listConcepts(svc.paths),
    listPlans(svc.paths),
  ])
  const taken = new Set(plans.map(plan => plan.id))
  assertSingleGoal(plans)
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
      ...(step.coverage === undefined ? {} : { coverage: step.coverage }),
      ...(step.coverage === 'skip' ? { skipReason: step.why } : {}),
      ...(step.level === undefined ? {} : { level: step.level }),
      why: step.why,
      ...(step.skipReason === undefined ? {} : { skipReason: step.skipReason }),
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const issues = validatePlan(plan, planTargets(manifests, concepts))
  if (issues.length > 0) throw new StudyError('invalid', '计划未通过校验', { issues })
  await writePlan(svc.paths, plan)
  return svc.planView(plan.id)
}

export async function updatePlan(svc: StudyService, 
  planId: string,
  input: {
    setStatus?: 'active' | 'paused' | 'done'
    setGoal?: string
    replaceSteps?: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; coverage?: Coverage; why: string; level?: MasteryLevel }>
    /** Depth required of one step's section. */
    setLevel?: { n: number; level: MasteryLevel }
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
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  const [manifests, concepts] = await Promise.all([listManifests(svc.paths), listConcepts(svc.paths)])
  const targets = planTargets(manifests, concepts)

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
  if (input.replaceSteps !== undefined) {
    if (plan.steps.length === 0 && plan.status === 'draft') plan.status = 'active'
    plan.steps = input.replaceSteps.map((step, index) => ({
      n: index + 1,
      kind: step.kind,
      ...(step.target === undefined ? {} : { target: step.target }),
      ...(step.concepts === undefined ? {} : { concepts: step.concepts }),
      ...(step.materials === undefined ? {} : { materials: step.materials }),
      ...(step.coverage === undefined ? {} : { coverage: step.coverage }),
      ...(step.coverage === 'skip' ? { skipReason: step.why } : {}),
      ...(step.level === undefined ? {} : { level: step.level }),
      why: step.why,
    }))
    plan.generation = { status: 'done', updatedAt: new Date().toISOString() }
  }
  if (input.setLevel !== undefined) {
    const step = plan.steps.find(candidate => candidate.n === input.setLevel!.n)
    if (step === undefined) throw new StudyError('invalid', `计划没有第 ${input.setLevel.n} 步`)
    step.level = input.setLevel.level
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
  const issues = validatePlan(plan, targets)
  if (issues.length > 0) throw new StudyError('invalid', '计划未通过校验', { issues })
  await writePlan(svc.paths, plan)
  return svc.planView(planId)
}

export async function closePlan(svc: StudyService, planId: string, note?: string): Promise<PlanDetailView> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  const progress = await goalProgressOf(svc, plan)
  if (!progress.ready) throw new StudyError('invalid', '结案门未通过', { issues: progress.reasons })
  plan.status = 'done'
  plan.closedAt = new Date().toISOString()
  const reason = note?.trim() ?? ''
  if (reason.length === 0) delete plan.closureNote
  else plan.closureNote = reason
  await writePlan(svc.paths, plan)
  return svc.planView(planId)
}

export async function setPlanGeneration(svc: StudyService, planId: string, generation: PlanGeneration): Promise<void> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) return
  plan.generation = { ...generation, updatedAt: new Date().toISOString() }
  await writePlan(svc.paths, plan)
}

/**
 * Delete a goal and everything it produced.
 *
 * Closing a goal keeps every trace; deleting does not. Its practice sessions
 * (they own the questions written per round) and the book it generated go with
 * it. The material, its unit banks and the
 * knowledge ledger stay: those belong to the library and to the reader, not to
 * one goal.
 */
export async function deletePlan(
  svc: StudyService,
  planId: string,
): Promise<{ deleted: boolean; sessions: number; books: number }> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  const sessions = await deletePlanSessions(svc.paths, planId)
  const books = plan.bookId === undefined ? 0 : await deleteBookDir(svc.paths, plan.bookId)
  const deleted = await removePlanFile(svc.paths, planId)
  return { deleted, sessions, books }
}

/** Practice sessions opened for one goal; a unit session is left alone. */
async function deletePlanSessions(paths: LibraryPaths, planId: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(paths.quizSessionsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let removed = 0
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const file = join(paths.quizSessionsDir, entry)
    // One unreadable session must not block the delete.
    const session = await readJson<QuizSession | null>(file, null).catch(() => null)
    // Plan-scoped practice is gone; only session files written before the removal
    // carry this scope, and deleting a goal still has to remove them.
    const legacy = session?.scope as { kind: string; plan?: string } | undefined
    if (legacy?.kind !== 'plan' || legacy.plan !== planId) continue
    await unlink(file)
    removed += 1
  }
  return removed
}

/** The book generated from this goal, when one exists. */
async function deleteBookDir(paths: LibraryPaths, bookId: string): Promise<number> {
  const book = await readJson<{ id: string } | null>(paths.bookFile(bookId), null).catch(() => null)
  if (book === null) return 0
  await rm(paths.bookDir(bookId), { recursive: true, force: true })
  return 1
}
