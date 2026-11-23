/**
 * Adaptive practice sessions: storage, scope and bank resolution.
 *
 * Split from quizSessions.ts so the run logic (start, answer, appeal, finish)
 * stays readable. Nothing here knows about answering; it loads and saves the
 * session files, works out what a scope measures and projects the view.
 */
import {readdir, unlink} from 'node:fs/promises'
import {join} from 'node:path'
import type {LibraryPaths} from '../core/paths.ts'
import {DEFAULT_SESSION_LIMIT, sameQuizScope} from '../core/quiz.ts'
import {activePlan, goalLevelOf, listPlans} from '../core/plans.ts'
import {DEFAULT_TARGET, ensureKnowledge, sectionPointStates, thresholdForLevel} from '../core/knowledge.ts'
import {listConcepts} from '../core/concepts.ts'
import {readJson, writeJsonAtomic} from '../core/store.ts'
import {localDate} from '../core/time.ts'
import type {MasteryLevel, PlanRecord, QuizBank, QuizEndReason, QuizItem, QuizSession, QuizSessionScope} from '../core/types.ts'
import type {QuizBlockReason, QuizPointView, QuizSessionView} from '../core/views.ts'
import type {BookService} from './books.ts'

import {answeredOf, historyOf, itemView, sessionMetaOf, summaryOf as summaryOfSession} from './quizSessionViews.ts'
import {StudyError, type StudyService} from './service.ts'

import type {QuizEngine} from './quizSessionEngine.ts'
export type { QuizEngine }

/** Abandoned active sessions are cleaned up after this long. */
const ACTIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Completed sessions stay readable for this long. */
const HISTORY_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** How many past sessions one index returns. */
export const RECENT_LIMIT = 10

/** Why a section cannot be practiced, said the way the page needs it. */
export function blockMessage(reason: QuizBlockReason): string {
  if (reason === 'no-goal') return '还没有学习目标：先建一个目标，练习才会写进度'
  if (reason === 'outside-goal') return '这一节不在当前目标里：先把它加进目标'
  return '这一节还没有知识点：在目标页补知识点后再来练'
}

/** What one run measures: the points, how deep, and whether it may run at all. */
export interface SessionPlan {
  targets: string[]
  thresholds: Record<string, number>
  /** Practice is goal-only: set when this section cannot run, with the reason. */
  blocked?: QuizBlockReason
  /** A goal covers this section but it carries no knowledge points yet. */
  needsConcepts: boolean
  /** Focused review of one due concept: closes on its first passing answer. */
  review: boolean
  goal?: PlanRecord
  level?: MasteryLevel
}

/** The adaptive session service. */

export class QuizSessionBase {
  protected readonly paths: LibraryPaths
  protected readonly service: StudyService
  protected readonly books?: BookService
  protected readonly engine?: QuizEngine
  protected recovered = false

  constructor(paths: LibraryPaths, service: StudyService, books?: BookService, engine?: QuizEngine) {
    this.paths = paths
    this.service = service
    this.books = books
    this.engine = engine
  }

  /** Delete sessions that are too old to be useful. */
  async recover(): Promise<void> {
    if (this.recovered) return
    this.recovered = true
    const now = Date.now()
    for (const { file } of await this.sessionFiles()) {
      const session = await this.readFile(file)
      if (session === null) continue
      const updated = Date.parse(session.updatedAt)
      if (!Number.isFinite(updated)) continue
      const ttl = session.status === 'active' ? ACTIVE_TTL_MS : HISTORY_TTL_MS
      if (now - updated > ttl) await unlink(file).catch(() => undefined)
    }
  }

  protected async sectionConcepts(material: string, unit: string): Promise<string[]> {
    try {
      return (await this.service.unit(material, unit)).unit.concepts ?? []
    } catch {
      return []
    }
  }

