/**
 * Browser API of the study desk.
 *
 * One prefix route under /study-api answers GET reads and POST actions. Every
 * request must come from the loopback interface and, when a browser sends an
 * Origin, from this same origin: the panel is a same-origin view of the Host,
 * never a public API.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { settingsView } from '../core/settings.ts'
import type { AttemptMove, Coverage, Provenance, Rating } from '../core/types.ts'
import { PLUGIN_VERSION } from '../core/version.ts'
import type { SettingsUpdate } from '../core/views.ts'
import type { BookService } from './books.ts'
import type { GenerationService } from './generation.ts'
import type { QuizSessionService } from './quizSessions.ts'
import type { InsightService } from './insights.ts'
import type { JobQueue } from './jobs.ts'
import { StudyError, type StudyService } from './service.ts'
import type { SettingsService } from './settings.ts'

/** One Host route registration. */
export interface StudyRoute {
  kind: 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

/** Body cap for JSON actions. */
const MAX_BODY_BYTES = 1024 * 1024

/** Boundary decisions accepted from the browser. */
const COVERAGES: readonly Coverage[] = ['read', 'skim', 'skip']

/** The five minimal moves an attempt may take. */
const ATTEMPT_MOVES: readonly AttemptMove[] = ['assumption', 'constraint', 'counterexample', 'ablation', 'transfer']

/** Attribution states of a conclusion. */
const PROVENANCES: readonly Provenance[] = ['independent', 'judged', 'adopted-unverified']

/** Narrow an untrusted value to one of the allowed strings. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

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

/** Content types for unit extras. */
const ASSET_TYPES: Record<string, string> = {  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

/** Serve one generated asset with a sandboxed CSP for active formats. */
async function sendAsset(res: ServerResponse, file: string, name: string): Promise<void> {
  const info = await stat(file)
  if (info.size > 64 * 1024 * 1024) throw new StudyError('invalid', '资源超过 64 MiB，无法在面板内预览')
  const bytes = await readFile(file)
  const type = ASSET_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, {
    'content-type': type,
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(type.startsWith('text/html') || type === 'image/svg+xml'
      ? {
          'content-security-policy':
            "sandbox allow-scripts; default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        }
      : {}),
  })
  res.end(bytes)
}

/** One byte range of a response body. */
interface ByteRange {
  start: number
  end: number
}

/**
 * Parse one `bytes=a-b` request header.
 *
 * @returns null for "no range", 'unsatisfiable' when it cannot be served, and
 * the inclusive range otherwise. Multi-range requests fall back to the full body:
 * the reader only ever asks for one span.
 */
function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (header === undefined) return null
  const raw = header.trim()
  if (!raw.toLowerCase().startsWith('bytes=')) return null
  const spec = raw.slice('bytes='.length)
  if (spec.includes(',')) return null
  const match = /^(\d*)-(\d*)$/.exec(spec)
  if (match === null) return null
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart.length === 0 && rawEnd.length === 0) return null
  if (rawStart.length === 0) {
    // Suffix range: the last N bytes.
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return 'unsatisfiable'
    return { start: Math.max(0, size - length), end: size - 1 }
  }
  const start = Number(rawStart)
  const end = rawEnd.length === 0 ? size - 1 : Number(rawEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

/**
 * Stream the original PDF, honouring Range so a 700-page book opens at once.
 *
 * The browser's own viewer does the rendering; this route only has to be a
 * correct, cacheable, range-capable file server for one file.
 */
async function sendPdf(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  options: { title: string; etag?: string },
): Promise<void> {
  let info
  try {
    info = await stat(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StudyError('not-found', '原文件不在库里：可以先用文本视图，或重新导入这份资料')
    }
    throw error
  }
  if (!info.isFile()) throw new StudyError('not-found', '原文件不是普通文件')
  const size = info.size
  const etag = options.etag === undefined ? undefined : `"${options.etag.slice(0, 16)}"`
  const headers: Record<string, string> = {
    'content-type': 'application/pdf',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-disposition': `inline; filename="${encodeURIComponent(options.title)}.pdf"; filename*=UTF-8''${encodeURIComponent(options.title)}.pdf`,
    ...(etag === undefined ? {} : { etag }),
  }
  if (etag !== undefined && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...headers, etag })
    res.end()
    return
  }
  const range = parseRange(req.headers.range, size)
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${size}`, 'content-length': '0' })
    res.end()
    return
  }
  if (range === null) {
    res.writeHead(200, { ...headers, 'content-length': String(size) })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res)
    return
  }
  res.writeHead(206, {
    ...headers,
    'content-length': String(range.end - range.start + 1),
    'content-range': `bytes ${range.start}-${range.end}/${size}`,
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file, { start: range.start, end: range.end })
    .on('error', () => res.destroy())
    .pipe(res)
}

/** Browser-side pdf.js module entry: tags onto the global study desk. */
const PDFJS_LOADER = `import * as pdfjs from './pdf.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = '/study-api/pdfjs/pdf.worker.mjs'
globalThis.__studyPdfjs = pdfjs
globalThis.dispatchEvent(new Event('study-pdfjs-ready'))
`

/** Directory groups the in-panel PDF viewer may fetch; nothing else is exposed. */
const PDFJS_DIRECTORIES = new Set(['wasm', 'cmaps', 'standard_fonts'])

/** Top-level pdf.js files the viewer may fetch. */
const PDFJS_FILES = new Set(['pdf.mjs', 'pdf.worker.mjs'])

/** Content types for the vendored pdf.js assets. */
const PDFJS_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

/** Reject any asset name that could escape the vendored directory. */
function pdfJsPath(name: string): { group: string; file: string } | undefined {
  const parts = name.split('/')
  if (parts.some(part => part.length === 0 || part === '.' || part === '..' || part.includes('\\'))) return undefined
  if (parts.length === 1) return PDFJS_FILES.has(parts[0]!) ? { group: '', file: parts[0]! } : undefined
  if (parts.length === 2 && PDFJS_DIRECTORIES.has(parts[0]!)) return { group: parts[0]!, file: parts[1]! }
  return undefined
}

/**
 * Serve one pdf.js asset for the in-panel viewer.
 *
 * The panel renders original pages on a canvas instead of embedding the
 * browser's own PDF viewer: an iframe is blank wherever that viewer is missing
 * (desktop shells, some browsers), which looks like an endless "loading". The
 * decoder wasm and cMap/font assets come along, so scanned pages and CJK PDFs
 * render too.
 *
 * @param res - response owned by this call.
 * @param name - file name below the pdfjs route segment, possibly grouped.
 */
async function sendPdfJsAsset(res: ServerResponse, name: string): Promise<void> {
  if (name === 'loader.mjs') {
    const body = PDFJS_LOADER
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
    return
  }
  const target = pdfJsPath(name)
  if (target === undefined) throw new StudyError('not-found', `未知的 PDF 资源：${name}`)
  const relative = target.group.length === 0 ? target.file : `${target.group}/${target.file}`
  const file = fileURLToPath(new URL(`./pdfjs/${relative}`, import.meta.url))
  let bytes: Buffer
  try {
    bytes = await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StudyError('not-found', 'PDF 渲染引擎没有随插件打包，请重新构建插件')
    }
    throw error
  }
  res.writeHead(200, {
    'content-type': PDFJS_TYPES[extname(target.file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': bytes.byteLength,
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  })
  res.end(bytes)
}

/**
 * Original text of one referenced range, bounded, for the judge's context.
 *
 * @param ref - `<materialId>:<unitId>`
 */
async function referenceText(service: StudyService, ref: string): Promise<string | undefined> {
  const separator = ref.indexOf(':')
  if (separator <= 0) return undefined
  try {
    const view = await service.unit(ref.slice(0, separator), ref.slice(separator + 1))
    const text = view.original
      .map(page => `[p${page.page}]\n${page.text}`)
      .join('\n\n')
      .slice(0, 4000)
    return text.length === 0 ? undefined : text
  } catch {
    return undefined
  }
}

/** Require an optional service, or refuse with a stable code. */
function requireService<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new StudyError('unsupported', `${label}未启用`)
  return value
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

/** Optional services; a deployment without them still serves the read model. */
export interface StudyRouteExtras {
  settings?: SettingsService
  quizSessions?: QuizSessionService
  books?: BookService
  insights?: InsightService
  generation?: GenerationService
  jobs?: JobQueue
}

/**
 * Build the study API route.
 * @param service - the study service.
 * @param extras - settings, insights, generation and job queue when enabled.
 */
export function makeStudyRoutes(service: StudyService, extras: StudyRouteExtras = {}): StudyRoute[] {
  const { settings, insights, generation, jobs, quizSessions, books } = extras
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
            version: PLUGIN_VERSION,
            hostTime: new Date().toISOString(),
          })
          return
        }
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
        if (path === '/due') {
          send(res, 200, { ok: true, value: await service.due() })
          return
        }
        if (path === '/cards') {
          send(res, 200, { ok: true, value: await service.dueCardList() })
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
        if (path === '/quiz/session') {
          const sessions = requireService(quizSessions, '练习会话')
          send(res, 200, { ok: true, value: await sessions.get(query.get('sid') ?? '') })
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
        if (path === '/settings') {
          const serviceSettings = requireService(settings, '设置')
          const view = settingsView(await serviceSettings.current())
          send(res, 200, {
            ok: true,
            value: { ...view, textReady: generation === undefined ? view.textReady : await generation.textReady() },
          })
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
        if (path.startsWith('/pdfjs/')) {
          await sendPdfJsAsset(res, path.slice('/pdfjs/'.length))
          return
        }
        if (path === '/pdf') {
          const mid = query.get('mid') ?? ''
          let source: { file: string; title: string; sha256?: string }
          try {
            source = await service.pdfSource(mid)
          } catch (error) {
            if (error instanceof StudyError) throw error
            throw new StudyError('not-found', `资料不存在：${mid}`)
          }
          await sendPdf(req, res, source.file, {
            title: source.title,
            ...(source.sha256 === undefined ? {} : { etag: source.sha256 }),
          })
          return
        }
        if (path === '/asset') {
          const mid = query.get('mid') ?? ''
          const uid = query.get('uid') ?? ''
          const name = query.get('name') ?? ''
          let file: string
          try {
            file = service.paths.extraFile(mid, uid, name)
          } catch {
            throw new StudyError('invalid', '非法的资源路径')
          }
          try {
            await sendAsset(res, file, name)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              throw new StudyError('not-found', `资源不存在：${name}`)
            }
            throw error
          }
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
      if (path === '/generate/plan') {
        const goal = requiredString(body, 'goal')
        const materials = body.materials
        if (!Array.isArray(materials) || materials.length === 0) throw new StudyError('invalid', '至少选择一份资料')
        const serviceGeneration = requireService(generation, '生成引擎')
        try {
          const value = await serviceGeneration.generatePlan({
            goal,
            materials: materials.filter((item): item is string => typeof item === 'string'),
            ...(typeof body.brief === 'string' ? { brief: body.brief } : {}),
            ...(typeof body.hoursPerWeek === 'number' ? { hoursPerWeek: body.hoursPerWeek } : {}),
            ...(body.depth === 'deep' || body.depth === 'overview' ? { depth: body.depth } : {}),
          })
          send(res, 200, { ok: true, value: { ...value, fallback: false } })
        } catch (error) {
          if (!(error instanceof StudyError) || error.code !== 'unsupported') throw error
          // No inline engine: keep the old "hand to the conversation" path so
          // creating a goal never dead-ends.
          const fallback = await service.createGoal({
            goal,
            materials: materials.filter((item): item is string => typeof item === 'string'),
            ...(typeof body.brief === 'string' ? { brief: body.brief } : {}),
            ...(typeof body.hoursPerWeek === 'number' ? { hoursPerWeek: body.hoursPerWeek } : {}),
            ...(body.depth === 'deep' || body.depth === 'overview' ? { depth: body.depth } : {}),
            ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
          })
          send(res, 200, { ok: true, value: { planId: fallback.planId, jobId: null, fallback: true, prompted: fallback.prompted, error: fallback.error, prompt: fallback.prompt } })
        }
        return
      }
      if (path === '/generate/plan/retry') {
        const serviceGeneration = requireService(generation, '生成引擎')
        send(res, 200, { ok: true, value: await serviceGeneration.retryPlan(requiredString(body, 'pid')) })
        return
      }
      if (path === '/generate/book/outline') {
        const serviceGeneration = requireService(generation, '生成引擎')
        send(res, 200, { ok: true, value: await serviceGeneration.generateBookOutline(requiredString(body, 'pid')) })
        return
      }
      if (path === '/generate/book/chapter') {
        const serviceGeneration = requireService(generation, '生成引擎')
        send(res, 200, {
          ok: true,
          value: await serviceGeneration.generateBookChapter(requiredString(body, 'bid'), requiredString(body, 'cid')),
        })
        return
      }
      if (path === '/generate/book/continuity') {
        const serviceGeneration = requireService(generation, '生成引擎')
        send(res, 200, { ok: true, value: await serviceGeneration.generateBookContinuity(requiredString(body, 'bid')) })
        return
      }
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
      if (path === '/generate/unit') {
        const serviceGeneration = requireService(generation, '生成引擎')
        send(res, 200, {
          ok: true,
          value: await serviceGeneration.generateUnit({
            material: requiredString(body, 'mid'),
            unit: requiredString(body, 'uid'),
            ...(typeof body.planId === 'string' ? { planId: body.planId } : {}),
          }),
        })
        return
      }
      if (path === '/generate/quiz') {
        const serviceGeneration = requireService(generation, '生成引擎')
        send(res, 200, {
          ok: true,
          value: await serviceGeneration.generateQuiz({
            material: requiredString(body, 'mid'),
            unit: requiredString(body, 'uid'),
          }),
        })
        return
      }
      if (path === '/ask') {
        const serviceGeneration = requireService(generation, '生成引擎')
        send(res, 200, {
          ok: true,
          value: await serviceGeneration.ask({
            material: requiredString(body, 'mid'),
            unit: requiredString(body, 'uid'),
            ...(typeof body.page === 'number' ? { page: body.page } : {}),
            question: requiredString(body, 'question'),
          }),
        })
        return
      }
      if (path === '/blocks/merge') {
        send(res, 200, {
          ok: true,
          value: await service.mergeBlock(requiredString(body, 'mid'), requiredString(body, 'uid'), requiredString(body, 'blockId')),
        })
        return
      }
      if (path === '/generate/blocks') {
        const serviceGeneration = requireService(generation, '生成引擎')
        send(res, 200, {
          ok: true,
          value: await serviceGeneration.generateBlocks({
            material: requiredString(body, 'mid'),
            unit: requiredString(body, 'uid'),
          }),
        })
        return
      }
      if (path === '/generate/insight') {
        const serviceGeneration = requireService(generation, '生成引擎')
        send(res, 200, {
          ok: true,
          value: await serviceGeneration.generateInsights({
            ...(typeof body.mid === 'string' ? { material: body.mid } : {}),
            ...(typeof body.uid === 'string' ? { unit: body.uid } : {}),
            ...(typeof body.concept === 'string' ? { concept: body.concept } : {}),
          }),
        })
        return
      }
      if (path.startsWith('/jobs/') && path.endsWith('/cancel')) {
        const queue = requireService(jobs, '生成任务')
        const jobId = decodeURIComponent(path.slice('/jobs/'.length, -'/cancel'.length))
        send(res, 200, { ok: true, value: await queue.cancel(jobId) })
        return
      }
      if (path === '/quiz/session/start') {
        const sessions = requireService(quizSessions, '练习会话')
        send(res, 200, {
          ok: true,
          value: await sessions.start({
            ...(typeof body.mid === 'string' ? { material: body.mid } : {}),
            ...(typeof body.uid === 'string' ? { unit: body.uid } : {}),
            ...(typeof body.bid === 'string' ? { book: body.bid } : {}),
            ...(typeof body.cid === 'string' ? { chapter: body.cid } : {}),
            ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
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
      if (path === '/card/review') {
        const cid = requiredString(body, 'cid')
        const rating = optionalRating(body)
        if (rating === undefined) throw new StudyError('invalid', '缺少 rating')
        send(res, 200, { ok: true, value: await service.reviewCard(cid, rating) })
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
