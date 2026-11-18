/**
 * Upload route of the import flow.
 *
 * Branches are the original handler branches, kept verbatim: each one answers by
 * sending a response, and the dispatcher in ../routes.ts stops as soon as
 * res.headersSent is true.
 */
import { send } from './shared.ts'
import type { RouteContext } from './shared.ts'

export async function postImport(ctx: RouteContext, body: Record<string, unknown>): Promise<void> {
  const { service, res, req, path } = ctx
  if (path === '/import/upload') {
    const name = decodeURIComponent(String(req.headers['x-study-name'] ?? 'upload.pdf'))
    send(res, 200, { ok: true, value: await service.importUpload(req, name) })
    return
  }
}
