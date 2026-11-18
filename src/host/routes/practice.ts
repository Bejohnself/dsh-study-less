/**
 * Practice routes: quiz banks and adaptive sessions.
 *
 * Branches are the original handler branches, kept verbatim: each one answers by
 * sending a response, and the dispatcher in ../routes.ts stops as soon as
 * res.headersSent is true.
 */
import { StudyError } from '../service.ts'
import { requireService, requiredString, send } from './shared.ts'
import type { RouteContext } from './shared.ts'

export async function getPractice(ctx: RouteContext): Promise<void> {
  const { service, res, path, query } = ctx
  const { quizSessions } = ctx.extras
  if (path === '/quiz') {
    send(res, 200, {
      ok: true,
      value: await service.quiz(query.get('mid') ?? '', query.get('uid') ?? ''),
    })
    return
  }
  if (path === '/quiz/sessions') {
    const sessions = requireService(quizSessions, '练习会话')
    send(res, 200, {
      ok: true,
      value: await sessions.index({
        material: query.get('mid') ?? undefined,
        unit: query.get('uid') ?? undefined,
        book: query.get('bid') ?? undefined,
        chapter: query.get('cid') ?? undefined,
        plan: query.get('pid') ?? undefined,
      }),
    })
    return
  }
  if (path === '/quiz/session') {
    const sessions = requireService(quizSessions, '练习会话')
    send(res, 200, { ok: true, value: await sessions.get(query.get('sid') ?? '') })
    return
  }
}

export async function postPractice(ctx: RouteContext, body: Record<string, unknown>): Promise<void> {
  const { service, res, path } = ctx
  const { quizSessions } = ctx.extras
  if (path === '/quiz/session/start') {
    const sessions = requireService(quizSessions, '练习会话')
    send(res, 200, {
      ok: true,
      value: await sessions.start({
        ...(typeof body.mid === 'string' ? { material: body.mid } : {}),
        ...(typeof body.uid === 'string' ? { unit: body.uid } : {}),
        ...(typeof body.bid === 'string' ? { book: body.bid } : {}),
        ...(typeof body.cid === 'string' ? { chapter: body.cid } : {}),
        ...(typeof body.pid === 'string' ? { plan: body.pid } : {}),
        ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
        ...(body.restart === true ? { restart: true } : {}),
        ...(typeof body.concept === 'string' && body.concept.trim().length > 0 ? { concept: body.concept.trim() } : {}),
      }),
    })
    return
  }
  if (path === '/quiz/session/answer') {
    const sessions = requireService(quizSessions, '练习会话')
    const selfGrade = body.selfGrade
    send(res, 200, {
      ok: true,
      value: await sessions.answer(
        requiredString(body, 'sid'),
        requiredString(body, 'itemId'),
        body.answer,
        selfGrade === 'correct' || selfGrade === 'partial' || selfGrade === 'wrong' ? selfGrade : undefined,
      ),
    })
    return
  }
  if (path === '/quiz/session/appeal') {
    const sessions = requireService(quizSessions, '练习会话')
    const claim = body.claim
    send(res, 200, {
      ok: true,
      value: await sessions.appeal(
        requiredString(body, 'sid'),
        requiredString(body, 'itemId'),
        requiredString(body, 'reason'),
        claim === 'correct' || claim === 'partial' || claim === 'wrong' ? claim : undefined,
      ),
    })
    return
  }
  if (path === '/quiz/session/finish') {
    const sessions = requireService(quizSessions, '练习会话')
    send(res, 200, { ok: true, value: await sessions.finish(requiredString(body, 'sid')) })
    return
  }
  if (path === '/quiz/submit') {
    const answers = body.answers
    if (!Array.isArray(answers)) throw new StudyError('invalid', 'answers 必须是数组')
    send(res, 200, {
      ok: true,
      value: await service.submitQuiz(requiredString(body, 'mid'), requiredString(body, 'uid'), answers as Array<{ itemId: string; answer: unknown }>),
    })
    return
  }
}
