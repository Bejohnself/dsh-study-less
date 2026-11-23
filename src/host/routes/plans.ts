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
        // The goal form sends these; dropping them here left a goal that could
        // never satisfy the closure gate.
        ...(typeof body.deliverable === 'string' ? { deliverable: body.deliverable } : {}),
        ...(typeof body.deadline === 'string' ? { deadline: body.deadline } : {}),
        ...(typeof body.audience === 'string' ? { audience: body.audience } : {}),
      }),
    })
    return
  }
  if (path === '/plan/concepts') {
    const pid = requiredString(body, 'pid')
    const target = requiredString(body, 'target')
    const serviceGeneration = requireService(generation, '生成引擎')
    const view = await service.planView(pid)
    const step = view.steps.find(
      candidate =>
        candidate.target !== undefined &&
        candidate.coverage !== 'skip' &&
        `${candidate.target.materialId}:${candidate.target.unitId}` === target,
    )
    if (step === undefined || step.target === undefined) {
      throw new StudyError('not-found', '这一步不在这个目标里，或已标为不读')
    }
    const extracted = await serviceGeneration.extractUnitConcepts({
      material: step.target.materialId,
      unit: step.target.unitId,
    })
    send(res, 200, { ok: true, value: { ...extracted, plan: await service.planView(pid) } })
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
    const setLevel = body.setLevel as { n?: unknown; level?: unknown } | undefined
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
        ...(setLevel === undefined || typeof setLevel.n !== 'number'
          ? {}
          : {
              setLevel: {
                n: setLevel.n,
                level: (setLevel.level === 1 || setLevel.level === 2 || setLevel.level === 3 || setLevel.level === 4
                  ? setLevel.level
                  : 2),
              },
            }),
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
  if (path === '/plan/close') {
    const pid = requiredString(body, 'pid')
    send(res, 200, {
      ok: true,
      value: await service.closePlan(pid, typeof body.note === 'string' ? body.note : undefined),
    })
    return
  }
}
