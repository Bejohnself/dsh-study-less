/**
 * Adaptive practice sessions: storage, scope and views.
 *
 * Split from quizSessions.ts so the run logic (start, answer, appeal, finish)
 * stays readable. Nothing here knows about answering; it loads and saves the
 * session files, works out what a scope measures and projects the view.
 *
 * A run holds one question at a time. There is no bank and no per-question
 * history: what an answer proved lives in `knowledge.json`.
 */
import {readdir, unlink} from 'node:fs/promises'
import {join} from 'node:path'
import type {LibraryPaths} from '../core/paths.ts'
import {sameQuizScope} from '../core/quiz.ts'
import {splitUnitKey} from '../core/ids.ts'
import {activePlan, goalLevelOf, listPlans} from '../core/plans.ts'
import {DEFAULT_TARGET, ensureKnowledge, sectionPointStates, thresholdForLevel} from '../core/knowledge.ts'
import {listConcepts} from '../core/concepts.ts'
import {readJson, writeJsonAtomic} from '../core/store.ts'
import type {MasteryLevel, PlanRecord, QuizEndReason, QuizSession, QuizSessionScope} from '../core/types.ts'
import type {QuizBlockReason, QuizPointView, QuizSessionView} from '../core/views.ts'

import {feedbackOfEntry, itemView, sessionMetaOf, summaryOf as summaryOfSession} from './quizSessionViews.ts'
import {StudyError, type StudyService} from './service.ts'

import type {QuizEngine} from './quizSessionEngine.ts'
export type { QuizEngine }

