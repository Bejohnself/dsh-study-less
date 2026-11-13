/**
 * Browser API of the study desk.
 *
 * One prefix route under /study-api answers GET reads and POST actions. Every
 * request must come from the loopback interface and, when a browser sends an
 * Origin, from this same origin: the panel is a same-origin view of the Host,
 * never a public API.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Rating } from '../core/types.ts'
import { StudyError, type StudyService } from './service.ts'

/** One Host route registration. */
export interface StudyRoute {
  kind: 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

/** Body cap for JSON actions. */
const MAX_BODY_BYTES = 1024 * 1024

/** Loopback addresses accepted as the client. */
function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false
  const value = address.replace(/^::ffff:/, '')
  return value === '::1' || value === '127.0.0.1' || value.startsWith('127.')
}

/** Reject a cross-origin browser request. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** Write one JSON response. */
function send(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/** Read and parse a JSON body. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new StudyError('invalid', '请求体过大')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('body must be an object')
    }
    return value as Record<string, unknown>
  } catch (error) {
    throw new StudyError('invalid', `请求体不是合法 JSON：${(error as Error).message}`)
  }
}

/** Read a required string field. */
function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StudyError('invalid', `缺少字段 ${field}`)
  }
  return value.trim()
}

/** Read an optional rating field. */
function optionalRating(body: Record<string, unknown>, field = 'rating'): Rating | undefined {
  const value = body[field]
  if (value === undefined) return undefined
  if (value === 1 || value === 2 || value === 3 || value === 4) return value
  throw new StudyError('invalid', `${field} 必须是 1-4`)
}

/** Read an optional revision field. */
function optionalRevision(body: Record<string, unknown>): number | undefined {
  const value = body.revision
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StudyError('invalid', 'revision 必须是非负整数')
  }
  return value
}

/** Status code for a domain refusal. */
function statusOf(error: StudyError): number {
  switch (error.code) {
    case 'not-found':
      return 404
    case 'conflict':
      return 409
    case 'invalid':
      return 400
    case 'unsupported':
      return 415
  }
}

/**
 * Build the study API route.
 * @param service - the study service.
 */
export function makeStudyRoutes(service: StudyService): StudyRoute[] {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (!isLoopback(req.socket.remoteAddress)) {
        send(res, 403, { ok: false, error: { code: 'forbidden', message: '仅接受本机回环请求' } })
        return
      }
      if (!sameOrigin(req)) {
        send(res, 403, { ok: false, error: { code: 'forbidden', message: '跨源请求被拒绝' } })
        return
      }
      const method = req.method ?? 'GET'
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      const path = url.pathname.replace(/^\/study-api/, '') || '/'

      if (method === 'GET' || method === 'HEAD') {
        const query = url.searchParams
        if (path === '/health') {
          send(res, 200, {
            ok: true,
            plugin: 'dsh-study',
            version: '0.1.0',
            hostTime: new Date().toISOString(),
          })
          return
        }
        if (path === '/library') {
          send(res, 200, { ok: true, value: await service.library() })
          return
        }
        if (path === '/material') {
          send(res, 200, { ok: true, value: await service.materialState(query.get('mid') ?? '') })
          return
        }
        if (path === '/unit') {
          send(res, 200, {
            ok: true,
            value: await service.unit(query.get('mid') ?? '', query.get('uid') ?? ''),
          })
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
        if (path === '/concepts') {
          send(res, 200, { ok: true, value: await service.concepts() })
          return
        }
        if (path === '/concept') {
          send(res, 200, { ok: true, value: await service.conceptView(query.get('cid') ?? '') })
          return
        }
        if (path === '/plans') {
          send(res, 200, { ok: true, value: await service.planList() })
          return
        }
        if (path === '/plan') {
          send(res, 200, { ok: true, value: await service.planView(query.get('pid') ?? '') })
          return
        }
        if (path === '/quiz') {
          send(res, 200, {
            ok: true,
            value: await service.quiz(query.get('mid') ?? '', query.get('uid') ?? ''),
          })
          return
        }
        send(res, 404, { ok: false, error: { code: 'not-found', message: `未知接口：${path}` } })
        return
      }

      if (method !== 'POST') {
        res.writeHead(405, { allow: 'GET, HEAD, POST' })
        res.end()
        return
      }

      if (path === '/import/upload') {
        const name = decodeURIComponent(String(req.headers['x-study-name'] ?? 'upload.pdf'))
        send(res, 200, { ok: true, value: await service.importUpload(req, name) })
        return
      }

      const body = await readBody(req)
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
      if (path === '/import/url') {
        send(res, 200, { ok: true, value: await service.importFromUrl(requiredString(body, 'url')) })
        return
      }
      if (path === '/unit/complete') {
        const result = await service.complete(requiredString(body, 'mid'), requiredString(body, 'uid'), {
          rating: optionalRating(body),
          revision: optionalRevision(body),
        })
        send(res, 200, { ok: true, value: result })
        return
      }
      if (path === '/unit/uncomplete') {
        send(res, 200, {
          ok: true,
          value: await service.uncomplete(requiredString(body, 'mid'), requiredString(body, 'uid')),
        })
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
          }),
        })
        return
      }
      if (path === '/plan/update') {
        const pid = requiredString(body, 'pid')
        const setStep = body.setStep as { n?: unknown; done?: unknown } | undefined
        const setStatus = body.setStatus
        const replaceSteps = body.replaceSteps
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
          }),
        })
        return
      }
      if (path === '/import') {
        const filePath = requiredString(body, 'path')
        const type = body.type
        const title = body.title
        send(res, 200, {
          ok: true,
          value: await service.import({
            filePath,
            ...(type === 'book' || type === 'paper' || type === 'article' ? { type } : {}),
            ...(typeof title === 'string' && title.trim().length > 0 ? { title: title.trim() } : {}),
          }),
        })
        return
      }
      send(res, 404, { ok: false, error: { code: 'not-found', message: `未知接口：${path}` } })
    } catch (error) {
      if (error instanceof StudyError) {
        send(res, statusOf(error), {
          ok: false,
          error: { code: error.code, message: error.message, details: error.details ?? null },
        })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      send(res, 500, { ok: false, error: { code: 'internal', message } })
    }
  }

  return [{ kind: 'prefix', path: '/study-api', handler }]
}
