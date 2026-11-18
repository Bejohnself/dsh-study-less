/**
 * Plan generation: draft a path, retry it, and the job that writes it.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import { splitUnitKey } from '../../core/ids.ts'
import { listManifests } from '../../core/library.ts'
import { readPlan } from '../../core/plans.ts'
import type { MaterialManifest } from '../../core/types.ts'
import type { PlanDetailView } from '../../core/views.ts'
import { type JobContext } from '../jobs.ts'
import { planPrompt } from '../generate/prompts.ts'
import { StudyError } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import { sanitizeMastery, sanitizePlanSteps, normalizePlanMastery, normalizePlanSteps } from './normalize.ts'
import { extractConcepts } from './concepts.ts'

export async function generatePlan(svc: GenerationService, input: GeneratePlanInput): Promise<{ planId: string; jobId: string }> {
  if (!(await svc.textReady())) {
    throw new StudyError('unsupported', '还没有配置文本引擎；可以先交给当前对话生成，或到设置里配置模型')
  }
  const goal = input.goal.trim()
  if (goal.length === 0) throw new StudyError('invalid', '目标不能为空')
  if (input.materials.length === 0) throw new StudyError('invalid', '至少选择一份资料')
  if (input.deadline === undefined || input.deadline.trim().length === 0) {
    throw new StudyError('invalid', '期限必填：它决定什么时候算完成')
  }
  const goalResult = await svc.deps.service.createGoal({
    goal,
    ...(input.brief === undefined ? {} : { brief: input.brief }),
    materials: input.materials,
    ...(input.hoursPerWeek === undefined ? {} : { hoursPerWeek: input.hoursPerWeek }),
    ...(input.deliverable === undefined ? {} : { deliverable: input.deliverable }),
    ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
    ...(input.audience === undefined ? {} : { audience: input.audience }),
    depth: input.depth ?? 'deep',
  })
  const job = await svc.deps.jobs.create('plan', { planId: goalResult.planId }, context =>
    svc.runPlan(goalResult.planId, input, context),
  )
  await svc.deps.service.setPlanGeneration(goalResult.planId, { status: 'queued', mode: 'inline', jobId: job.id })
  return { planId: goalResult.planId, jobId: job.id }
}

export async function retryPlan(svc: GenerationService, planId: string): Promise<{ planId: string; jobId: string }> {
  if (!(await svc.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  const materials = plan.materials ?? []
  if (materials.length === 0) throw new StudyError('invalid', '这条计划没有选定资料，无法自动重试')
  const job = await svc.deps.jobs.create('plan', { planId }, context =>
    svc.runPlan(
      planId,
      {
        goal: plan.goal,
        materials: [...materials],
        ...(plan.brief === undefined ? {} : { brief: plan.brief }),
        ...(plan.budget?.hoursPerWeek === undefined ? {} : { hoursPerWeek: plan.budget.hoursPerWeek }),
        depth: 'deep',
      },
      context,
    ),
  )
  await svc.deps.service.setPlanGeneration(planId, { status: 'queued', mode: 'inline', jobId: job.id })
  return { planId, jobId: job.id }
}

export async function runPlan(svc: GenerationService, planId: string, input: GeneratePlanInput, context: JobContext): Promise<PlanDetailView> {
  await svc.deps.service.setPlanGeneration(planId, { status: 'running', mode: 'inline', jobId: context.job.id })
  try {
    const plan = await readPlan(svc.paths, planId)
    if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
    const all = await listManifests(svc.paths)
    const chosen = (plan.materials ?? input.materials)
      .map(id => all.find(manifest => manifest.id === id))
      .filter((manifest): manifest is MaterialManifest => manifest !== undefined)
    if (chosen.length === 0) throw new StudyError('not-found', '计划的资料都不存在了')
    const concepts = (await svc.deps.service.concepts()).map(concept => ({
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
    const validUnits = new Set<string>()
    for (const manifest of chosen) {
      for (const node of manifest.structure) validUnits.add(`${manifest.id}:${node.uid}`)
    }
    const validConcepts = new Set(concepts.map(concept => concept.id))
    const validMaterials = new Set(chosen.map(manifest => manifest.id))
    let count = 0
    let dropped = 0
    let points = 0
    await svc.completeJson(context, prompt, async parsed => {
      const raw = normalizePlanSteps(parsed)
      const sanitized = sanitizePlanSteps(raw, validUnits, validConcepts, validMaterials)
      if (sanitized.steps.length === 0) {
        throw new StudyError('invalid', '计划没有可用的步骤', { issues: sanitized.issues })
      }
      // The mastery map is written together with the steps: one read gives both
      // the path and what "done" means, and one write keeps them consistent.
      const masteryRaw = normalizePlanMastery(parsed)
      const mastery = sanitizeMastery(masteryRaw, validUnits, validConcepts)
      if (mastery.points.length === 0) {
        throw new StudyError('invalid', '计划没有可用的掌握点', { issues: mastery.issues })
      }
      count = sanitized.steps.length
      dropped = sanitized.issues.length + mastery.issues.length
      points = mastery.points.length
      await svc.deps.service.updatePlan(planId, {
        replaceSteps: sanitized.steps,
        replaceMastery: mastery.points,
      })
    })
    // A goal is only useful once its sections have knowledge points: extract
    // them now, while the creation job is still running, and hang them on the
    // mastery map so the route has a real target set from day one.
    const filled = await ensureGoalConcepts(svc, planId, context)
    await svc.deps.service.setPlanGeneration(planId, { status: 'done', mode: 'inline', jobId: context.job.id })
    context.report(
      1,
      `已生成 ${count} 步、${points} 个掌握点${filled === 0 ? '' : `；补了 ${filled} 节的知识点`}${
        dropped === 0 ? '' : `（忽略 ${dropped} 个无效目标）`
      }`,
    )
    return await svc.deps.service.planView(planId)
  } catch (error) {
    await svc.deps.service.setPlanGeneration(planId, {
      status: 'failed',
      mode: 'inline',
      jobId: context.job.id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Extract knowledge points for the goal's sections and attach them.
 *
 * Goal generation sees an empty concept library on a fresh import; without this
 * step the goal has no concept targets until the first practice. Six sections
 * is the cap: enough for a focused goal, bounded for the model bill.
 */
async function ensureGoalConcepts(
  svc: GenerationService,
  planId: string,
  context: JobContext,
): Promise<number> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) return 0
  const targets = new Set<string>()
  for (const point of plan.mastery ?? []) {
    if (point.target !== undefined) targets.add(point.target)
  }
  for (const step of plan.steps) {
    if (step.target !== undefined && step.coverage !== 'skip') targets.add(step.target)
  }
  const list = [...targets].slice(0, 6)
  let filled = 0
  for (const [index, target] of list.entries()) {
    try {
      const { materialId, unitId } = splitUnitKey(target)
      const unit = await svc.deps.service.unit(materialId, unitId)
      if ((unit.unit.concepts ?? []).length > 0) continue
      const concepts = await extractConcepts(svc, { material: materialId, unit: unitId })
      if (concepts.length === 0) continue
      await svc.deps.service.writeConcepts(materialId, unitId, concepts)
      await svc.deps.service.attachMasteryConcepts(planId, target, concepts.map(concept => concept.id))
      filled += 1
      context.report(0.85 + (0.1 * (index + 1)) / list.length, `正在补第 ${index + 1} 节的知识点…`)
    } catch {
      // A section that cannot be read or extracted is skipped; practice can
      // still fill it in on first use.
    }
  }
  return filled
}
