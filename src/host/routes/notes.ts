/**
 * Notes routes: concepts, insights and books.
 *
 * Branches are the original handler branches, kept verbatim: each one answers by
 * sending a response, and the dispatcher in ../routes.ts stops as soon as
 * res.headersSent is true.
 */
import { requireService, requiredString, send } from './shared.ts'
import type { RouteContext } from './shared.ts'

export async function getNotes(ctx: RouteContext): Promise<void> {
  const { service, res, path, query } = ctx
  const { insights, books } = ctx.extras
  if (path === '/concepts') {
    send(res, 200, { ok: true, value: await service.concepts() })
    return
  }
  if (path === '/concept') {
    send(res, 200, { ok: true, value: await service.conceptView(query.get('cid') ?? '') })
    return
  }
  if (path === '/books') {
    const serviceBooks = requireService(books, '自编书')
    send(res, 200, { ok: true, value: await serviceBooks.list(query.get('pid') ?? undefined) })
    return
  }
  if (path === '/book') {
    const serviceBooks = requireService(books, '自编书')
    send(res, 200, { ok: true, value: await serviceBooks.get(query.get('bid') ?? '') })
    return
  }
  if (path === '/book/chapter') {
    const serviceBooks = requireService(books, '自编书')
    send(res, 200, { ok: true, value: await serviceBooks.chapter(query.get('bid') ?? '', query.get('cid') ?? '') })
    return
  }
  if (path === '/book/export') {
    const serviceBooks = requireService(books, '自编书')
    const markdown = await serviceBooks.exportMarkdown(query.get('bid') ?? '')
    res.writeHead(200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-length': Buffer.byteLength(markdown),
      'content-disposition': `attachment; filename="${encodeURIComponent(query.get('bid') ?? 'book')}.md"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(markdown)
    return
  }
  if (path === '/insights') {
    const serviceInsights = requireService(insights, '洞察')
    send(res, 200, { ok: true, value: await serviceInsights.cards() })
    return
  }
  if (path === '/insight') {
    const serviceInsights = requireService(insights, '洞察')
    send(res, 200, { ok: true, value: await serviceInsights.view(query.get('iid') ?? '') })
    return
  }
}

export async function postNotes(ctx: RouteContext, body: Record<string, unknown>): Promise<void> {
  const { res, path } = ctx
  const { insights, books } = ctx.extras
  if (path === '/book/progress') {
    const serviceBooks = requireService(books, '自编书')
    await serviceBooks.markRead(requiredString(body, 'bid'), requiredString(body, 'cid'))
    send(res, 200, { ok: true, value: { read: true } })
    return
  }
  if (path === '/book/delete') {
    const serviceBooks = requireService(books, '自编书')
    send(res, 200, { ok: true, value: await serviceBooks.delete(requiredString(body, 'bid')) })
    return
  }
  if (path === '/insight/create') {
    const serviceInsights = requireService(insights, '洞察')
    send(res, 200, {
      ok: true,
      value: await serviceInsights.create({
        title: requiredString(body, 'title'),
        oneLiner: requiredString(body, 'oneLiner'),
        body: requiredString(body, 'body'),
        concepts: Array.isArray(body.concepts) ? body.concepts.map(String) : [],
        sources: Array.isArray(body.sources) ? (body.sources as Array<{ material: string; unit: string; page: number; quote?: string }>) : [],
        ...(typeof body.formula === 'string' ? { formula: body.formula } : {}),
        ...(Array.isArray(body.tags) ? { tags: body.tags.map(String) } : {}),
        ...(typeof body.kind === 'string' ? { kind: body.kind as 'principle' | 'formula' | 'contrast' | 'pitfall' | 'analogy' | 'method' } : {}),
        ...(body.pinned === true ? { pinned: true } : {}),
      }),
    })
    return
  }
  if (path === '/insight/update') {
    const serviceInsights = requireService(insights, '洞察')
    send(res, 200, {
      ok: true,
      value: await serviceInsights.update(requiredString(body, 'iid'), {
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        ...(typeof body.oneLiner === 'string' ? { oneLiner: body.oneLiner } : {}),
        ...(typeof body.body === 'string' ? { body: body.body } : {}),
        ...(typeof body.formula === 'string' ? { formula: body.formula } : {}),
        ...(Array.isArray(body.concepts) ? { concepts: body.concepts.map(String) } : {}),
        ...(Array.isArray(body.sources) ? { sources: body.sources as Array<{ material: string; unit: string; page: number; quote?: string }> } : {}),
        ...(Array.isArray(body.tags) ? { tags: body.tags.map(String) } : {}),
        ...(typeof body.kind === 'string' ? { kind: body.kind as 'principle' | 'formula' | 'contrast' | 'pitfall' | 'analogy' | 'method' } : {}),
        ...(typeof body.pinned === 'boolean' ? { pinned: body.pinned } : {}),
      }),
    })
    return
  }
  if (path === '/insight/pin') {
    const serviceInsights = requireService(insights, '洞察')
    send(res, 200, {
      ok: true,
      value: await serviceInsights.pin(requiredString(body, 'iid'), body.pinned === true),
    })
    return
  }
  if (path === '/insight/delete') {
    const serviceInsights = requireService(insights, '洞察')
    send(res, 200, { ok: true, value: await serviceInsights.remove(requiredString(body, 'iid')) })
    return
  }
}
