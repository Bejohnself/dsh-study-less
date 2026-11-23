/**
 * The inline generation queue.
 *
 * Jobs are durable (one JSON file each) and executed with bounded concurrency.
 * The queue deduplicates active work by kind + target, so repeated clicks do not
 * spend tokens twice, and a Host restart turns interrupted jobs into an explicit
 * failure instead of a spinner that never ends.
 */
import { listJobs, newJob, readJob, writeJob, isTerminal, jobKey } from '../core/jobs.ts'
import type { LibraryPaths } from '../core/paths.ts'
import type { GenerationJob, JobKind, JobTarget, UsageAmount } from '../core/types.ts'
import { StudyError } from './service.ts'

/** What a job body can do while it runs. */
export interface JobContext {
  job: GenerationJob
  signal: AbortSignal
  report(progress: number, message?: string): void
  /** Accumulate one model call's tokens and cost on this job. */
  addUsage(usage: UsageAmount): void
}

/** A queued job body. */
export type JobBody = (context: JobContext) => Promise<unknown>

interface QueueItem {
  job: GenerationJob
  run: JobBody
}

/** The durable job queue. */
export class JobQueue {
  private readonly paths: LibraryPaths
  private readonly limit: () => number
  private readonly queued: QueueItem[] = []
  private readonly active = new Map<string, { controller: AbortController; job: GenerationJob }>()
  private readonly remembered = new Map<string, GenerationJob>()
  private readonly running = new Set<Promise<void>>()
  private lastPersist = new Map<string, number>()
  private recovered = false

  constructor(paths: LibraryPaths, options: { concurrency?: () => number } = {}) {
    this.paths = paths
    this.limit = options.concurrency ?? (() => 1)
  }

  /** Mark jobs left running by a previous Host process as interrupted. */
  async recover(): Promise<void> {
    if (this.recovered) return
    this.recovered = true
    for (const job of await listJobs(this.paths, 200)) {
      this.remembered.set(job.id, job)
      if (!isTerminal(job.status)) {
        const next: GenerationJob = {
          ...job,
          status: 'failed',
          error: 'Host 重启，任务中断；可以重新生成。',
          endedAt: new Date().toISOString(),
        }
        this.remembered.set(next.id, next)
        await writeJob(this.paths, next)
      }
    }
  }

  /** List recent jobs, including in-memory ones not yet persisted. */
  async list(recentLimit = 50): Promise<GenerationJob[]> {
    await this.recover()
    const fromDisk = await listJobs(this.paths, recentLimit * 2)
    const merged = new Map(fromDisk.map(job => [job.id, job]))
    for (const job of this.remembered.values()) merged.set(job.id, job)
    return [...merged.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, recentLimit)
  }

  /** Read one job. */
  async get(jobId: string): Promise<GenerationJob> {
    const live = this.remembered.get(jobId)
    if (live !== undefined) return live
    const job = await readJob(this.paths, jobId)
    if (job === null) throw new StudyError('not-found', `任务不存在：${jobId}`)
    this.remembered.set(job.id, job)
    return job
  }

  /** The active job for one target, if any. */
  activeFor(kind: JobKind, target: JobTarget): GenerationJob | undefined {
    const key = jobKey(kind, target)
    for (const job of this.remembered.values()) {
      if (!isTerminal(job.status) && jobKey(job.kind, job.target) === key) return job
    }
    return undefined
  }

  /** Enqueue one job and return its initial record. */
  async create(kind: JobKind, target: JobTarget, run: JobBody): Promise<GenerationJob> {
    await this.recover()
    const existing = this.activeFor(kind, target)
    if (existing !== undefined) return existing
    const job = newJob(kind, target)
    this.remembered.set(job.id, job)
    await writeJob(this.paths, job)
    this.queued.push({ job, run })
    this.pump()
    return job
  }

