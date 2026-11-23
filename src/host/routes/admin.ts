/**
 * Admin routes: health, settings and generation jobs.
 *
 * Branches are the original handler branches, kept verbatim: each one answers by
 * sending a response, and the dispatcher in ../routes.ts stops as soon as
 * res.headersSent is true.
 */
import { settingsView } from '../../core/settings.ts'
import { PLUGIN_VERSION } from '../../core/version.ts'
import type { SettingsUpdate } from '../../core/views.ts'
import { requireService, send } from './shared.ts'
import type { RouteContext } from './shared.ts'

export async function getAdmin(ctx: RouteContext): Promise<void> {
  const { res, path } = ctx
  const { settings, generation, jobs, usage } = ctx.extras
  if (path === '/health') {
    send(res, 200, {
      ok: true,
      plugin: 'dsh-study-less',
      version: PLUGIN_VERSION,
      hostTime: new Date().toISOString(),
    })
    return
  }
  if (path === '/settings') {
    const serviceSettings = requireService(settings, '设置')
    const view = settingsView(await serviceSettings.current())
    send(res, 200, {
      ok: true,
      value: { ...view, textReady: generation === undefined ? view.textReady : await generation.textReady() },
    })
    return
  }
  if (path === '/usage') {
    const serviceUsage = requireService(usage, '用量统计')
    send(res, 200, { ok: true, value: await serviceUsage.summary() })
    return
  }
  if (path === '/jobs') {
    const queue = requireService(jobs, '生成任务')
    send(res, 200, { ok: true, value: await queue.list(30) })
    return
  }
  if (path.startsWith('/jobs/')) {
    const queue = requireService(jobs, '生成任务')
    const jobId = decodeURIComponent(path.slice('/jobs/'.length))
    send(res, 200, { ok: true, value: await queue.get(jobId) })
    return
  }
}

export async function postAdmin(ctx: RouteContext, body: Record<string, unknown>): Promise<void> {
  const { res, path } = ctx
  const { settings, generation, restartPlugin } = ctx.extras
  if (path === '/plugin/restart') {
    if (restartPlugin === undefined) {
      send(res, 501, { ok: false, error: { code: 'unsupported', message: '当前 DSH 不支持单插件重启；请重载插件或重启 DSH' } })
      return
    }
    try {
      restartPlugin()
      send(res, 202, { ok: true, value: { scheduled: true } })
    } catch (error) {
      send(res, 501, {
        ok: false,
        error: { code: 'unsupported', message: error instanceof Error ? error.message : String(error) },
      })
    }
    return
  }
  if (path === '/settings') {
    const serviceSettings = requireService(settings, '设置')
    const next = await serviceSettings.patch(body as SettingsUpdate)
    const view = settingsView(next)
    send(res, 200, {
      ok: true,
      value: { ...view, textReady: generation === undefined ? view.textReady : await generation.textReady() },
    })
    return
  }
  if (path === '/settings/test') {
    const serviceGeneration = requireService(generation, '生成引擎')
    const kind = body.kind === 'image' || body.kind === 'animation' || body.kind === 'embedding' ? body.kind : 'text'
    send(res, 200, { ok: true, value: await serviceGeneration.testEngine(kind) })
    return
  }
}
