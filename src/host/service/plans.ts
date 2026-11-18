/**
 * Goal operations: plans, cutting boundaries, attempts, judgement and closure.
 *
 * Free functions over StudyService. The class in ../service.ts keeps the signatures and
 * forwards here, so routes, tools and tests keep talking to the service object.
 */
import { slugify, splitUnitKey, uniqueSlug } from '../../core/ids.ts'
import { listManifests } from '../../core/library.ts'
import { readProgress } from '../../core/progress.ts'
import { listConcepts } from '../../core/concepts.ts'
import { decayedMastery, ensureKnowledge, thresholdForLevel } from '../../core/knowledge.ts'
import { deletePlan as removePlanFile, goalConcepts, listPlans, nextStep as nextPlanStep, readPlan, validatePlan, writePlan } from '../../core/plans.ts'
import { deleteCard, judgementCardId, listCards, retirePlanCards, upsertJudgementCard } from '../../core/cards.ts'
import { deriveStuckPoints, gateStatus, planProgress, summarizeBoundary, thresholdOf } from '../../core/planGate.ts'
import { hash32 } from '../../core/srs.ts'
import { daysBetween } from '../../core/time.ts'
import type { AttemptMove, AttemptRecord, Coverage, MaterialManifest, PlanGeneration, PlanRecord, PlanStepKind, Provenance } from '../../core/types.ts'
import type { PlanDetailView, PlanSummary } from '../../core/views.ts'
import { goalPrompt } from '../service/prompts.ts'
import { cardView, planTargets, stepView } from '../service/views.ts'
import { StudyError } from './error.ts'
import type { StudyService } from '../service.ts'

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
  const [plans, manifests] = await Promise.all([listPlans(svc.paths), listManifests(svc.paths)])
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

/**
 * What still blocks closing this goal, from the knowledge space.
 *
 * A goal closes when every concept it targets is at its level threshold and
 * the next review falls past the deadline rule. Legacy plans without a mastery
 * map keep the old judgement gate, so old data stays closable.
 */
export async function goalProgressOf(
  svc: StudyService,
  plan: PlanRecord,
): Promise<{ passed: number; total: number; ready: boolean; reasons: string[] }> {
  const mastery = plan.mastery ?? []
  const map = goalConcepts(plan)
  if (map.size === 0 && mastery.length === 0) {
    const gate = gateStatus(plan)
    return { passed: gate.masteryPassed, total: gate.masteryTotal, ready: gate.ready, reasons: gate.reasons }
  }
  const reasons: string[] = []
  if ((plan.deliverable ?? '').trim().length === 0) {
    reasons.push('缺少交付物：先写清这次要交出什么')
  }
  if ((plan.deadline ?? '').trim().length === 0) {
    reasons.push('缺少期限：它决定什么时候算完成')
  }
  const total = map.size
  if (total === 0) {
    return {
      passed: 0,
      total: 0,
      ready: false,
      reasons: [...reasons, '目标还没有挂知识点：先练一节，或在目标页把范围补上'],
    }
  }
  const knowledge = await ensureKnowledge(svc.paths)
  const today = svc.today()
  const horizon = plan.deadline === undefined ? 0 : Math.max(0, daysBetween(today, plan.deadline))
  let passed = 0
  let behind = 0
  let toReview = 0
  for (const [conceptId, level] of map) {
    const state = knowledge.concepts[conceptId]
    const now = state === undefined ? 0 : decayedMastery(state, today)
    if (now >= thresholdForLevel(level)) passed += 1
    else behind += 1
    const dueIn = state?.due === undefined ? -1 : daysBetween(today, state.due)
    if (dueIn <= Math.max(30, horizon * 1.5)) toReview += 1
  }
  if (behind > 0) reasons.push(`知识点 ${passed}/${total}：还有 ${behind} 个没到档位`)
  if (toReview > 0) reasons.push(`还有 ${toReview} 个知识点需要复习到期限之后`)
  return { passed, total, ready: reasons.length === 0, reasons }
}

export async function planView(svc: StudyService, planId: string): Promise<PlanDetailView> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  const [manifests, progress, concepts] = await Promise.all([
    listManifests(svc.paths),
    readProgress(svc.paths),
    listConcepts(svc.paths),
  ])
  const conceptById = new Map(concepts.map(concept => [concept.id, concept]))
  const steps = plan.steps.map(step => stepView(step, manifests, conceptById, progress))
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
  const cards = (await listCards(svc.paths))
    .filter(card => card.planId === plan.id)
    .map(card => cardView(card, svc.today(), goalById))
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
    mastery: (plan.mastery ?? []).map(point => ({
      id: point.id,
      title: point.title,
      standard: point.standard,
      ...(point.target === undefined ? {} : { target: point.target }),
      concepts: [...(point.concepts ?? [])],
      ...(point.level === undefined ? {} : { level: point.level }),
      ...(point.passedAt === undefined ? {} : { passedAt: point.passedAt }),
    })),
    sufficiency: plan.sufficiency ?? [],
    gate: gateStatus(plan),
    goalProgress: await goalProgressOf(svc, plan),
    cards,
  }
}