  /** Cancel a queued or running job. */
  async cancel(jobId: string): Promise<GenerationJob> {
    const job = await this.get(jobId)
    if (isTerminal(job.status)) return job
    const next: GenerationJob = {
      ...job,
      status: 'cancelled',
      message: '已取消',
      endedAt: new Date().toISOString(),
    }
    this.remembered.set(next.id, next)
    this.active.get(jobId)?.controller.abort()
    const index = this.queued.findIndex(item => item.job.id === jobId)
    if (index >= 0) this.queued.splice(index, 1)
    await writeJob(this.paths, next)
    return next
  }

  private pump(): void {
    const max = Math.max(1, Math.min(4, Math.round(this.limit())))
    while (this.active.size < max && this.queued.length > 0) {
      const item = this.queued.shift()
      if (item === undefined) return
      const current = this.remembered.get(item.job.id) ?? item.job
      if (isTerminal(current.status)) continue
      const controller = new AbortController()
      const running: GenerationJob = {
        ...current,
        status: 'running',
        startedAt: new Date().toISOString(),
        progress: 0,
      }
      this.active.set(running.id, { controller, job: running })
      this.remembered.set(running.id, running)
      void this.persist(running, true).then(() => {
        const task = this.execute(item, running, controller)
        this.running.add(task)
        void task.finally(() => this.running.delete(task))
      })
    }
  }

  private async execute(item: QueueItem, running: GenerationJob, controller: AbortController): Promise<void> {
    try {
      const result = await item.run({
        job: running,
        signal: controller.signal,
        report: (progress, message) => {
          running.progress = Math.max(0, Math.min(1, progress))
          if (message !== undefined) running.message = message
          this.remembered.set(running.id, running)
          void this.persist(running, false)
        },
        addUsage: usage => {
          const current = running.usage ?? {}
          const cost = current.cost === undefined && usage.cost === undefined
            ? undefined
            : (current.cost ?? 0) + (usage.cost ?? 0)
          const sources = [current.priceSource, usage.priceSource].filter(
            (source): source is NonNullable<UsageAmount['priceSource']> => source !== undefined,
          )
          const priceSource = sources.length === 0
            ? undefined
            : sources.every(source => source === sources[0]) ? sources[0] : 'mixed'
          running.usage = {
            inputTokens: (current.inputTokens ?? 0) + (usage.inputTokens ?? 0),
            cacheReadTokens: (current.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
            outputTokens: (current.outputTokens ?? 0) + (usage.outputTokens ?? 0),
            ...(cost === undefined ? {} : { cost }),
            ...(usage.currency === undefined && current.currency === undefined
              ? {}
              : { currency: usage.currency ?? current.currency }),
            ...(priceSource === undefined ? {} : { priceSource }),
          }
          this.remembered.set(running.id, running)
          void this.persist(running, false)
        },
      })
      if (controller.signal.aborted || this.remembered.get(running.id)?.status === 'cancelled') return
      const done: GenerationJob = {
        ...running,
        status: 'done',
        progress: 1,
        message: '完成',
        ...(result === undefined ? {} : { result }),
        endedAt: new Date().toISOString(),
      }
      this.remembered.set(done.id, done)
      await writeJob(this.paths, done)
    } catch (error) {
      if (controller.signal.aborted || this.remembered.get(running.id)?.status === 'cancelled') return
      const details = (error as { details?: { issues?: unknown } } | null)?.details
      const issues = Array.isArray(details?.issues)
        ? details.issues.map(String)
        : (error as { issues?: unknown } | null)?.issues
      const failed: GenerationJob = {
        ...running,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        ...(Array.isArray(issues) ? { issues: issues.map(String) } : {}),
        endedAt: new Date().toISOString(),
      }
      this.remembered.set(failed.id, failed)
      await writeJob(this.paths, failed)
    } finally {
      this.active.delete(running.id)
      this.pump()
    }
  }

  private async persist(job: GenerationJob, force: boolean): Promise<void> {
    const now = Date.now()
    const last = this.lastPersist.get(job.id) ?? 0
    if (!force && now - last < 800) return
    this.lastPersist.set(job.id, now)
    await writeJob(this.paths, job).catch(() => undefined)
  }
}
