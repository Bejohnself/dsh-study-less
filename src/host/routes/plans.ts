/**
 * Goal routes: plans, cutting boundaries, attempts and closure.
 *
 * Branches are the original handler branches, kept verbatim: each one answers by
 * sending a response, and the dispatcher in ../routes.ts stops as soon as
 * res.headersSent is true.
 */
import { StudyError, type StudyService } from '../service.ts'
import { ATTEMPT_MOVES, COVERAGES, PROVENANCES, oneOf, referenceText, requireService, requiredString, send } from './shared.ts'
import type { RouteContext } from './shared.ts'

export async function getPlans(ctx: RouteContext): Promise<void> {
  const { service, res, path, query } = ctx
  if (path === '/plans') {
    send(res, 200, { ok: true, value: await service.planList() })
    return
  }
  if (path === '/plan') {
    send(res, 200, { ok: true, value: await service.planView(query.get('pid') ?? '') })
    return
  }
}

export async function postPlans(ctx: RouteContext, body: Record<string, unknown>): Promise<void> {
  const { service, res, path } = ctx
  const { generation } = ctx.extras
  if (path === '/goal/create') {
    const goal = requiredString(body, 'goal')
    const materials = body.materials
    if (!Array.isArray(materials) || materials.length === 0) throw new StudyError('invalid', '至少选择一份资料')
    send(res, 200, {
      ok: true,
      value: await service.createGoal({
        goal,
        materials: materials.filter((item): item is string => typeof item === 'string'),
        ...(typeof body.brief === 'string' ? { brief: body.brief } : {}),
        ...(typeof body.hoursPerWeek === 'number' ? { hoursPerWeek: body.hoursPerWeek } : {}),
        ...(body.depth === 'deep' || body.depth === 'overview' ? { depth: body.depth } : {}),
        ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
      }),
    })
    return
  }
  if (path === '/plan/retry-chat') {
    send(res, 200, {
      ok: true,
      value: await service.promptPlanInChat(
        requiredString(body, 'pid'),
        typeof body.sessionId === 'string' ? body.sessionId : undefined,
      ),
    })
    return
  }
  if (path === '/plan/delete') {
    send(res, 200, { ok: true, value: await service.deletePlan(requiredString(body, 'pid')) })
    return
  }
  if (path === '/plan/create') {
    const goal = requiredString(body, 'goal')
    const steps = body.steps
    if (!Array.isArray(steps) || steps.length === 0) throw new StudyError('invalid', 'steps 不能为空')
    send(res, 200, {
      ok: true,
      value: await service.createPlan({
        goal,
        steps: steps as Parameters<StudyService['createPlan']>[0]['steps'],
        ...(typeof body.hoursPerWeek === 'number' ? { hoursPerWeek: body.hoursPerWeek } : {}),
        ...(typeof body.deliverable === 'string' ? { deliverable: body.deliverable } : {}),
        ...(typeof body.deadline === 'string' ? { deadline: body.deadline } : {}),
        ...(typeof body.audience === 'string' ? { audience: body.audience } : {}),
      }),
    })
    return
  }
  if (path === '/plan/update') {
    const pid = requiredString(body, 'pid')
    const setStep = body.setStep as { n?: unknown; done?: unknown } | undefined
    const setStatus = body.setStatus
    const replaceSteps = body.replaceSteps
    const setMeta = body.setMeta as Record<string, unknown> | undefined
    const setCoverage = body.setCoverage as { n?: unknown; coverage?: unknown; reason?: unknown } | undefined
    const addAttempt = body.addAttempt as {
      move?: unknown
      what?: unknown
      stuck?: unknown
      provenance?: unknown
      result?: unknown
    } | undefined
    const toggleSufficiency = body.toggleSufficiency as { id?: unknown; passed?: unknown } | undefined
    const metaText = (value: unknown): string | null | undefined => (value === null ? null : typeof value === 'string' ? value : undefined)
    const meta = {
      ...(setMeta === undefined ? {} : {
        ...(metaText(setMeta.deliverable) === undefined ? {} : { deliverable: metaText(setMeta.deliverable) }),
        ...(metaText(setMeta.deadline) === undefined ? {} : { deadline: metaText(setMeta.deadline) }),
        ...(metaText(setMeta.audience) === undefined ? {} : { audience: metaText(setMeta.audience) }),
        ...(typeof setMeta.threshold === 'number' ? { threshold: setMeta.threshold } : {}),
      }),
    }
    const coverage = setCoverage === undefined ? undefined : oneOf(setCoverage.coverage, COVERAGES)
    const move = addAttempt === undefined ? undefined : oneOf(addAttempt.move, ATTEMPT_MOVES)
    const provenance = addAttempt === undefined ? undefined : oneOf(addAttempt.provenance, PROVENANCES)
    send(res, 200, {
      ok: true,
      value: await service.updatePlan(pid, {
        ...(setStep !== undefined && typeof setStep.n === 'number' && typeof setStep.done === 'boolean'
          ? { setStep: { n: setStep.n, done: setStep.done } }
          : {}),
        ...(setStatus === 'active' || setStatus === 'paused' || setStatus === 'done' ? { setStatus } : {}),
        ...(typeof body.goal === 'string' && body.goal.trim().length > 0 ? { setGoal: body.goal.trim() } : {}),
        ...(Array.isArray(replaceSteps)
          ? { replaceSteps: replaceSteps as Parameters<StudyService['updatePlan']>[1]['replaceSteps'] }
          : {}),
        ...(Object.keys(meta).length === 0 ? {} : { setMeta: meta }),
        ...(setCoverage === undefined || typeof setCoverage.n !== 'number' || coverage === undefined
          ? {}
          : {
              setCoverage: {
                n: setCoverage.n,
                coverage,
                ...(typeof setCoverage.reason === 'string' ? { reason: setCoverage.reason } : {}),
              },
            }),
        ...(addAttempt === undefined || typeof addAttempt.what !== 'string' || move === undefined || provenance === undefined
          ? {}
          : {
              addAttempt: {
                move,
                what: addAttempt.what,
                provenance,
                ...(typeof addAttempt.stuck === 'string' ? { stuck: addAttempt.stuck } : {}),
                ...(typeof addAttempt.result === 'string' ? { result: addAttempt.result } : {}),
              },
            }),
        ...(typeof body.removeAttempt === 'string' ? { removeAttempt: body.removeAttempt } : {}),
        ...(Array.isArray(body.replaceSufficiency)
          ? {
              replaceSufficiency: body.replaceSufficiency as Array<{ q: string; passed?: boolean }>,
            }
          : {}),
        ...(toggleSufficiency === undefined || typeof toggleSufficiency.id !== 'string' || typeof toggleSufficiency.passed !== 'boolean'
          ? {}
          : {
              toggleSufficiency: {
                id: toggleSufficiency.id,
                passed: toggleSufficiency.passed,
                ...(typeof (body.toggleSufficiency as { reason?: unknown }).reason === 'string'
                  ? { reason: (body.toggleSufficiency as { reason: string }).reason }
                  : {}),
                ...(typeof (body.toggleSufficiency as { answer?: unknown }).answer === 'string'
                  ? { answer: (body.toggleSufficiency as { answer: string }).answer }
                  : {}),
              },
            }),
      }),
    })
    return
  }
  if (path === '/plan/questions') {
    const pid = requiredString(body, 'pid')
    const serviceGeneration = requireService(generation, '生成引擎')
    const view = await service.planView(pid)
    if (!(await serviceGeneration.textReady())) {
      send(res, 200, { ok: true, value: { generated: false, reason: 'no-engine', plan: view } })
      return
    }
    const ranges = view.steps
      .filter(step => step.target !== undefined && step.coverage !== 'skip')
      .map(step => ({
        id: `${step.target!.materialId}:${step.target!.unitId}`,
        title: step.target!.title,
        pages: `${String(step.target!.pageStart)}-${String(step.target!.pageEnd)}`,
        coverage: (step.coverage === 'skim' ? 'skim' : 'read') as 'read' | 'skim',
        why: step.why,
      }))
    if (ranges.length === 0) throw new StudyError('invalid', '这个目标还没有可读范围，先补上裁剪单')
    const count = typeof body.count === 'number' ? Math.min(8, Math.max(4, Math.round(body.count))) : 6
    const generated = await serviceGeneration.generateQuestions({
      goal: view.plan.goal,
      ...(view.plan.meta.deliverable === undefined ? {} : { deliverable: view.plan.meta.deliverable }),
      ...(view.plan.meta.deadline === undefined ? {} : { deadline: view.plan.meta.deadline }),
      ...(view.plan.meta.audience === undefined ? {} : { audience: view.plan.meta.audience }),
      ranges,
      count,
    })
    send(res, 200, {
      ok: true,
      value: {
        generated: true,
        engine: generated.engine,
        ...(generated.model === undefined ? {} : { model: generated.model }),
        plan: await service.recordQuestions(
          pid,
          generated.questions.map(question => ({
            q: question.q,
            ...(question.why === undefined ? {} : { why: question.why }),
            ...(question.ref === undefined ? {} : { ref: question.ref }),
          })),
        ),
      },
    })
    return
  }
  if (path === '/plan/judge') {
    const pid = requiredString(body, 'pid')
    const qid = requiredString(body, 'qid')
    const answer = requiredString(body, 'answer').trim()
    const serviceGeneration = requireService(generation, '生成引擎')
    const view = await service.planView(pid)
    const item = view.sufficiency.find(candidate => candidate.id === qid)
    if (item === undefined) throw new StudyError('not-found', `判定题不存在：${qid}`)
    if (!(await serviceGeneration.textReady())) {
      // No engine is not a failure: the panel switches to self-evaluation.
      send(res, 200, { ok: true, value: { judged: false, reason: 'no-engine', plan: view } })
      return
    }
    const boundary = view.steps
      .filter(step => step.coverage !== 'skip')
      .map(step => {
        const name = step.target?.title ?? step.why
        const pages = step.target === undefined ? '' : ` p${step.target.pageStart}-${step.target.pageEnd}`
        return `${name}${pages}（${step.coverage === 'skim' ? '略读' : '必读'}）`
      })
    const reference =
      typeof body.ref === 'string' && body.ref.length > 0 ? await referenceText(service, body.ref) : undefined
    const judged = await serviceGeneration.judgeAnswer({
      goal: view.plan.goal,
      ...(view.plan.meta.deliverable === undefined ? {} : { deliverable: view.plan.meta.deliverable }),
      ...(view.plan.meta.deadline === undefined ? {} : { deadline: view.plan.meta.deadline }),
      ...(view.plan.meta.audience === undefined ? {} : { audience: view.plan.meta.audience }),
      boundary,
      question: item.q,
      answer,
      ...(reference === undefined ? {} : { reference }),
    })
    send(res, 200, {
      ok: true,
      value: {
        judged: true,
        verdict: judged.verdict,
        missing: judged.missing,
        ...(judged.advice === undefined ? {} : { advice: judged.advice }),
        confidence: judged.confidence,
        plan: await service.recordJudgement(pid, qid, {
          answer,
          verdict: judged.verdict,
          ...(judged.missing.length === 0 ? {} : { missing: judged.missing }),
          ...(judged.advice === undefined ? {} : { advice: judged.advice }),
          judgedBy: { engine: judged.engine, ...(judged.model === undefined ? {} : { model: judged.model }) },
        }),
      },
    })
    return
  }
  if (path === '/plan/close') {
    const pid = requiredString(body, 'pid')
    send(res, 200, {
      ok: true,
      value: await service.closePlan(pid, typeof body.note === 'string' ? body.note : undefined),
    })
    return
  }
}