/**
 * Attach extracted concepts to the goal's points on one unit.
 *
 * Goal generation runs before any unit has concepts, so its points can be
 * concept-less. The first practice extracts them; this writes them back so the
 * goal's target map is real from then on.
 */
export async function attachMasteryConcepts(
  svc: StudyService,
  planId: string,
  target: string,
  conceptIds: readonly string[],
): Promise<void> {
  if (conceptIds.length === 0) return
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) return
  const points = plan.mastery ?? []
  let changed = false
  for (const point of points) {
    if (point.target !== target) continue
    if ((point.concepts ?? []).length > 0) continue
    point.concepts = [...conceptIds].slice(0, 8)
    changed = true
  }
  if (!changed) return
  plan.updatedAt = new Date().toISOString()
  await writePlan(svc.paths, plan)
}

export async function createPlan(svc: StudyService, input: {
  goal: string
  steps: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string; coverage?: Coverage; skipReason?: string }>
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
  const issues = validatePlan(plan, planTargets(manifests, concepts))
  if (issues.length > 0) throw new StudyError('invalid', '计划未通过校验', { issues })
  await writePlan(svc.paths, plan)
  return svc.planView(plan.id)
}

export async function updatePlan(svc: StudyService, 
  planId: string,
  input: {
    setStep?: { n: number; done: boolean }
    setStatus?: 'active' | 'paused' | 'done'
    setGoal?: string
    replaceSteps?: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; why: string }>
    /** Replace the goal's knowledge map (written with the steps). */
    replaceMastery?: Array<{ title: string; standard: string; target?: string; concepts?: string[]; level?: 1 | 2 | 3 | 4 }>
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
  if (input.replaceMastery !== undefined) {
    // Replanning may redraw the map; a point with the same title keeps its
    // pass, so a retry does not erase evidence the reader already earned.
    // Dangling targets and concepts are dropped instead of blocking the map:
    // a point without a unit is still a goal-level point.
    const previous = new Map((plan.mastery ?? []).map(point => [point.title, point]))
    plan.mastery = input.replaceMastery
      .filter(point => point.title.trim().length > 0 && point.standard.trim().length > 0)
      .slice(0, 12)
      .map((point, index) => {
        const old = previous.get(point.title.trim())
        const linkedConcepts = (point.concepts ?? []).filter(concept => targets.hasConcept(concept)).slice(0, 8)
        return {
          id: `m${index + 1}`,
          title: point.title.trim().slice(0, 120),
          standard: point.standard.trim().slice(0, 500),
          ...(point.target === undefined || !targets.hasUnit(point.target) ? {} : { target: point.target }),
          ...(linkedConcepts.length === 0 ? {} : { concepts: linkedConcepts }),
          ...((point.level ?? old?.level) === undefined ? {} : { level: point.level ?? old?.level }),
          ...(old?.passedAt === undefined ? {} : { passedAt: old.passedAt }),
        }
      })
    if (plan.mastery.length === 0) delete plan.mastery
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
      if (!kept.has(item.id)) await deleteCard(svc.paths, judgementCardId(plan.id, item.id))
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
      await deleteCard(svc.paths, judgementCardId(plan.id, item.id))
    } else {
      await upsertJudgementCard(svc.paths, {
        planId: plan.id,
        questionId: item.id,
        prompt: item.q,
        detail: `目标：${plan.goal}`,
        today: svc.today(),
      })
    }
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
  // Closing means nothing comes back: the goal's cards leave the queue.
  await retirePlanCards(svc.paths, plan.id)
  return svc.planView(planId)
}

export async function setPlanGeneration(svc: StudyService, planId: string, generation: PlanGeneration): Promise<void> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) return
  plan.generation = { ...generation, updatedAt: new Date().toISOString() }
  await writePlan(svc.paths, plan)
}

export async function recordQuestions(svc: StudyService, 
  planId: string,
  items: Array<{ q: string; why?: string; ref?: string }>,
  ): Promise<PlanDetailView> {
  const plan = await readPlan(svc.paths, planId)
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
    if (!kept.has(item.id)) await deleteCard(svc.paths, judgementCardId(plan.id, item.id))
  }
  plan.sufficiency = next
  await writePlan(svc.paths, plan)
  return svc.planView(planId)
}

export async function recordJudgement(svc: StudyService, 
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
  const plan = await readPlan(svc.paths, planId)
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
  await writePlan(svc.paths, plan)
  const feedback = [result.advice, ...(result.missing ?? [])].filter(item => item !== undefined && item.length > 0)
  if (result.verdict === 'pass') {
    await deleteCard(svc.paths, judgementCardId(plan.id, item.id))
  } else {
    await upsertJudgementCard(svc.paths, {
      planId: plan.id,
      questionId: item.id,
      prompt: item.q,
      detail: feedback.length === 0 ? `目标：${plan.goal}` : `目标：${plan.goal}\n\n判定：${result.verdict}\n${feedback.join('\n')}`,
      today: svc.today(),
    })
  }
  return svc.planView(planId)
}

export async function deletePlan(svc: StudyService, planId: string): Promise<{ deleted: boolean }> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  return { deleted: await removePlanFile(svc.paths, planId) }
}
