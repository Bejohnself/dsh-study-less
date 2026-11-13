/**
 * Durable generation jobs.
 *
 * A job is the browser's handle on work that outlives one request. The queue
 * lives in the Host process; every state transition is also written to
 * `jobs/<id>.json` so a restart can report an interrupted job instead of losing
 * it, and the panel can show progress after a refresh.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSegment } from './ids.ts'
import type { LibraryPaths } from './paths.ts'
import { readJson, writeJsonAtomic } from './store.ts'
import type { GenerationJob, JobKind, JobStatus, JobTarget } from './types.ts'

/** Statuses that will not change again. */
export function isTerminal(status: JobStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

/** A fresh job in `queued`. */
export function newJob(kind: JobKind, target: JobTarget): GenerationJob {
  const now = new Date().toISOString()
  return {
    version: 1,
    id: `job-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    kind,
    status: 'queued',
    target,
    progress: 0,
    createdAt: now,
  }
}

/** Read one job, or null when missing. */
export async function readJob(paths: LibraryPaths, jobId: string): Promise<GenerationJob | null> {
  assertSegment(jobId, 'job id')
  return readJson<GenerationJob | null>(paths.jobFile(jobId), null)
}

/** Persist one job. */
export async function writeJob(paths: LibraryPaths, job: GenerationJob): Promise<void> {
  assertSegment(job.id, 'job id')
  await writeJsonAtomic(paths.jobFile(job.id), job)
}

/** List every persisted job, newest first. */
export async function listJobs(paths: LibraryPaths, limit = 50): Promise<GenerationJob[]> {
  let entries: string[]
  try {
    entries = await readdir(paths.jobsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const jobs: GenerationJob[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const job = await readJson<GenerationJob | null>(join(paths.jobsDir, entry), null)
    if (job !== null) jobs.push(job)
  }
  jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return jobs.slice(0, limit)
}

/** A compact identity for deduplicating jobs of the same kind and target. */
export function jobKey(kind: JobKind, target: JobTarget): string {
  return [kind, target.planId ?? '', target.material ?? '', target.unit ?? '', target.concept ?? ''].join('|')
}
