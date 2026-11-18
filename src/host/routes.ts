/**
 * Browser API of the study desk.
 *
 * One prefix route under /study-api answers GET reads and POST actions. Every
 * request must come from the loopback interface and, when a browser sends an
 * Origin, from this same origin: the panel is a same-origin view of the Host,
 * never a public API.
 *
 * This file only guards, narrows and dispatches. The branches themselves live in
 * ./routes/<domain>.ts and answer by writing a response; a group is finished with
 * the request as soon as `res.headersSent` is true, which is why no group has to
 * report back whether it matched.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAssetRoute } from './http/assets.ts'
import { StudyError, type StudyService } from './service.ts'
import { getAdmin, postAdmin } from './routes/admin.ts'
import { postGenerate } from './routes/generate.ts'
import { postImport } from './routes/import.ts'
import { getLibrary, postLibrary } from './routes/library.ts'
import { getNotes, postNotes } from './routes/notes.ts'
import { getPlans, postPlans } from './routes/plans.ts'
import { getPractice, postPractice } from './routes/practice.ts'
import { getReading, postReading } from './routes/reading.ts'
import { isLoopback, readBody, sameOrigin, send, statusOf, type RouteContext, type StudyRoute, type StudyRouteExtras } from './routes/shared.ts'

export type { StudyRoute, StudyRouteExtras } from './routes/shared.ts'

/** One GET group: writes its own response when the path belongs to it. */
type GetGroup = (ctx: RouteContext) => Promise<void>

/** One POST group: same contract, with the parsed body. */
type PostGroup = (ctx: RouteContext, body: Record<string, unknown>) => Promise<void>

/** Read groups, tried in order until one answers. */
const GET_GROUPS: readonly GetGroup[] = [getLibrary, getReading, getPlans, getPractice, getNotes, getAdmin]

/** Write groups, tried in order until one answers. */
const POST_GROUPS: readonly PostGroup[] = [postLibrary, postReading, postPlans, postPractice, postNotes, postGenerate, postAdmin]

/**
 * Build the study API route.
 * @param service - the study service.
 * @param extras - settings, insights, generation and job queue when enabled.
 */
export function makeStudyRoutes(service: StudyService, extras: StudyRouteExtras = {}): StudyRoute[] {
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
      const ctx: RouteContext = { service, extras, req, res, path, query: url.searchParams }

      if (method === 'GET' || method === 'HEAD') {
        for (const group of GET_GROUPS) {
          await group(ctx)
          if (res.headersSent) return
        }
        if (await handleAssetRoute(req, res, path, url.searchParams, service)) return
        send(res, 404, { ok: false, error: { code: 'not-found', message: `未知接口：${path}` } })
        return
      }
      if (method !== 'POST') {
        res.writeHead(405, { allow: 'GET, HEAD, POST' })
        res.end()
        return
      }
      // The upload streams its own body, so it runs before the JSON body is read.
      await postImport(ctx)
      if (res.headersSent) return
      const body = await readBody(req)
      for (const group of POST_GROUPS) {
        await group(ctx, body)
        if (res.headersSent) return
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
