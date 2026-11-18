/**
 * Inline generation routes: plans, units, quizzes, blocks, insights, books.
 *
 * Branches are the original handler branches, kept verbatim: each one answers by
 * sending a response, and the dispatcher in ../routes.ts stops as soon as
 * res.headersSent is true.
 */
import { StudyError } from '../service.ts'
import { requireService, requiredString, send } from './shared.ts'
import type { RouteContext } from './shared.ts'

export async function postGenerate(ctx: RouteContext, body: Record<string, unknown>): Promise<void> {
  const { service, res, path } = ctx
  const { generation, jobs } = ctx.extras
  if (path === '/generate/plan') {
    const goal = requiredString(body, 'goal')
    const materials = body.materials
    if (!Array.isArray(materials) || materials.length === 0) throw new StudyError('invalid', '至少选择一份资料')
    const deadline = typeof body.deadline === 'string' ? body.deadline.trim() : ''
    if (deadline.length === 0) throw new StudyError('invalid', '期限必填：它决定什么时候算完成')
    const extra = {
      ...(typeof body.deliverable === 'string' ? { deliverable: body.deliverable } : {}),
      deadline,
      ...(typeof body.audience === 'string' ? { audience: body.audience } : {}),
    }
    const serviceGeneration = requireService(generation, '生成引擎')
    try {
      const value = await serviceGeneration.generatePlan({
        goal,
        materials: materials.filter((item): item is string => typeof item === 'string'),
        ...(typeof body.brief === 'string' ? { brief: body.brief } : {}),
        ...(typeof body.hoursPerWeek === 'number' ? { hoursPerWeek: body.hoursPerWeek } : {}),
        ...(body.depth === 'deep' || body.depth === 'overview' ? { depth: body.depth } : {}),
        ...extra,
      })
      send(res, 200, { ok: true, value: { ...value, fallback: false } })
    } catch (error) {
      if (!(error instanceof StudyError) || error.code !== 'unsupported') throw error
      // No inline engine: keep the old "hand to the conversation" path so
      // creating a goal never dead-ends.
      const fallback = await service.createGoal({
        goal,
        materials: materials.filter((item): item is string => typeof item === 'string'),
        ...(typeof body.brief === 'string' ? { brief: body.brief } : {}),
        ...(typeof body.hoursPerWeek === 'number' ? { hoursPerWeek: body.hoursPerWeek } : {}),
        ...(body.depth === 'deep' || body.depth === 'overview' ? { depth: body.depth } : {}),
        ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
        ...extra,
      })
      send(res, 200, { ok: true, value: { planId: fallback.planId, jobId: null, fallback: true, prompted: fallback.prompted, error: fallback.error, prompt: fallback.prompt } })
    }
    return
  }
  if (path === '/generate/plan/retry') {
    const serviceGeneration = requireService(generation, '生成引擎')
    send(res, 200, { ok: true, value: await serviceGeneration.retryPlan(requiredString(body, 'pid')) })
    return
  }
  if (path === '/generate/book/outline') {
    const serviceGeneration = requireService(generation, '生成引擎')
    send(res, 200, { ok: true, value: await serviceGeneration.generateBookOutline(requiredString(body, 'pid')) })
    return
  }
  if (path === '/generate/book/chapter') {
    const serviceGeneration = requireService(generation, '生成引擎')
    send(res, 200, {
      ok: true,
      value: await serviceGeneration.generateBookChapter(requiredString(body, 'bid'), requiredString(body, 'cid')),
    })
    return
  }
  if (path === '/generate/book/continuity') {
    const serviceGeneration = requireService(generation, '生成引擎')
    send(res, 200, { ok: true, value: await serviceGeneration.generateBookContinuity(requiredString(body, 'bid')) })
    return
  }
  if (path === '/generate/unit') {
    const serviceGeneration = requireService(generation, '生成引擎')
    send(res, 200, {
      ok: true,
      value: await serviceGeneration.generateUnit({
        material: requiredString(body, 'mid'),
        unit: requiredString(body, 'uid'),
        ...(typeof body.planId === 'string' ? { planId: body.planId } : {}),
      }),
    })
    return
  }
  if (path === '/generate/quiz') {
    const serviceGeneration = requireService(generation, '生成引擎')
    send(res, 200, {
      ok: true,
      value: await serviceGeneration.generateQuiz({
        material: requiredString(body, 'mid'),
        unit: requiredString(body, 'uid'),
      }),
    })
    return
  }
  if (path === '/ask') {
    const serviceGeneration = requireService(generation, '生成引擎')
    send(res, 200, {
      ok: true,
      value: await serviceGeneration.ask({
        material: requiredString(body, 'mid'),
        unit: requiredString(body, 'uid'),
        ...(typeof body.page === 'number' ? { page: body.page } : {}),
        question: requiredString(body, 'question'),
      }),
    })
    return
  }
  if (path === '/blocks/merge') {
    send(res, 200, {
      ok: true,
      value: await service.mergeBlock(requiredString(body, 'mid'), requiredString(body, 'uid'), requiredString(body, 'blockId')),
    })
    return
  }
  if (path === '/generate/blocks') {
    const serviceGeneration = requireService(generation, '生成引擎')
    send(res, 200, {
      ok: true,
      value: await serviceGeneration.generateBlocks({
        material: requiredString(body, 'mid'),
        unit: requiredString(body, 'uid'),
      }),
    })
    return
  }
  if (path === '/generate/insight') {
    const serviceGeneration = requireService(generation, '生成引擎')
    send(res, 200, {
      ok: true,
      value: await serviceGeneration.generateInsights({
        ...(typeof body.mid === 'string' ? { material: body.mid } : {}),
        ...(typeof body.uid === 'string' ? { unit: body.uid } : {}),
        ...(typeof body.concept === 'string' ? { concept: body.concept } : {}),
      }),
    })
    return
  }
  if (path.startsWith('/jobs/') && path.endsWith('/cancel')) {
    const queue = requireService(jobs, '生成任务')
    const jobId = decodeURIComponent(path.slice('/jobs/'.length, -'/cancel'.length))
    send(res, 200, { ok: true, value: await queue.cancel(jobId) })
    return
  }
}
