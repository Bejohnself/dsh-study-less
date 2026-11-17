/**
 * Binary and static routes of the study API.
 *
 * Three paths never touch the study ledger: unit extras (`/asset`), the
 * original PDF streamed with Range (`/pdf`), and the vendored pdf.js assets
 * (`/pdfjs/*`). Keeping them apart from the JSON routes makes the domain
 * handler in routes.ts read as a list of actions instead of a file server.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StudyError, type StudyService } from '../service.ts'

/** Content types for unit extras. */
const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png',
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
 * Serve one binary or static route.
 *
 * @returns true when `path` belonged to this module, so the caller can stop.
 */
export async function handleAssetRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  query: URLSearchParams,
  service: StudyService,
): Promise<boolean> {
  if (path.startsWith('/pdfjs/')) {
    await sendPdfJsAsset(res, path.slice('/pdfjs/'.length))
    return true
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
    return true
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
    return true
  }
  return false
}
