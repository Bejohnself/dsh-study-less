/**
 * Library routes: materials, units, layout and import.
 *
 * Branches are the original handler branches, kept verbatim: each one answers by
 * sending a response, and the dispatcher in ../routes.ts stops as soon as
 * res.headersSent is true.
 */
import { optionalRating, optionalRevision, requiredString, send } from './shared.ts'
import type { RouteContext } from './shared.ts'

export async function getLibrary(ctx: RouteContext): Promise<void> {
  const { service, res, path, query } = ctx
  if (path === '/library') {
    send(res, 200, { ok: true, value: await service.library(query.get('archived') === '1') })
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
  if (path === '/layout') {
    const mid = query.get('mid') ?? ''
    const from = Number(query.get('from') ?? '0')
    const to = Number(query.get('to') ?? '0')
    send(res, 200, {
      ok: true,
      value: { paragraphs: await service.layout(mid, from, to) },
    })
    return
  }
}

export async function postLibrary(ctx: RouteContext, body: Record<string, unknown>): Promise<void> {
  const { service, res, path } = ctx
  if (path === '/import/url') {
    send(res, 200, { ok: true, value: await service.importFromUrl(requiredString(body, 'url')) })
    return
  }
  if (path === '/material/archive') {
    send(res, 200, {
      ok: true,
      value: await service.archiveMaterial(requiredString(body, 'mid'), body.archived === true),
    })
    return
  }
  if (path === '/material/delete') {
    send(res, 200, { ok: true, value: await service.deleteMaterial(requiredString(body, 'mid')) })
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
}
