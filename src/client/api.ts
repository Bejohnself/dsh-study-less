/**
 * Browser API helpers.
 *
 * Every call goes through `/study-api`, unwraps `{ ok, value }` and turns the
 * Host's stable error code into an `ApiError`. Job polling is centralized so the
 * reader, plan wizard and settings all show the same lifecycle.
 */
import type { JobView } from '../core/views.ts'

/** API failure with the server's machine code. */
export class ApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** Call one study API endpoint and unwrap `{ ok, value }`. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/study-api${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('bad-response', `接口返回了非 JSON（HTTP ${response.status}）`)
  }
  const value = payload as { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }
  if (response.ok && value.ok === true) return value.value as T
  throw new ApiError(value.error?.code ?? 'error', value.error?.message ?? `请求失败（HTTP ${response.status}）`)
}

/** POST one JSON body and unwrap the envelope. */
export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

/** Human error text. */
export function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/** Sleep that rejects promptly on abort. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      window.clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Poll one job until it reaches a terminal state. */
export async function waitForJob(
  jobId: string,
  onUpdate?: (job: JobView) => void,
  signal?: AbortSignal,
): Promise<JobView> {
  for (;;) {
    const job = await api<JobView>(`/jobs/${encodeURIComponent(jobId)}`)
    onUpdate?.(job)
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return job
    await sleep(900, signal)
  }
}
