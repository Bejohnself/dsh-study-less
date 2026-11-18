/**
 * Shared plumbing of the browser API.
 *
 * One prefix route under /study-api answers GET reads and POST actions. Every
 * request must come from the loopback interface and, when a browser sends an
 * Origin, from this same origin: the panel is a same-origin view of the Host,
 * never a public API.
 *
 * The dispatcher lives in ../routes.ts; this file holds the pieces every route
 * group needs.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AttemptMove, Coverage, Provenance, Rating } from '../../core/types.ts'
import type { BookService } from '../books.ts'
import type { GenerationService } from '../generation.ts'
import type { InsightService } from '../insights.ts'
import type { JobQueue } from '../jobs.ts'
import type { QuizSessionService } from '../quizSessions.ts'
import { StudyError, type StudyService } from '../service.ts'
import type { SettingsService } from '../settings.ts'

/** One Host route registration. */
export interface StudyRoute {
  kind: 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
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

/** One request, already authenticated, narrowed and parsed. */
export interface RouteContext {
  service: StudyService
  extras: StudyRouteExtras
  req: IncomingMessage
  res: ServerResponse
  /** Path below /study-api, always starting with "/". */
  path: string
  query: URLSearchParams
}

/** Body cap for JSON actions. */
export const MAX_BODY_BYTES = 1024 * 1024

/** Boundary decisions accepted from the browser. */
export const COVERAGES: readonly Coverage[] = ['read', 'skim', 'skip']

/** The five minimal moves an attempt may take. */
export const ATTEMPT_MOVES: readonly AttemptMove[] = ['assumption', 'constraint', 'counterexample', 'ablation', 'transfer']

/** Attribution states of a conclusion. */
export const PROVENANCES: readonly Provenance[] = ['independent', 'judged', 'adopted-unverified']

/** Narrow an untrusted value to one of the allowed strings. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

/** Loopback addresses accepted as the client. */
export function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false
  const value = address.replace(/^::ffff:/, '')
  return value === '::1' || value === '127.0.0.1' || value.startsWith('127.')
}

/** Reject a cross-origin browser request. */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** Write one JSON response. */
export function send(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/**
 * Original text of one referenced range, bounded, for the judge's context.
 *
 * @param ref - `<materialId>:<unitId>`
 */
export async function referenceText(service: StudyService, ref: string): Promise<string | undefined> {
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
export function requireService<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new StudyError('unsupported', `${label}未启用`)
  return value
}

/** Read and parse a JSON body. */
export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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
export function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StudyError('invalid', `缺少字段 ${field}`)
  }
  return value.trim()
}

/** Read an optional rating field. */
export function optionalRating(body: Record<string, unknown>, field = 'rating'): Rating | undefined {
  const value = body[field]
  if (value === undefined) return undefined
  if (value === 1 || value === 2 || value === 3 || value === 4) return value
  throw new StudyError('invalid', `${field} 必须是 1-4`)
}

/** Read an optional revision field. */
export function optionalRevision(body: Record<string, unknown>): number | undefined {
  const value = body.revision
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StudyError('invalid', 'revision 必须是非负整数')
  }
  return value
}

/** Status code for a domain refusal. */
export function statusOf(error: StudyError): number {
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