  /**
   * What one run of this scope measures.
   *
   * The single read of goal coverage: the index, start and the resume path all
   * agree on which points are in scope, how deep they must go, and whether the
   * run may start at all. Practice is goal-only — a section no goal covers is
   * blocked, not downgraded to a run that writes nothing; a section the goal
   * covers but without points is blocked until the points are written.
   */
  protected async sessionPlanOf(scope: QuizSessionScope, concept: string | undefined): Promise<SessionPlan> {
    if (scope.kind !== 'unit') {
      return { targets: [], thresholds: {}, needsConcepts: false, review: false }
    }
    const key = `${scope.material}:${scope.unit}`
    const goal = activePlan(await listPlans(this.paths))
    const covered =
      goal !== undefined && goal.steps.some(step => step.target === key && step.coverage !== 'skip')
    const concepts = await this.sectionConcepts(scope.material, scope.unit)
    if (goal === undefined) {
      return { targets: [], thresholds: {}, blocked: 'no-goal', needsConcepts: false, review: false }
    }
    if (concept !== undefined) {
      const level = covered ? goalLevelOf(goal, key) : undefined
      return {
        targets: [concept],
        thresholds: { [concept]: level === undefined ? DEFAULT_TARGET : thresholdForLevel(level) },
        ...(covered ? {} : { blocked: 'outside-goal' as const }),
        needsConcepts: false,
        review: true,
        goal,
        ...(level === undefined ? {} : { level }),
      }
    }
    if (!covered) {
      return { targets: [], thresholds: {}, blocked: 'outside-goal', needsConcepts: false, review: false, goal }
    }
    if (concepts.length === 0) {
      return { targets: [], thresholds: {}, needsConcepts: true, review: false, goal }
    }
    const level = goalLevelOf(goal, key)
    return {
      targets: concepts,
      thresholds: Object.fromEntries(concepts.map(id => [id, thresholdForLevel(level)])),
      needsConcepts: false,
      review: false,
      goal,
      level,
    }
  }

  /** Ledger state of one explicit point set, weakest name fallback included. */
  protected async pointsFor(targets: readonly string[], thresholds: Readonly<Record<string, number>>): Promise<QuizPointView[]> {
    if (targets.length === 0) return []
    const [knowledge, records] = await Promise.all([ensureKnowledge(this.paths), listConcepts(this.paths)])
    const names = new Map(records.map(record => [record.id, record.name]))
    return sectionPointStates(targets, thresholds, knowledge, names, localDate())
  }

  /** Ledger state of one run, plus the latest verdict it produced per point. */
  protected async pointsOf(session: QuizSession): Promise<QuizPointView[]> {
    const points = await this.pointsFor(session.targets ?? [], session.targetThresholds ?? {})
    if (points.length === 0) return points
    return points.map(point => {
      const answered = answeredOf(session, point.id)
      return answered === undefined ? point : { ...point, answered }
    })
  }

  /** Build a scope from the loose route input. */
  protected scopeOf(input: {
    material?: string
    unit?: string
    book?: string
    chapter?: string
  }): QuizSessionScope {
    if (input.book !== undefined && input.book.length > 0 && input.chapter !== undefined && input.chapter.length > 0) {
      return { kind: 'book', book: input.book, chapter: input.chapter }
    }
    if (input.material !== undefined && input.material.length > 0 && input.unit !== undefined && input.unit.length > 0) {
      return { kind: 'unit', material: input.material, unit: input.unit }
    }
    throw new StudyError('invalid', '需要 mid+uid、bid+cid 或 pid+mid+uid')
  }

  /** Question cap: two per knowledge point, never below the full-session default. */
  protected limitFor(bank: QuizBank, targets: readonly string[]): number {
    return Math.max(DEFAULT_SESSION_LIMIT, targets.length * 2, bank.items.length)
  }

  protected async bankOf(scope: QuizSessionScope): Promise<QuizBank> {
    if (scope.kind === 'unit') {
      const bank = await this.service.quiz(scope.material, scope.unit)
      if (bank === null) throw new StudyError('not-found', '这一节还没有练习题')
      return bank
    }
    if (this.books === undefined) throw new StudyError('unsupported', '自编书练习未启用')
    const bank = await this.books.chapterQuiz(scope.book, scope.chapter ?? '')
    if (bank === null) throw new StudyError('not-found', '这一章还没有练习题')
    return bank
  }