/** Abandoned active sessions are cleaned up after this long. */
const ACTIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Finished sessions stay readable for this long. */
const HISTORY_TTL_MS = 90 * 24 * 60 * 60 * 1000

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
  protected readonly engine?: QuizEngine
  protected recovered = false

  constructor(paths: LibraryPaths, service: StudyService, engine?: QuizEngine) {
    this.paths = paths
    this.service = service
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
   * Deepest level this goal asks of one concept across the sections carrying it.
   *
   * A focused review must use this, not the section it was opened from: the
   * same point often sits in a level-1 and a level-3 section, and the goal asks
   * for the harder one. Section runs keep their own section's level.
   */
  protected async conceptLevelInGoal(goal: PlanRecord, concept: string): Promise<MasteryLevel | undefined> {
    let level: MasteryLevel | undefined
    for (const step of goal.steps) {
      if (step.target === undefined || step.coverage === 'skip') continue
      const { materialId, unitId } = splitUnitKey(step.target)
      let concepts: string[]
      try {
        concepts = (await this.service.unit(materialId, unitId)).unit.concepts ?? []
      } catch {
        continue
      }
      if (!concepts.includes(concept)) continue
      const stepLevel = step.level ?? 2
      if (level === undefined || stepLevel > level) level = stepLevel
    }
    return level
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
  protected async sessionPlanOf(scope: {material: string; unit: string}, concept: string | undefined): Promise<SessionPlan> {
    const key = `${scope.material}:${scope.unit}`
    const goal = activePlan(await listPlans(this.paths))
    const covered =
      goal !== undefined && goal.steps.some(step => step.target === key && step.coverage !== 'skip')
    const concepts = await this.sectionConcepts(scope.material, scope.unit)
    if (goal === undefined) {
      return { targets: [], thresholds: {}, blocked: 'no-goal', needsConcepts: false, review: false }
    }
    if (concept !== undefined) {
      const level = covered
        ? (await this.conceptLevelInGoal(goal, concept)) ?? goalLevelOf(goal, key)
        : undefined
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

  /** Ledger state of one explicit point set, with names. */
  protected async pointsFor(targets: readonly string[], thresholds: Readonly<Record<string, number>>): Promise<QuizPointView[]> {
    if (targets.length === 0) return []
    const [knowledge, records] = await Promise.all([ensureKnowledge(this.paths), listConcepts(this.paths)])
    const names = new Map(records.map(record => [record.id, record.name]))
    // Read the same clock today does, so the test clock's offset decays these
    // points too instead of showing undecayed mastery on a later day.
    return sectionPointStates(targets, thresholds, knowledge, names, this.service.today())
  }

  /** Ledger state of one run. */
  protected async pointsOf(session: QuizSession): Promise<QuizPointView[]> {
    return this.pointsFor(session.targets ?? [], session.targetThresholds ?? {})
  }

  /** Build a scope from the loose route input. */
  protected scopeOf(input: {
    material?: string
    unit?: string
    book?: string
    chapter?: string
  }): { kind: 'unit'; material: string; unit: string } {
    if (input.material !== undefined && input.material.length > 0 && input.unit !== undefined && input.unit.length > 0) {
      return { kind: 'unit', material: input.material, unit: input.unit }
    }
    throw new StudyError('invalid', '需要 mid+uid：练习只在一节的原文上跑')
  }

  protected async close(session: QuizSession, reason: QuizEndReason, note?: string): Promise<void> {
    if (session.status !== 'active') return
    const at = new Date().toISOString()
    session.status = 'done'
    session.current = undefined
    session.endedAt = at
    session.endedReason = reason
    if (note !== undefined) session.endedNote = note
    session.updatedAt = at
    await this.save(session)
  }

  protected async load(sessionId: string): Promise<QuizSession> {
    const session = await this.readFile(this.paths.quizSessionFile(sessionId))
    if (session === null) throw new StudyError('not-found', `练习会话不存在：${sessionId}`)
    return session
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
      const raw = await readJson<QuizSession | null>(file, null)
      if (raw === null) return null
      const {session, migrated} = normalizeSession(raw)
      // A batch-era run is closed on disk too, so two readers agree on it.
      if (migrated) await writeJsonAtomic(file, session)
      return session
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
      out.push(raw)
    }
    return out
  }

  protected expired(session: QuizSession, now: number): boolean {
    const updated = Date.parse(session.updatedAt)
    if (!Number.isFinite(updated)) return true
    return now - updated > (session.status === 'active' ? ACTIVE_TTL_MS : HISTORY_TTL_MS)
  }

  protected async view(session: QuizSession): Promise<QuizSessionView> {
    const points = await this.pointsOf(session)
    const current = session.status === 'active' ? session.current : undefined
    return {
      session: sessionMetaOf(session, points),
      points,
      ...(current === undefined
        ? {}
        : { item: itemView(current), ...(session.currentUsage === undefined ? {} : { usage: session.currentUsage }) }),
      ...(session.last === undefined ? {} : { last: feedbackOfEntry(session.last) }),
      ...(session.status === 'done' ? { summary: summaryOfSession(session, points) } : {}),
    }
  }
}

/**
 * Bring an older session file up to the cursor shape.
 *
 * Runs written before practice became one question at a time kept a bank, a
 * question cap and a per-question history. Those fields are dropped: answered
 * questions are not stored any more. Such a run cannot be resumed either (its
 * current question went with the bank), so it is closed as `replaced`. A v3
 * run with no current question is *not* legacy: its answer was graded and the
 * next question has not been written yet.
 */
function normalizeSession(raw: QuizSession): { session: QuizSession; migrated: boolean } {
  const legacy = raw as QuizSession & {
    asked?: string[]
    limit?: number
    history?: unknown[]
    currentId?: string
    bankUpdatedAt?: string
    free?: boolean
    freeReason?: string
  }
  const {
    asked,
    limit,
    history,
    currentId,
    bankUpdatedAt,
    free,
    freeReason,
    ...rest
  } = legacy
  void [asked, limit, history, currentId, bankUpdatedAt, free, freeReason]
  const count = raw.count ?? asked?.length ?? 0
  if (raw.version !== 3 && raw.status === 'active' && raw.current === undefined) {
    const at = new Date().toISOString()
    return {
      session: {...rest, version: 3, status: 'done', count, current: undefined, endedAt: raw.endedAt ?? at, endedReason: 'replaced', updatedAt: at},
      migrated: true,
    }
  }
  return {session: {...rest, version: 3, count}, migrated: raw.version !== 3 || raw.count === undefined}
}
