/**
 * Plan generation: draft a path, retry it, and the job that writes it.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import { listManifests } from '../../core/library.ts'
import { readPlan } from '../../core/plans.ts'
import type { MaterialManifest } from '../../core/types.ts'
import type { PlanDetailView } from '../../core/views.ts'
import { type JobContext } from '../jobs.ts'
import { planPrompt } from '../generate/prompts.ts'
import { StudyError } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import { sanitizeMastery, sanitizePlanSteps, normalizePlanMastery, normalizePlanSteps } from './normalize.ts'

export async function generatePlan(svc: GenerationService, input: GeneratePlanInput): Promise<{ planId: string; jobId: string }> {
  if (!(await svc.textReady())) {
    throw new StudyError('unsupported', '还没有配置文本引擎；可以先交给当前对话生成，或到设置里配置模型')
  }
  const goal = input.goal.trim()
  if (goal.length === 0) throw new StudyError('invalid', '目标不能为空')
  if (input.materials.length === 0) throw new StudyError('invalid', '至少选择一份资料')
  const goalResult = await svc.deps.service.createGoal({
    goal,
    ...(input.brief === undefined ? {} : { brief: input.brief }),
    materials: input.materials,
    ...(input.hoursPerWeek === undefined ? {} : { hoursPerWeek: input.hoursPerWeek }),
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
    await svc.deps.service.setPlanGeneration(planId, { status: 'done', mode: 'inline', jobId: context.job.id })
    context.report(1, `已生成 ${count} 步、${points} 个掌握点${dropped === 0 ? '' : `（忽略 ${dropped} 个无效目标）`}`)
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