  /** The bank when it still exists; null is a normal state for history views. */
  protected async tryBankOf(scope: QuizSessionScope): Promise<QuizBank | null> {
    try {
      return await this.bankOf(scope)
    } catch (error) {
      if (error instanceof StudyError && (error.code === 'not-found' || error.code === 'unsupported')) {
        return null
      }
      throw error
    }
  }

  protected async notesOf(scope: QuizSessionScope): Promise<boolean> {
    if (scope.kind !== 'unit') return true
    try {
      return await this.service.hasNotes(scope.material, scope.unit)
    } catch {
      return false
    }
  }

  /**
   * Close an active session when its bank changed or the current item is gone.
   * The history is kept; only the run is over.
   */
  protected async reconcile(session: QuizSession, bank: QuizBank | null): Promise<QuizSession> {
    if (session.status !== 'active') return session
    const changed =
      bank === null || (session.bankUpdatedAt !== undefined && session.bankUpdatedAt !== bank.updatedAt)
    const missing = bank !== null && !bank.items.some(item => item.id === session.currentId)
    if (changed || missing) await this.close(session, 'bank-changed')
    return session
  }

  protected async close(session: QuizSession, reason: QuizEndReason): Promise<void> {
    if (session.status !== 'active') return
    const at = new Date().toISOString()
    session.status = 'done'
    session.currentId = undefined
    session.endedAt = at
    session.endedReason = reason
    session.updatedAt = at
    await this.save(session)
  }

  protected async load(sessionId: string): Promise<QuizSession> {
    const raw = await readJson<QuizSession | null>(this.paths.quizSessionFile(sessionId), null)
    if (raw === null) throw new StudyError('not-found', `练习会话不存在：${sessionId}`)
    return {
      ...raw,
      version: 2,
      asked: raw.asked ?? [],
      history: raw.history ?? [],
    }
  }

  protected async save(session: QuizSession): Promise<void> {
    await writeJsonAtomic(this.paths.quizSessionFile(session.id), session)
  }

  /** All session files, without parsing them. */
  protected async sessionFiles(): Promise<Array<{ name: string; file: string }>> {
    let entries: string[]
    try {
      entries = await readdir(this.paths.quizSessionsDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return entries
      .filter(entry => entry.endsWith('.json'))
      .map(entry => ({ name: entry, file: join(this.paths.quizSessionsDir, entry) }))
  }

  /** Read one session file, ignoring unreadable or corrupt files. */
  protected async readFile(file: string): Promise<QuizSession | null> {
    try {
      return await readJson<QuizSession | null>(file, null)
    } catch {
      return null
    }
  }

  /** Sessions belonging to one scope, oldest or newest first. */
  protected async readScope(scope: QuizSessionScope): Promise<QuizSession[]> {
    const out: QuizSession[] = []
    const now = Date.now()
    for (const { file } of await this.sessionFiles()) {
      const raw = await this.readFile(file)
      if (raw === null || raw.scope === undefined) continue
      if (!sameQuizScope(raw.scope, scope)) continue
      if (this.expired(raw, now)) continue
      out.push({ ...raw, version: 2, asked: raw.asked ?? [], history: raw.history ?? [] })
    }
    return out
  }

  protected expired(session: QuizSession, now: number): boolean {
    const updated = Date.parse(session.updatedAt)
    if (!Number.isFinite(updated)) return true
    return now - updated > (session.status === 'active' ? ACTIVE_TTL_MS : HISTORY_TTL_MS)
  }

  /** Items of one session, always read from the section's bank. */
  protected itemsOf(session: QuizSession, bank: QuizBank | null): QuizItem[] {
    return bank?.items ?? []
  }

  protected async view(session: QuizSession, bank: QuizBank | null): Promise<QuizSessionView> {
    const items = this.itemsOf(session, bank)
    if (session.status === 'active' && !items.some(item => item.id === session.currentId)) {
      await this.close(session, 'bank-changed')
    }
    const current =
      session.status === 'active' ? items.find(item => item.id === session.currentId) : undefined
    const points = await this.pointsOf(session)
    return {
      session: sessionMetaOf(session, points),
      points,
      ...(current === undefined ? {} : { item: itemView(current) }),
      history: historyOf(session, items),
      ...(session.status === 'done' ? { summary: summaryOfSession(session, points) } : {}),
    }
  }
}
