/**
 * Adaptive practice sessions.
 *
 * One question is presented at a time. After an answer the session records the
 * attempt against the item's concepts and picks the next item: wrong answers
 * retreat to the same concept at an easier level, right answers move up or
 * across. Sessions are persisted so a page refresh does not lose the run.
 *
 * The answer history keeps a snapshot of what was asked, because a regenerated
 * bank reuses item ids (`q1..qN`). A session also remembers the bank's
 * `updatedAt`: when the bank changes, the active session is closed instead of
 * grading an old answer against a new question.
 */
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryPaths } from '../core/paths.ts'
import {
  defaultSessionLimit,
  gradeQuizItem,
  isObjectiveItem,
  orderQuizItems,
  pickAdaptiveNext,
  sameQuizScope,
} from '../core/quiz.ts'
import { recordAttempts } from '../core/progress.ts'
import { ratingFromScore } from '../core/srs.ts'
import { readJson, writeJsonAtomic } from '../core/store.ts'
import type {
  QuizBank,
  QuizEndReason,
  QuizItem,
  QuizSelfGrade,
  QuizSession,
  QuizSessionScope,
} from '../core/types.ts'
import type {
  QuizAnswerView,
  QuizFeedbackView,
  QuizHistoryEntryView,
  QuizItemView,
  QuizSessionIndexView,
  QuizSessionRecordView,
  QuizSessionSummary,
  QuizSessionView,
} from '../core/views.ts'
import type { BookService } from './books.ts'
import { StudyError, type StudyService } from './service.ts'

/** Abandoned active sessions are cleaned up after this long. */
const ACTIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Completed sessions stay readable for this long. */
const HISTORY_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** How many past sessions one index returns. */
const RECENT_LIMIT = 10

/** The adaptive session service. */
export class QuizSessionService {
  private readonly paths: LibraryPaths
  private readonly service: StudyService
  private readonly books?: BookService
  private recovered = false

  constructor(paths: LibraryPaths, service: StudyService, books?: BookService) {
    this.paths = paths
    this.service = service
    this.books = books
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

  /**
   * The bank state and the sessions of one scope.
   *
   * The newest active session wins; older active duplicates are closed so two
   * tabs cannot silently answer into different runs.
   */
  async index(input: {
    material?: string
    unit?: string
    book?: string
    chapter?: string
  }): Promise<QuizSessionIndexView> {
    await this.recover()
    const scope = this.scopeOf(input)
    const bank = await this.tryBankOf(scope)
    const sessions = await this.readScope(scope)
    const actives = sessions
      .filter(session => session.status === 'active')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    let active: QuizSession | null = null
    for (const candidate of actives) {
      const reconciled = await this.reconcile(candidate, bank)
      if (reconciled.status !== 'active') continue
      if (active === null) active = reconciled
      else await this.close(reconciled, 'replaced')
    }
    const activeView = active === null ? null : await this.view(active, bank)
    const recent = sessions
      .filter(session => session.status === 'done')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, RECENT_LIMIT)
      .map(session => this.recordOf(session))
    return {
      bank: {
        items: bank?.items.length ?? 0,
        defaultLimit: bank === null ? 0 : defaultSessionLimit(bank),
        notes: await this.notesOf(scope),
        ...(bank === null ? {} : { updatedAt: bank.updatedAt }),
      },
      active: activeView !== null && activeView.session.status === 'active' ? activeView : null,
      recent,
    }
  }

