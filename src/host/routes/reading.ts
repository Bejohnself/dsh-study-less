/**
 * Reading routes: today, review and judgement cards.
 *
 * Branches are the original handler branches, kept verbatim: each one answers by
 * sending a response, and the dispatcher in ../routes.ts stops as soon as
 * res.headersSent is true.
 */
import { StudyError } from '../service.ts'
import { optionalRating, optionalRevision, requiredString, send } from './shared.ts'
import type { RouteContext } from './shared.ts'

export async function getReading(ctx: RouteContext): Promise<void> {
  const { service, res, path } = ctx
  if (path === '/clock') {
    send(res, 200, { ok: true, value: service.clockState() })
    return
  }
  if (path === '/due') {
    send(res, 200, { ok: true, value: await service.due() })
    return
  }
  if (path === '/today') {
    send(res, 200, { ok: true, value: await service.todayView() })
    return
  }
}

export async function postReading(ctx: RouteContext, body: Record<string, unknown>): Promise<void> {
  const { service, res, path } = ctx
  if (path === '/clock') {
    // Test aid: advance one day, or go back to the real date. Nothing is stored.
    send(res, 200, { ok: true, value: body.reset === true ? service.resetClock() : service.advanceDay() })
    return
  }
  if (path === '/review') {
    const rating = optionalRating(body)
    if (rating === undefined) throw new StudyError('invalid', '缺少 rating')
    const quizScore = body.quizScore
    send(res, 200, {
      ok: true,
      value: await service.review(requiredString(body, 'mid'), requiredString(body, 'uid'), {
        rating,
        ...(typeof quizScore === 'number' ? { quizScore } : {}),
        revision: optionalRevision(body),
      }),
    })
    return
  }
}
