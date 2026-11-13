/**
 * Adaptive practice sessions.
 *
 * One question is presented at a time. After an answer the session records the
 * attempt against the item's concepts and picks the next item: wrong answers
 * retreat to the same concept at an easier level, right answers move up or
 * across. Sessions are persisted so a page refresh does not lose the run.
 */
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryPaths } from '../core/paths.ts'
import { gradeQuizItem, pickAdaptiveNext, selectQuizItems } from '../core/quiz.ts'
import { recordAttempts } from '../core/progress.ts'
import { ratingFromScore } from '../core/srs.ts'
import { readJson, writeJsonAtomic } from '../core/store.ts'
import type {
  QuizBank,
  QuizItem,
  QuizSelfGrade,
  QuizSession,
  QuizSessionScope,
} from '../core/types.ts'
import type {
  QuizAnswerView,
  QuizFeedbackView,
  QuizItemView,
  QuizSessionSummary,
  QuizSessionView,
} from '../core/views.ts'
import type { BookService } from './books.ts'
import { StudyError, type StudyService } from './service.ts'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

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

  /** Delete sessions older than the TTL. */
  async recover(): Promise<void> {
    if (this.recovered) return
    this.recovered = true
    let entries: string[]
    try {
      entries = await readdir(this.paths.quizSessionsDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const file = join(this.paths.quizSessionsDir, entry)
      const session = await readJson<QuizSession | null>(file, null)
      if (session === null) continue
      const updated = Date.parse(session.updatedAt)
      if (!Number.isFinite(updated) || now - updated > SESSION_TTL_MS) {
        await unlink(file).catch(() => undefined)
      }
    }
  }

  /** Start a session for one unit bank. */
  async start(input: {
    material?: string
    unit?: string
    book?: string
    chapter?: string
    limit?: number
  }): Promise<QuizSessionView> {
    await this.recover()
    const scope: QuizSessionScope =
      input.book !== undefined && input.chapter !== undefined
        ? { kind: 'book', book: input.book, chapter: input.chapter }
        : { kind: 'unit', material: input.material ?? '', unit: input.unit ?? '' }
    const bank = await this.bankOf(scope)
    if (bank.items.length === 0) throw new StudyError('invalid', '这一节还没有练习题')
    const weak = new Set((await this.service.concepts()).filter(concept => concept.weak).map(concept => concept.id))
    const ranked = selectQuizItems(bank, { weakConcepts: weak, limit: bank.items.length, seed: `start:${Date.now()}` })
    const first =
      ranked.find(item => item.type === 'choice' || item.type === 'cloze') ?? ranked[0] ?? bank.items[0]!
    const session: QuizSession = {
      version: 1,
      id: `qs-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
      scope,
      status: 'active',
      limit: Math.max(1, Math.min(20, Math.round(input.limit ?? 8))),
      asked: [],
      currentId: first.id,
      history: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    if (session.currentId !== itemId) throw new StudyError('conflict', '这不是当前题目，请刷新后重试')
    const bank = await this.bankOf(session.scope)
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
      }
    }

    const correct = verdict.correct !== null ? verdict.correct : selfGrade === 'correct'
    const attempts = item.concepts.map(conceptId => ({ conceptId, correct }))
    if (attempts.length > 0) await recordAttempts(this.paths, attempts)
    session.asked.push(itemId)
    session.history.push({
      itemId,
      answer,
      correct: verdict.correct !== null ? verdict.correct : correct,
      ...(selfGrade === undefined ? {} : { selfGrade }),
      at: new Date().toISOString(),
    })
    const asked = new Set(session.asked)
    const next =
      session.asked.length >= session.limit
        ? undefined
        : pickAdaptiveNext(bank.items, { asked, current: item, correct, seed: session.id })
    if (next === undefined) {
      session.status = 'done'
      session.currentId = undefined
      session.endedAt = new Date().toISOString()
    } else {
      session.currentId = next.id
    }
    session.updatedAt = new Date().toISOString()
    await this.save(session)
    return {
      session: this.sessionMeta(session),
      feedback: this.feedbackOf(item, verdict.correct !== null ? verdict.correct : correct),
      ...(next === undefined ? {} : { next: this.itemView(next) }),
      ...(next === undefined ? { summary: await this.summaryOf(session, bank) } : {}),
    }
  }

  /** End a session early. */
  async finish(sessionId: string): Promise<QuizSessionView> {
    const session = await this.load(sessionId)
    if (session.status === 'active') {
      session.status = 'done'
      session.currentId = undefined
      session.endedAt = new Date().toISOString()
      session.updatedAt = session.endedAt
      await this.save(session)
    }
    return this.view(session, await this.bankOf(session.scope))
  }

  /** Read one session view. */
  async get(sessionId: string): Promise<QuizSessionView> {
    const session = await this.load(sessionId)
    return this.view(session, await this.bankOf(session.scope))
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

  private async load(sessionId: string): Promise<QuizSession> {
    const session = await readJson<QuizSession | null>(this.paths.quizSessionFile(sessionId), null)
    if (session === null) throw new StudyError('not-found', `练习会话不存在：${sessionId}`)
    return session
  }

  private async save(session: QuizSession): Promise<void> {
    await writeJsonAtomic(this.paths.quizSessionFile(session.id), session)
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

  private feedbackOf(item: QuizItem, correct: boolean | null): QuizFeedbackView {
    const expected =
      item.type === 'choice' && item.answerIndex !== undefined
        ? item.choices?.[item.answerIndex]
        : item.type === 'cloze'
          ? item.answer
          : item.type === 'evidence' && item.page !== undefined
            ? `p${item.page}`
            : undefined
    return {
      itemId: item.id,
      correct,
      ...(expected === undefined ? {} : { expected }),
      ...(item.rubric === undefined ? {} : { rubric: item.rubric }),
      ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
    }
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
    }
  }

  private async summaryOf(session: QuizSession, bank: QuizBank): Promise<QuizSessionSummary> {
    const objective = session.history.filter(entry => entry.correct !== null)
    const correct = objective.filter(entry => entry.correct === true).length
    const score = objective.length === 0 ? 0.5 : correct / objective.length
    const weakIds = new Set<string>()
    for (const entry of session.history) {
      if (entry.correct !== false) continue
      const item = bank.items.find(candidate => candidate.id === entry.itemId)
      for (const conceptId of item?.concepts ?? []) weakIds.add(conceptId)
    }
    const names = new Map((await this.service.concepts()).map(concept => [concept.id, concept.name]))
    return {
      asked: session.asked.length,
      correct,
      objective: objective.length,
      score,
      ratingSuggestion: ratingFromScore(score),
      weakConcepts: [...weakIds].map(id => ({ id, name: names.get(id) ?? id })),
    }
  }

  private async view(session: QuizSession, bank: QuizBank): Promise<QuizSessionView> {
    const current = session.status === 'active' ? bank.items.find(item => item.id === session.currentId) : undefined
    return {
      session: this.sessionMeta(session),
      ...(current === undefined ? {} : { item: this.itemView(current) }),
      ...(session.status === 'done' ? { summary: await this.summaryOf(session, bank) } : {}),
    }
  }
}