  /**
   * Start a session, or resume this scope's active one.
   *
   * `restart: true` closes the active run as `replaced` and creates a new one;
   * the closed run keeps its history.
   */
  async start(input: {
    material?: string
    unit?: string
    book?: string
    chapter?: string
    limit?: number
    restart?: boolean
  }): Promise<QuizSessionView> {
    await this.recover()
    const scope = this.scopeOf(input)
    const bank = await this.bankOf(scope)
    if (bank.items.length === 0) throw new StudyError('invalid', '这一节还没有练习题')
    const actives = (await this.readScope(scope))
      .filter(session => session.status === 'active')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

    if (input.restart === true) {
      for (const candidate of actives) await this.close(candidate, 'replaced')
    } else {
      let resumed: QuizSession | null = null
      for (const candidate of actives) {
        const reconciled = await this.reconcile(candidate, bank)
        if (reconciled.status !== 'active') continue
        if (resumed === null) resumed = reconciled
        else await this.close(reconciled, 'replaced')
      }
      if (resumed !== null) {
        resumed.updatedAt = new Date().toISOString()
        await this.save(resumed)
        return this.view(resumed, bank)
      }
    }

    const requested = Number.isFinite(input.limit)
      ? Math.round(input.limit as number)
      : defaultSessionLimit(bank)
    const limit = Math.max(1, Math.min(20, requested, bank.items.length))
    const weak = new Set(
      (await this.service.concepts()).filter(concept => concept.weak).map(concept => concept.id),
    )
    const ordered = orderQuizItems(bank, { weakConcepts: weak })
    const first = ordered.find(isObjectiveItem) ?? ordered[0]
    if (first === undefined) throw new StudyError('invalid', '这一节还没有练习题')
    const now = new Date().toISOString()
    const session: QuizSession = {
      version: 2,
      id: `qs-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
      scope,
      status: 'active',
      limit,
      asked: [],
      currentId: first.id,
      history: [],
      startedAt: now,
      updatedAt: now,
      bankUpdatedAt: bank.updatedAt,
    }
    await this.save(session)
    return this.view(session, bank)
  }

  /** Submit one answer and advance when possible. */
  async answer(
    sessionId: string,
    itemId: string,
    answer: unknown,
    selfGrade?: QuizSelfGrade,
  ): Promise<QuizAnswerView> {
    const session = await this.load(sessionId)
    if (session.status !== 'active') throw new StudyError('conflict', '这次练习已经结束')
    const bank = await this.tryBankOf(session.scope)
    const reconciled = await this.reconcile(session, bank)
    if (reconciled.status !== 'active' || bank === null) {
      throw new StudyError('conflict', '题目换过了，这一组就到这里')
    }
    if (session.currentId !== itemId) throw new StudyError('conflict', '这不是当前题目，请刷新后重试')
    if (session.history.some(entry => entry.itemId === itemId)) {
      throw new StudyError('conflict', '这道题已经答过了')
    }
    const item = bank.items.find(candidate => candidate.id === itemId)
    if (item === undefined) throw new StudyError('not-found', '题目不存在')

    const verdict = gradeQuizItem(item, answer)
    if (verdict.correct === null && selfGrade === undefined) {
      return {
        session: this.sessionMeta(session),
        feedback: {
          itemId,
          correct: null,
          ...(item.rubric === undefined ? {} : { rubric: item.rubric }),
          ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
          needsSelfGrade: true,
        },
        history: this.historyOf(session, bank),
      }
    }

    const correct = verdict.correct !== null ? verdict.correct : selfGrade === 'correct'
    const attempts = item.concepts.map(conceptId => ({ conceptId, correct }))
    if (attempts.length > 0) await recordAttempts(this.paths, attempts)

    const at = new Date().toISOString()
    const expected = this.expectedOf(item)
    session.history.push({
      itemId,
      answer,
      correct: verdict.correct !== null ? verdict.correct : correct,
      ...(selfGrade === undefined ? {} : { selfGrade }),
      at,
      question: item.question,
      type: item.type,
      concepts: [...item.concepts],
      answerText: this.answerTextOf(item, answer),
      ...(expected === undefined ? {} : { expected }),
      ...(item.rubric === undefined ? {} : { rubric: [...item.rubric] }),
      ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
    })
    session.asked.push(itemId)

    const asked = new Set(session.asked)
    const next =
      session.asked.length >= session.limit
        ? undefined
        : pickAdaptiveNext(bank.items, {
            asked,
            current: item,
            correct: verdict.correct !== null ? verdict.correct : correct,
          })
    if (next === undefined) {
      session.status = 'done'
      session.currentId = undefined
      session.endedAt = at
      session.endedReason = 'completed'
    } else {
      session.currentId = next.id
    }
    session.updatedAt = at
    await this.save(session)
    return {
      session: this.sessionMeta(session),
      feedback: this.feedbackOf(item, verdict.correct !== null ? verdict.correct : correct, selfGrade),
      history: this.historyOf(session, bank),
      ...(next === undefined ? {} : { next: this.itemView(next) }),
      ...(next === undefined ? { summary: await this.summaryOf(session, bank) } : {}),
    }
  }

  /** End a session early. */
  async finish(sessionId: string): Promise<QuizSessionView> {
    const session = await this.load(sessionId)
    if (session.status === 'active') await this.close(session, 'finished')
    return this.view(session, await this.tryBankOf(session.scope))
  }

  /** Read one session view. */
  async get(sessionId: string): Promise<QuizSessionView> {
    const session = await this.load(sessionId)
    const bank = await this.tryBankOf(session.scope)
    return this.view(await this.reconcile(session, bank), bank)
  }

  /** Build a scope from the loose route input. */
  private scopeOf(input: {
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
    throw new StudyError('invalid', '需要 mid+uid 或 bid+cid')
  }

  private async bankOf(scope: QuizSessionScope): Promise<QuizBank> {
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
  private async tryBankOf(scope: QuizSessionScope): Promise<QuizBank | null> {
    try {
      return await this.bankOf(scope)
    } catch (error) {
      if (error instanceof StudyError && (error.code === 'not-found' || error.code === 'unsupported')) {
        return null
      }
      throw error
    }
  }

  private async notesOf(scope: QuizSessionScope): Promise<boolean> {
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
  private async reconcile(session: QuizSession, bank: QuizBank | null): Promise<QuizSession> {
    if (session.status !== 'active') return session
    const changed =
      bank === null || (session.bankUpdatedAt !== undefined && session.bankUpdatedAt !== bank.updatedAt)
    const missing = bank !== null && !bank.items.some(item => item.id === session.currentId)
    if (changed || missing) await this.close(session, 'bank-changed')
    return session
  }

  private async close(session: QuizSession, reason: QuizEndReason): Promise<void> {
    if (session.status !== 'active') return
    const at = new Date().toISOString()
    session.status = 'done'
    session.currentId = undefined
    session.endedAt = at
    session.endedReason = reason
    session.updatedAt = at
    await this.save(session)
  }

  private async load(sessionId: string): Promise<QuizSession> {
    const raw = await readJson<QuizSession | null>(this.paths.quizSessionFile(sessionId), null)
    if (raw === null) throw new StudyError('not-found', `练习会话不存在：${sessionId}`)
    return {
      ...raw,
      version: 2,
      asked: raw.asked ?? [],
      history: raw.history ?? [],
    }
  }

  private async save(session: QuizSession): Promise<void> {
    await writeJsonAtomic(this.paths.quizSessionFile(session.id), session)
  }

  /** All session files, without parsing them. */
  private async sessionFiles(): Promise<Array<{ name: string; file: string }>> {
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
  private async readFile(file: string): Promise<QuizSession | null> {
    try {
      return await readJson<QuizSession | null>(file, null)
    } catch {
      return null
    }
  }

  /** Sessions belonging to one scope, oldest or newest first. */
  private async readScope(scope: QuizSessionScope): Promise<QuizSession[]> {
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

  private expired(session: QuizSession, now: number): boolean {
    const updated = Date.parse(session.updatedAt)
    if (!Number.isFinite(updated)) return true
    return now - updated > (session.status === 'active' ? ACTIVE_TTL_MS : HISTORY_TTL_MS)
  }

  private itemView(item: QuizItem): QuizItemView {
    return {
      id: item.id,
      type: item.type,
      question: item.question,
      ...(item.choices === undefined ? {} : { choices: item.choices }),
      concepts: item.concepts,
      ...(item.page === undefined ? {} : { page: item.page }),
      ...(item.difficulty === undefined ? {} : { difficulty: item.difficulty }),
    }
  }

  private expectedOf(item: QuizItem): string | undefined {
    if (item.type === 'choice' && item.answerIndex !== undefined) return item.choices?.[item.answerIndex]
    if (item.type === 'cloze') return item.answer
    if (item.type === 'evidence' && item.page !== undefined) return `p${item.page}`
    return undefined
  }

  private answerTextOf(item: QuizItem | undefined, answer: unknown): string {
    if (item?.type === 'choice' && typeof answer === 'number') {
      return item.choices?.[answer] ?? String(answer)
    }
    if (typeof answer === 'string') {
      const text = answer.trim()
      return text.length === 0 ? '（没写）' : text
    }
    if (answer === undefined || answer === null) return '（没写）'
    return String(answer)
  }

  private feedbackOf(item: QuizItem, correct: boolean | null, selfGrade?: QuizSelfGrade): QuizFeedbackView {
    const expected = this.expectedOf(item)
    return {
      itemId: item.id,
      correct,
      ...(selfGrade === undefined ? {} : { selfGrade }),
      ...(expected === undefined ? {} : { expected }),
      ...(item.rubric === undefined ? {} : { rubric: item.rubric }),
      ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
    }
  }

  private historyOf(session: QuizSession, bank: QuizBank | null): QuizHistoryEntryView[] {
    return session.history.map(entry => {
      const item = bank?.items.find(candidate => candidate.id === entry.itemId)
      const expected = entry.expected ?? (item === undefined ? undefined : this.expectedOf(item))
      const rubric = entry.rubric ?? item?.rubric
      const explanation = entry.explanation ?? item?.explanation
      return {
        itemId: entry.itemId,
        question: entry.question ?? item?.question ?? entry.itemId,
        type: entry.type ?? item?.type ?? 'recall',
        answerText: entry.answerText ?? this.answerTextOf(item, entry.answer),
        correct: entry.correct,
        ...(entry.selfGrade === undefined ? {} : { selfGrade: entry.selfGrade }),
        ...(expected === undefined ? {} : { expected }),
        ...(rubric === undefined ? {} : { rubric }),
        ...(explanation === undefined ? {} : { explanation }),
        at: entry.at,
      }
    })
  }

  private sessionMeta(session: QuizSession): QuizSessionView['session'] {
    const objective = session.history.filter(entry => entry.correct !== null).length
    const correct = session.history.filter(entry => entry.correct === true).length
    return {
      id: session.id,
      status: session.status,
      asked: session.asked.length,
      limit: session.limit,
      correct,
      objective,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      ...(session.endedReason === undefined ? {} : { endedReason: session.endedReason }),
    }
  }

  private scoreOf(session: QuizSession): { objective: number; correct: number; score: number } {
    const objective = session.history.filter(entry => entry.correct !== null)
    const correct = objective.filter(entry => entry.correct === true).length
    return {
      objective: objective.length,
      correct,
      score: objective.length === 0 ? 0.5 : correct / objective.length,
    }
  }

  private recordOf(session: QuizSession): QuizSessionRecordView {
    const { objective, correct, score } = this.scoreOf(session)
    return {
      id: session.id,
      status: session.status,
      asked: session.asked.length,
      limit: session.limit,
      correct,
      objective,
      score,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      ...(session.endedAt === undefined ? {} : { endedAt: session.endedAt }),
      ...(session.endedReason === undefined ? {} : { endedReason: session.endedReason }),
    }
  }

  private async summaryOf(session: QuizSession, bank: QuizBank | null): Promise<QuizSessionSummary> {
    const { objective, correct, score } = this.scoreOf(session)
    const weakIds = new Set<string>()
    for (const entry of session.history) {
      if (entry.correct !== false) continue
      const item = bank?.items.find(candidate => candidate.id === entry.itemId)
      for (const conceptId of entry.concepts ?? item?.concepts ?? []) weakIds.add(conceptId)
    }
    const names = new Map((await this.service.concepts()).map(concept => [concept.id, concept.name]))
    return {
      asked: session.asked.length,
      correct,
      objective,
      score,
      ratingSuggestion: ratingFromScore(score),
      weakConcepts: [...weakIds].map(id => ({ id, name: names.get(id) ?? id })),
    }
  }

  private async view(session: QuizSession, bank: QuizBank | null): Promise<QuizSessionView> {
    if (
      session.status === 'active' &&
      (bank === null || !bank.items.some(item => item.id === session.currentId))
    ) {
      await this.close(session, 'bank-changed')
    }
    const current =
      session.status === 'active' ? bank?.items.find(item => item.id === session.currentId) : undefined
    return {
      session: this.sessionMeta(session),
      ...(current === undefined ? {} : { item: this.itemView(current) }),
      history: this.historyOf(session, bank),
      ...(session.status === 'done' ? { summary: await this.summaryOf(session, bank) } : {}),
    }
  }
}