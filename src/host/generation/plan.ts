/**
 * Plan generation: draft a path, retry it, and the job that writes it.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import { splitUnitKey } from '../../core/ids.ts'
import { listManifests } from '../../core/library.ts'
import { goalSections, readPlan } from '../../core/plans.ts'
import type { MaterialManifest } from '../../core/types.ts'
import type { PlanDetailView } from '../../core/views.ts'
import { type JobContext } from '../jobs.ts'
import { planPrompt } from '../generate/prompts.ts'
import { StudyError } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import type { GeneratePlanInput } from './shared.ts'
import { sanitizePlanSteps, normalizePlanSteps } from './normalize.ts'
import { extractUnitConcepts } from './concepts.ts'

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
    const prompt = planPrompt({
      goal: plan.goal,
      ...(plan.brief === undefined ? {} : { brief: plan.brief }),
      depth: input.depth ?? 'deep',
      ...(plan.budget?.hoursPerWeek === undefined ? {} : { hoursPerWeek: plan.budget.hoursPerWeek }),
      manifests: chosen,
    })
    const validUnits = new Set<string>()
    for (const manifest of chosen) {
      for (const node of manifest.structure) validUnits.add(`${manifest.id}:${node.uid}`)
    }
    const validConcepts = new Set((await svc.deps.service.concepts()).map(concept => concept.id))
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
      count = sanitized.steps.length
      dropped = sanitized.issues.length
      points = sanitized.steps.filter(step => step.target !== undefined && step.coverage !== 'skip').length
      await svc.deps.service.updatePlan(planId, { replaceSteps: sanitized.steps })
    })
    // A goal is only useful once its sections have knowledge points: extract
    // them now, while the creation job is still running, so the route has a
    // real target set from day one instead of a copied table of contents.
    const concepts = await ensureGoalConcepts(svc, planId, context)
    await svc.deps.service.setPlanGeneration(planId, { status: 'done', mode: 'inline', jobId: context.job.id })
    context.report(
      1,
      `已生成 ${count} 步、${points} 节定了档${
        concepts.added === 0 ? '' : `；补了 ${concepts.added} 节的知识点`
      }${concepts.failed === 0 ? '' : `（${String(concepts.failed)} 节没抽出来，可在目标页补）`}${
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
 * Extract knowledge points for every required section and attach them.
 *
 * Goal generation sees an empty concept library on a fresh import; without this
 * step the goal has no concept targets until the first practice, which is what
 * made the knowledge map look like a copy of the table of contents. Sections
 * run one at a time because `writeConcepts` rewrites the material manifest;
 * two failures in a row stop the pass so a broken engine cannot burn the whole
 * bill. Missing sections stay visible: the closure gate names them and the plan
 * page offers a per-section retry.
 */
async function ensureGoalConcepts(
  svc: GenerationService,
  planId: string,
  context: JobContext,
): Promise<{ added: number; failed: number }> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) return { added: 0, failed: 0 }
  const sections = goalSections(plan)
  let added = 0
  let failed = 0
  let consecutive = 0
  for (const [index, section] of sections.entries()) {
    context.report(0.85 + (0.14 * (index + 1)) / sections.length, `正在补第 ${index + 1}/${sections.length} 节的知识点…`)
    let filled = false
    try {
      const { materialId, unitId } = splitUnitKey(section.target)
      const unit = await svc.deps.service.unit(materialId, unitId)
      filled = (unit.unit.concepts ?? []).length > 0
      if (!filled) {
        const result = await extractUnitConcepts(svc, { material: materialId, unit: unitId }, context)
        if (result.extracted > 0) added += 1
        filled = result.ids.length > 0
      }
    } catch {
      failed += 1
      consecutive += 1
      if (consecutive >= 2) break
      continue
    }
    consecutive = 0
    if (!filled) failed += 1
  }
  return { added, failed }
}
