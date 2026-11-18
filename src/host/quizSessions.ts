/**
 * Adaptive practice sessions.
 *
 * One question is presented at a time. After an answer the session records the
 * attempt, then picks the next item from the points still pending: wrong
 * answers retreat to the same concept at an easier level, right answers move up
 * or across. A unit round ends when every knowledge point passed and the model
 * confirms the section (`quizSessionEngine`); the question cap is the fallback.
 * When the bank has no question left for a pending point, the engine writes
 * 1–3 more and appends them (`quizSessionEngine.topUp`).
 *
 * Views and the final rating live in `quizSessionViews`; this module owns only
 * the run: start, answer, appeal, finish, close.
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
  DEFAULT_SESSION_LIMIT,
  conceptStatus,
  gradeQuizItem,
  isObjectiveItem,
  looksCopiedFromRubric,
  needsWrittenJudge,
  orderQuizItems,
  pickAdaptiveNext,
  sameQuizScope,
} from '../core/quiz.ts'
import { activePlan, goalTargetsForUnit, listPlans, masteryPointsFor, markMasteryPassed, readPlan } from '../core/plans.ts'
import { DEFAULT_TARGET, decayedMastery, ensureKnowledge, questionFingerprint, recordEvidence, targetOf, thresholdForLevel } from '../core/knowledge.ts'
import { recordAttempts } from '../core/progress.ts'
import { readJson, writeJsonAtomic } from '../core/store.ts'
import { localDate } from '../core/time.ts'
import type {
  QuizBank,
  QuizEndReason,
  QuizItem,
  QuizJudgeRecord,
  QuizSelfGrade,
  QuizSession,
  QuizSessionScope,
} from '../core/types.ts'
import type {
  QuizAnswerView,
  QuizSessionIndexView,
  QuizSessionSummary,
  QuizSessionView,
} from '../core/views.ts'
import type { BookService } from './books.ts'
import type { JudgeResult } from './generation.ts'
import {
  type QuizEngine,
  judgeInputOf,
  seedBank,
  sectionConfirmed,
  targetsOf,
  topUp,
} from './quizSessionEngine.ts'
import {
  answerTextOf,
  expectedAnswerOf,
  feedbackOf,
  historyOf,
  itemView,
  recordOf,
  sessionMetaOf,
  summaryOf as summaryOfSession,
} from './quizSessionViews.ts'
import { StudyError, type StudyService } from './service.ts'

export type { QuizEngine }

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
  private readonly engine?: QuizEngine
  private recovered = false

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
    plan?: string
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
      .map(session => recordOf(session))
    const targets = bank === null ? [] : await targetsOf(this.service, scope, bank)
    const goal = scope.kind === 'unit' ? activePlan(await listPlans(this.paths)) : undefined
    const inGoal =
      goal !== undefined && goalTargetsForUnit(goal, `${scope.material}:${scope.unit}`).size > 0
    return {
      bank: {
        items: bank?.items.length ?? 0,
        defaultLimit: bank === null ? 0 : Math.min(20, this.limitFor(bank, targets)),
        ...(scope.kind === 'unit' && !inGoal ? { free: true } : {}),
        notes: await this.notesOf(scope),
        ...(bank === null ? {} : { updatedAt: bank.updatedAt }),
        ...(scope.kind === 'plan' ? { mastery: await this.masteryOf(scope) } : {}),
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
    plan?: string
    limit?: number
    restart?: boolean
    /** Focus one concept (review); unit scope only. */
    concept?: string
  }): Promise<QuizSessionView> {
    await this.recover()
    const scope = this.scopeOf(input)
    if (scope.kind === 'plan') return this.startPlan(scope, input)
    let bank = await this.tryBankOf(scope)
    // A unit run belongs to the active goal: its points decide which concepts
    // are in scope and how deep they must go. Without a goal it is free
    // practice: it asks questions but writes no progress.
    const goal = scope.kind === 'unit' ? activePlan(await listPlans(this.paths)) : undefined
    let free = scope.kind === 'unit' && goal === undefined
    let review = false
    let thresholds: Record<string, number> = {}
    let targets: string[]
    if (scope.kind === 'unit' && input.concept !== undefined) {
      // Review one due concept: ask it again even if it is above target, and
      // close as soon as this point passes.
      review = true
      targets = [input.concept]
      const level = goal === undefined ? undefined : goalTargetsForUnit(goal, `${scope.material}:${scope.unit}`).get(input.concept)?.level
      const state = (await ensureKnowledge(this.paths)).concepts[input.concept]
      thresholds = {
        [input.concept]:
          level === undefined ? (state === undefined ? DEFAULT_TARGET : targetOf(state)) : thresholdForLevel(level),
      }
      free = goal === undefined
    } else if (scope.kind === 'unit' && goal !== undefined) {
      const map = goalTargetsForUnit(goal, `${scope.material}:${scope.unit}`)
      if (map.size > 0) {
        targets = [...map.keys()]
        thresholds = Object.fromEntries(
          [...map].map(([conceptId, entry]) => [conceptId, thresholdForLevel(entry.level)]),
        )
      } else {
        // A section outside the goal is free practice: questions still work,
        // but nothing is written to progress.
        free = true
        targets = await targetsOf(this.service, scope, bank)
      }
    } else {
      targets = await targetsOf(this.service, scope, bank)
    }
    if (scope.kind === 'unit' && targets.length === 0 && this.engine !== undefined) {
      // A section without knowledge points cannot be measured. Extract them
      // once, inline: the practice page is already waiting.
      try {
        const extracted = await this.engine.extractConcepts({
          material: scope.material,
          unit: scope.unit,
        })
        if (extracted.length > 0) {
          await this.service.writeConcepts(scope.material, scope.unit, extracted)
          const ids = extracted.map(concept => concept.id)
          if (goal !== undefined) {
            await this.service.attachMasteryConcepts(goal.id, `${scope.material}:${scope.unit}`, ids)
            const level = (masteryPointsFor(goal, `${scope.material}:${scope.unit}`).reduce(
              (max, point) => Math.max(max, point.level ?? 2),
              2,
            ) ?? 2) as 1 | 2 | 3 | 4
            targets = ids
            thresholds = Object.fromEntries(ids.map(conceptId => [conceptId, thresholdForLevel(level)]))
            free = false
          } else {
            targets = await targetsOf(this.service, scope, bank)
          }
        }
      } catch {
        // Fall back to the bank's concept labels; extraction is retryable.
      }
    }
    if (bank === null || bank.items.length === 0) {
      // No bank yet: open the round with one question written on demand, so a
      // session never starts from a prefabricated batch.
      const seeded = await seedBank(this.service, this.engine, scope, targets)
      if (seeded !== null) {
        bank = seeded
        targets = await targetsOf(this.service, scope, bank)
      }
    }
    if (bank === null || bank.items.length === 0) {
      throw new StudyError('not-found', scope.kind === 'unit' && this.engine === undefined
        ? '还没有练习题，也没有可用的文本引擎'
        : '这一节还没有练习题')
    }
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

    // A new run only asks what is still open: a concept already at the goal's
    // threshold does not come back until review says it decayed.
    const knowledge = await ensureKnowledge(this.paths)
    if (!free && !review) {
      const stillOpen = targets.filter(conceptId => {
        const state = knowledge.concepts[conceptId]
        return state === undefined || decayedMastery(state, localDate()) < (thresholds[conceptId] ?? DEFAULT_TARGET)
      })
      if (targets.length > 0 && stillOpen.length === 0) {
        throw new StudyError('invalid', '这一节的目标都达成了；要再练就从今日面板的到期复习进')
      }
      targets = stillOpen
    }

    const requested = Number.isFinite(input.limit) ? Math.round(input.limit as number) : undefined
    const fallback = review ? 2 : this.limitFor(bank, targets)
    const limit = Math.max(1, Math.min(20, requested ?? fallback))
    const weak = new Set(
      (await this.service.concepts()).filter(concept => concept.weak).map(concept => concept.id),
    )
    const ordered = orderQuizItems(bank, { weakConcepts: weak })
    const pending = new Set(targets)
    // Open with an objective item on a point that still has to pass; without
    // targets (book chapters) keep the old objective-first order.
    const first =
      (pending.size === 0
        ? undefined
        : (ordered.find(item => isObjectiveItem(item) && item.concepts.some(concept => pending.has(concept))) ??
          ordered.find(item => item.concepts.some(concept => pending.has(concept))))) ??
      ordered.find(isObjectiveItem) ??
      ordered[0]
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
      ...(targets.length === 0 ? {} : { targets }),
      ...(free ? { free: true } : {}),
      ...(Object.keys(thresholds).length === 0 ? {} : { targetThresholds: thresholds }),
    }
    await this.save(session)
    return this.view(session, bank)
  }

  /**
   * Start or resume a goal practice round.
   *
   * The questions are written for the unit's still-open mastery points and live
   * on the session, so a fresh round always means fresh questions and a unit
   * bank regeneration can never invalidate the run. The pass itself is written
   * to the plan by `markMasteryPassed` — one store, one writer.
   */
  private async startPlan(
    scope: Extract<QuizSessionScope, { kind: 'plan' }>,
    input: { restart?: boolean },
  ): Promise<QuizSessionView> {
    const actives = (await this.readScope(scope))
      .filter(session => session.status === 'active')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    if (input.restart === true) {
      for (const candidate of actives) await this.close(candidate, 'replaced')
    } else {
      let resumed: QuizSession | null = null
      for (const candidate of actives) {
        const reconciled = await this.reconcile(candidate, null)
        if (reconciled.status !== 'active') continue
        if (resumed === null) resumed = reconciled
        else await this.close(reconciled, 'replaced')
      }
      if (resumed !== null) {
        resumed.updatedAt = new Date().toISOString()
        await this.save(resumed)
        return this.view(resumed, null)
      }
    }

    const plan = await readPlan(this.paths, scope.plan)
    if (plan === null) throw new StudyError('not-found', '目标不存在')
    const target = `${scope.material}:${scope.unit}`
    const open = masteryPointsFor(plan, target).filter(point => point.passedAt === undefined)
    if (open.length === 0) throw new StudyError('invalid', '这一节的掌握点都过了')
    if (this.engine === undefined || !(await this.engine.textReady())) {
      throw new StudyError('unsupported', '过关测试需要可用的文本引擎：它按掌握点出题并判分')
    }
    const unit = await this.service.unit(scope.material, scope.unit)
    // Questions are grounded in the notes when they exist, otherwise in the
    // original pages: a goal point never needs a 导读 first.
    const source =
      unit.notes === null ? (await this.service.unitMaterial(scope.material, scope.unit, 24_000)).text : undefined
    const generated = await this.engine.masteryQuiz({
      goal: plan.goal,
      context: `《${unit.material.title}》·「${unit.unit.title}」`,
      pageStart: unit.unit.pageStart,
      pageEnd: unit.unit.pageEnd,
      points: open.slice(0, 6).map(point => ({
        id: point.id,
        title: point.title,
        standard: point.standard,
        concepts: point.concepts ?? [],
      })),
      ...(unit.notes === null ? {} : { notes: unit.notes }),
      ...(source === undefined ? {} : { source }),
    })
    const items = generated.items
    const first = items[0]
    if (first === undefined) throw new StudyError('invalid', '这一组没有出成题，稍后再试')
    const now = new Date().toISOString()
    const session: QuizSession = {
      version: 2,
      id: `qs-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
      scope,
      status: 'active',
      limit: Math.max(1, Math.min(20, items.length)),
      items,
      asked: [],
      currentId: first.id,
      history: [],
      startedAt: now,
      updatedAt: now,
    }
    await this.save(session)
    return this.view(session, null)
  }

  /** How many mastery points of one unit are passed, and how many are open. */
  private async masteryOf(scope: Extract<QuizSessionScope, { kind: 'plan' }>): Promise<{
    open: number
    total: number
    passed: number
  }> {
    const plan = await readPlan(this.paths, scope.plan)
    const points = plan === null ? [] : masteryPointsFor(plan, `${scope.material}:${scope.unit}`)
    const passed = points.filter(point => point.passedAt !== undefined).length
    return { open: points.length - passed, total: points.length, passed }
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
    if (reconciled.status !== 'active') {
      throw new StudyError('conflict', '题目换过了，这一组就到这里')
    }
    const items = this.itemsOf(session, bank)
    if (items.length === 0) throw new StudyError('conflict', '题目换过了，这一组就到这里')
    if (session.currentId !== itemId) throw new StudyError('conflict', '这不是当前题目，请刷新后重试')
    if (session.history.some(entry => entry.itemId === itemId)) {
      throw new StudyError('conflict', '这道题已经答过了')
    }
    const item = items.find(candidate => candidate.id === itemId)
    if (item === undefined) throw new StudyError('not-found', '题目不存在')
    if (
      needsWrittenJudge(item) &&
      selfGrade === undefined &&
      (typeof answer !== 'string' || answer.trim().length === 0)
    ) {
      throw new StudyError('invalid', '先写下你的答案')
    }

    const verdict = gradeQuizItem(item, answer)
    let judged: JudgeResult | undefined
    let judgeUnavailable: string | undefined
    // Cloze answers are written answers: an equal spelling is settled above,
    // anything else is judged by meaning, never by string equality alone.
    const written = needsWrittenJudge(item) && selfGrade === undefined && verdict.correct !== true
    if (written) {
      if (this.engine === undefined || !(await this.engine.textReady())) {
        judgeUnavailable = '没有可用的文本引擎'
      } else {
        try {
          judged = await this.engine.judgeQuizAnswer(await judgeInputOf(this.service, session.scope, item, answer))
        } catch (error) {
          judgeUnavailable = error instanceof Error ? error.message : '自动判分失败'
        }
      }
    }
    if (session.scope.kind === 'plan' && judged === undefined && selfGrade === undefined) {
      // A mastery point may only pass on a model verdict; do not fall back to
      // self-grading here or the point could be won without being checked.
      throw new StudyError('unsupported', judgeUnavailable ?? '没有可用的判分引擎')
    }
    if (needsWrittenJudge(item) && verdict.correct !== true && selfGrade === undefined && judged === undefined) {
      // Includes a cloze answer whose spelling did not match: without an
      // engine the reader grades it, the string comparison alone never fails it.
      return {
        session: sessionMetaOf(session),
        feedback: {
          itemId,
          correct: null,
          ...(item.rubric === undefined ? {} : { rubric: item.rubric }),
          ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
          ...(judgeUnavailable === undefined ? {} : { judgeUnavailable }),
          needsSelfGrade: true,
        },
        history: historyOf(session, items),
      }
    }

    const correct =
      judged !== undefined
        ? judged.verdict === 'pass'
        : verdict.correct !== null
          ? verdict.correct
          : selfGrade === 'correct'
    const at = new Date().toISOString()
    // Plan-scoped practice never writes concept mastery: the plan's mastery
    // points are its only progress store. Unit/book practice keeps the global
    // concept signal and now also the knowledge space record; the older
    // progress store is still read by the today page until it moves over.
    if (session.scope.kind !== 'plan' && session.free !== true) {
      const attempts = item.concepts.map(conceptId => ({ conceptId, correct }))
      if (attempts.length > 0) await recordAttempts(this.paths, attempts)
      if (attempts.length > 0 && selfGrade === undefined) {
        const verdict = judged !== undefined ? judged.verdict : correct ? 'pass' : 'fail'
        const fingerprint = questionFingerprint(item.question)
        for (const conceptId of item.concepts) {
          await recordEvidence(this.paths, {
            conceptId,
            fingerprint,
            verdict,
            difficulty: item.difficulty ?? 2,
            at,
          })
        }
      }
    }
    const judgedRecord: QuizJudgeRecord | undefined =
      judged === undefined
        ? undefined
        : {
            verdict: judged.verdict,
            missing: judged.missing,
            ...(judged.advice === undefined ? {} : { advice: judged.advice }),
            confidence: judged.confidence,
            engine: judged.engine,
            ...(judged.model === undefined ? {} : { model: judged.model }),
            at,
          }
    const expected = expectedAnswerOf(item)
    session.history.push({
      itemId,
      answer,
      correct,
      ...(selfGrade === undefined ? {} : { selfGrade }),
      ...(judgedRecord === undefined ? {} : { judged: judgedRecord }),
      at,
      question: item.question,
      type: item.type,
      concepts: [...item.concepts],
      ...(item.page === undefined ? {} : { page: item.page }),
      ...(item.difficulty === undefined ? {} : { difficulty: item.difficulty }),
      ...(item.masteryPoint === undefined ? {} : { masteryPoint: item.masteryPoint }),
      answerText: answerTextOf(item, answer),
      ...(expected === undefined ? {} : { expected }),
      ...(item.rubric === undefined ? {} : { rubric: [...item.rubric] }),
      ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
    })
    session.asked.push(itemId)

    if (session.scope.kind === 'plan' && judged?.verdict === 'pass' && item.masteryPoint !== undefined) {
      await markMasteryPassed(this.paths, session.scope.plan, item.masteryPoint, at)
    }
    const advanced = await this.advance(session, items, item, correct, at)
    session.updatedAt = at
    await this.save(session)
    return {
      session: sessionMetaOf(session),
      feedback: feedbackOf(item, correct, selfGrade, judgedRecord, judgeUnavailable),
      history: historyOf(session, advanced.items),
      ...(advanced.next === undefined ? {} : { next: itemView(advanced.next) }),
      ...(advanced.next === undefined ? { summary: await this.summaryOf(session, advanced.items) } : {}),
    }
  }

  /**
   * Move a session on after one answer.
   *
   * Section practice (unit) ends when every knowledge point has passed and the
   * AI confirms the section; otherwise the next item targets a pending point,
   * and a top-up is written when the bank has none left. Book chapters have no
   * target list and end on the question cap. Plan rounds keep their own items.
   */
  private async advance(
    session: QuizSession,
    items: readonly QuizItem[],
    current: QuizItem,
    correct: boolean | null,
    at: string,
  ): Promise<{ next?: QuizItem; items: QuizItem[] }> {
    const asked = new Set(session.asked)
    if (session.scope.kind === 'plan') {
      const next =
        session.asked.length >= session.limit
          ? undefined
          : pickAdaptiveNext(items, { asked, current, correct })
      if (next === undefined) {
        session.status = 'done'
        session.currentId = undefined
        session.endedAt = at
        session.endedReason = 'completed'
      } else {
        session.currentId = next.id
      }
      return next === undefined ? { items: [...items] } : { next, items: [...items] }
    }

    const targets = session.targets ?? []
    const status = targets.length === 0 ? undefined : conceptStatus(session.history, targets)
    // Passing is decided by the knowledge points plus the model's confirmation,
    // never by a question count.
    if (status?.all === true && (session.free === true || (await sectionConfirmed(this.service, this.engine, session, targets)))) {
      await this.close(session, 'completed')
      return { items: await this.itemsAfter(session) }
    }
    if (session.asked.length >= session.limit) {
      await this.close(session, 'exhausted')
      return { items: await this.itemsAfter(session) }
    }

    const pending = new Set(status === undefined ? [] : conceptStatus(session.history, targets).pending)
    // When every point already passed but the run is still short of the rating
    // minimum, ask more on the same points instead of stopping early.
    const focus = pending.size > 0 ? [...pending] : [...targets]
    let pool = await this.itemsAfter(session)
    let next = pickAdaptiveNext(pool, {
      asked,
      current,
      correct,
      ...(pending.size === 0 ? {} : { focus: pending }),
    })
    if (next === undefined && focus.length > 0 && (await topUp(this.service, this.engine, session, focus)) > 0) {
      pool = await this.itemsAfter(session)
      next = pickAdaptiveNext(pool, { asked, current, correct, focus: new Set(focus) })
    }
    if (next === undefined) {
      await this.close(session, 'exhausted')
      return { items: pool }
    }
    session.currentId = next.id
    return { next, items: pool }
  }

  /** Items of a session after the bank may have grown. */
  private async itemsAfter(session: QuizSession): Promise<QuizItem[]> {
    const bank = await this.tryBankOf(session.scope)
    return this.itemsOf(session, bank)
  }

  /**
   * Re-judge a written answer after a rebuttal.
   *
   * The reader's claim is advisory only: the model sees the original answer, the
   * previous verdict and the rebuttal, then decides again. Appeals are unlimited
   * and the last verdict wins; a changed verdict applies one compensating
   * concept attempt instead of rewriting mastery history.
   */
  async appeal(
    sessionId: string,
    itemId: string,
    reason: string,
    claim?: QuizSelfGrade,
  ): Promise<QuizSessionView> {
    const session = await this.load(sessionId)
    const entry = session.history.find(candidate => candidate.itemId === itemId)
    if (entry === undefined) throw new StudyError('not-found', '这道题还没有作答记录')
    if (entry.judged === undefined) throw new StudyError('invalid', '只有 AI 判过的题可以申诉；自评不会覆盖自评')
    if (this.engine === undefined || !(await this.engine.textReady())) {
      throw new StudyError('unsupported', '申诉需要可用的文本引擎；没有引擎时不能改判')
    }
    const text = reason.trim()
    if (text.length < 4) throw new StudyError('invalid', '写清申诉理由（至少 4 个字）')
    const scoringMaterial = [...(entry.rubric ?? []), ...(entry.explanation === undefined ? [] : [entry.explanation])]
    if (looksCopiedFromRubric(text, scoringMaterial)) {
      throw new StudyError('invalid', '复核理由不能直接抄评分要点或解析；用自己的话补上推导，或指出具体哪一步判错了')
    }

    const snapshot: QuizItem = {
      id: entry.itemId,
      type: entry.type ?? 'recall',
      question: entry.question ?? '',
      concepts: entry.concepts ?? [],
      origin: 'generated',
      ...(entry.rubric === undefined ? {} : { rubric: entry.rubric }),
      ...(entry.page === undefined ? {} : { page: entry.page }),
    }
    const judged = await this.engine.judgeQuizAnswer({
      ...(await judgeInputOf(this.service, session.scope, snapshot, entry.answer)),
      rebuttal: text,
      ...(claim === undefined ? {} : { claim }),
      previousVerdict: entry.judged.verdict,
      previousMissing: entry.judged.missing,
      ...(entry.judged.advice === undefined ? {} : { previousAdvice: entry.judged.advice }),
      ...(entry.appeals === undefined
        ? {}
        : { previousRebuttals: entry.appeals.map(appeal => appeal.reason) }),
    })

    const nextCorrect = judged.verdict === 'pass'
    const at = new Date().toISOString()
    // An appeal revises this one answer. It never writes a second concept
    // attempt (that would count one answer twice); plan mastery is updated on
    // the same monotonic rule as a first pass.
    if (session.scope.kind === 'plan' && nextCorrect && entry.masteryPoint !== undefined) {
      await markMasteryPassed(this.paths, session.scope.plan, entry.masteryPoint, at)
    }
    entry.appeals = [
      ...(entry.appeals ?? []),
      {
        reason: text,
        ...(claim === undefined ? {} : { claim }),
        from: entry.judged.verdict,
        verdict: judged.verdict,
        engine: judged.engine,
        ...(judged.model === undefined ? {} : { model: judged.model }),
        at,
      },
    ]
    entry.judged = {
      verdict: judged.verdict,
      missing: judged.missing,
      ...(judged.advice === undefined ? {} : { advice: judged.advice }),
      confidence: judged.confidence,
      engine: judged.engine,
      ...(judged.model === undefined ? {} : { model: judged.model }),
      at,
    }
    entry.correct = nextCorrect
    delete entry.selfGrade
    session.updatedAt = at
    await this.save(session)
    return this.view(session, await this.tryBankOf(session.scope))
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
    if (
      input.plan !== undefined &&
      input.plan.length > 0 &&
      input.material !== undefined &&
      input.material.length > 0 &&
      input.unit !== undefined &&
      input.unit.length > 0
    ) {
      return { kind: 'plan', plan: input.plan, material: input.material, unit: input.unit }
    }
    if (input.material !== undefined && input.material.length > 0 && input.unit !== undefined && input.unit.length > 0) {
      return { kind: 'unit', material: input.material, unit: input.unit }
    }
    throw new StudyError('invalid', '需要 mid+uid、bid+cid 或 pid+mid+uid')
  }

  /** Question cap: two per knowledge point, never below the full-session default. */
  private limitFor(bank: QuizBank, targets: readonly string[]): number {
    return Math.max(DEFAULT_SESSION_LIMIT, targets.length * 2, bank.items.length)
  }

  private async bankOf(scope: QuizSessionScope): Promise<QuizBank> {
    if (scope.kind === 'plan') throw new StudyError('unsupported', '过关测试按掌握点现场出题，不读题库')
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
    // A plan round owns its questions, so only a lost current item invalidates
    // it; a unit/book session is also invalidated when its bank is rewritten.
    if (session.scope.kind === 'plan') {
      const items = session.items ?? []
      if (!items.some(item => item.id === session.currentId)) await this.close(session, 'bank-changed')
      return session
    }
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

  /** Items of one session: a plan round owns its own, the others read a bank. */
  private itemsOf(session: QuizSession, bank: QuizBank | null): QuizItem[] {
    return session.scope.kind === 'plan' ? (session.items ?? []) : (bank?.items ?? [])
  }

  private async summaryOf(session: QuizSession, items: readonly QuizItem[]): Promise<QuizSessionSummary> {
    const names = new Map((await this.service.concepts()).map(concept => [concept.id, concept.name]))
    const openPoints = session.scope.kind === 'plan' ? (await this.masteryOf(session.scope)).open : undefined
    return summaryOfSession(session, items, names, openPoints)
  }

  private async view(session: QuizSession, bank: QuizBank | null): Promise<QuizSessionView> {
    const items = this.itemsOf(session, bank)
    if (session.status === 'active' && !items.some(item => item.id === session.currentId)) {
      await this.close(session, 'bank-changed')
    }
    const current =
      session.status === 'active' ? items.find(item => item.id === session.currentId) : undefined
    return {
      session: sessionMetaOf(session),
      ...(current === undefined ? {} : { item: itemView(current) }),
      history: historyOf(session, items),
      ...(session.status === 'done' ? { summary: await this.summaryOf(session, items) } : {}),
    }
  }
}