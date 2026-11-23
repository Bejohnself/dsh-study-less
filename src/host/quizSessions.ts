/**
 * Adaptive practice sessions: the run.
 *
 * One question is presented at a time. After an answer the session records the
 * attempt, then picks the next item from the points still open: wrong answers
 * retreat to the same concept at an easier level, right answers move up or
 * across. A unit round ends when every point it measures reaches the goal
 * threshold in the one ledger (`knowledge.json`); the question cap is the
 * fallback. A spent bank is topped up when the next round starts, never inside
 * an answer request.
 *
 * Storage, bank lookup and scope resolution live in `quizSessionBase`; views and
 * the final rating live in `quizSessionViews`. This module owns only the run.
 */

import {join} from 'node:path'

import {conceptStatus, gradeQuizItem, isObjectiveItem, looksCopiedFromRubric, needsWrittenJudge, orderQuizItems, pickAdaptiveNext} from '../core/quiz.ts'

import {APPEAL_WEIGHT, DEFAULT_TARGET, decayedMastery, ensureKnowledge, questionFingerprint, recordEvidence} from '../core/knowledge.ts'

import {daysBetween, localDate} from '../core/time.ts'
import type {QuizItem, QuizJudgeRecord, QuizSelfGrade, QuizSession, QuizSessionEntry, QuizSessionScope} from '../core/types.ts'
import type {QuizAnswerView, QuizPointView, QuizReferenceView, QuizSessionIndexView, QuizSessionView} from '../core/views.ts'

import type {JudgeResult} from './generation.ts'
import {appendQuestions, judgeInputOf, seedBank} from './quizSessionEngine.ts'
import {answerTextOf, expectedAnswerOf, feedbackOf, historyOf, itemView, recordOf, sessionMetaOf, summaryOf as summaryOfSession} from './quizSessionViews.ts'
import {StudyError} from './service.ts'

export type { QuizEngine } from './quizSessionEngine.ts'

import {QuizSessionBase, RECENT_LIMIT, blockMessage} from './quizSessionBase.ts'

export class QuizSessionService extends QuizSessionBase {
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
    /** Focus one concept (review); unit scope only. */
    concept?: string
  }): Promise<QuizSessionView> {
    await this.recover()
    const scope = this.scopeOf(input)
    let bank = await this.tryBankOf(scope)
    const plan = await this.sessionPlanOf(scope, input.concept)
    let targets = plan.targets
    let thresholds = plan.thresholds
    const review = plan.review
    const goal = plan.goal

    if (plan.needsConcepts && scope.kind === 'unit') {
      // A goal covers this section but it has no knowledge points yet. Extract
      // them once, inline: without points there is nothing to measure, and the
      // run is refused rather than downgraded to one that writes nothing.
      let filled = false
      if (this.engine !== undefined && (await this.engine.textReady())) {
        try {
          const extracted = await this.engine.extractConcepts({ material: scope.material, unit: scope.unit })
          if (extracted.length > 0) {
            await this.service.writeConcepts(scope.material, scope.unit, extracted)
            filled = true
          }
        } catch {
          // Retryable: the reader gets the reason below.
        }
      }
      if (!filled) throw new StudyError('invalid', blockMessage('no-concepts'))
      const fresh = await this.sessionPlanOf(scope, input.concept)
      targets = fresh.targets
      thresholds = fresh.thresholds
    }
    if (plan.blocked !== undefined) throw new StudyError('invalid', blockMessage(plan.blocked))
    if (bank === null || bank.items.length === 0) {
      // No bank yet: open the round with one question written on demand, so a
      // session never starts from a prefabricated batch.
      const seeded = await seedBank(this.service, this.engine, scope, targets)
      if (seeded !== null) bank = seeded
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
        // Legacy free runs cannot be resumed: they measured nothing, so
        // continuing one would hand out answers that write no progress.
        if (candidate.free === true) {
          await this.close(candidate, 'replaced')
          continue
        }
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
    if (!review) {
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
    // A knowledge point is tested by a question once. Unused questions only:
    // re-offering a spent one would add no evidence and waste the round.
    const used = await this.usedQuestions(scope)
    let candidates = ordered.filter(item => !used(item))
    if (candidates.length === 0 && scope.kind === 'unit' && targets.length > 0) {
      // Every question on the open points is spent: write a few more here, at
      // group start, instead of doing it inside an answer request.
      const avoid = [
        ...bank.items.map(item => item.question),
        ...(await this.spentQuestions(scope)),
      ]
      const added = await appendQuestions(this.service, this.engine, scope, targets, avoid)
      if (added > 0) {
        const grown = await this.tryBankOf(scope)
        if (grown !== null) {
          bank = grown
          candidates = orderQuizItems(bank, { weakConcepts: weak }).filter(item => !used(item))
        }
      }
    }
    const pending = new Set(targets)
    const pool = candidates
    if (pool.length === 0) {
      throw new StudyError('invalid', '这一节的题都做过了，补题也没成功：稍后再试，或在目标页补知识点')
    }
    // Open with an objective item on a point that still has to pass; without
    // targets (book chapters) keep the old objective-first order.
    const first =
      (pending.size === 0
        ? undefined
        : (pool.find(item => isObjectiveItem(item) && item.concepts.some(concept => pending.has(concept))) ??
          pool.find(item => item.concepts.some(concept => pending.has(concept))))) ??
      pool.find(isObjectiveItem) ??
      pool[0]
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
      ...(review ? { review: true as const } : {}),
      ...(Object.keys(thresholds).length === 0 ? {} : { targetThresholds: thresholds }),
      ...(goal?.deadline === undefined ? {} : { horizonDays: Math.max(0, daysBetween(localDate(), goal.deadline)) }),
    }
    await this.save(session)
    return this.view(session, bank)
  }

  /**
   * The answer a test shortcut fills in for the current item.
   *
   * Choice and cloze questions have a stored answer; a written question has no
   * reference text, so its rubric points stand in. Either way the filled answer
   * is submitted through the normal grading path.
   */
  async reference(sessionId: string, itemId: string): Promise<QuizReferenceView> {
    const session = await this.load(sessionId)
    if (session.status !== 'active' || session.currentId !== itemId) {
      throw new StudyError('conflict', '只能取当前这道题的参考答案')
    }
    const bank = await this.tryBankOf(session.scope)
    const item = this.itemsOf(session, bank).find(candidate => candidate.id === itemId)
    if (item === undefined) throw new StudyError('not-found', '题目不存在')
    if (item.type === 'choice' && item.answerIndex !== undefined) {
      return { answer: item.choices?.[item.answerIndex] ?? '', index: item.answerIndex, source: 'exact' }
    }
    if (item.type === 'cloze' && item.answer !== undefined) {
      return { answer: item.answer, source: 'exact' }
    }
    const points = item.rubric ?? []
    const prefix = item.page === undefined ? '' : `p${String(item.page)}：`
    return {
      answer:
        points.length === 0
          ? `${prefix}（这道题没有存参考答案）`
          : prefix + points.join('；'),
      source: points.length === 0 ? 'none' : 'rubric',
    }
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
    if (needsWrittenJudge(item) && verdict.correct !== true && selfGrade === undefined && judged === undefined) {
      // Includes a cloze answer whose spelling did not match: without an
      // engine the reader grades it, the string comparison alone never fails it.
      const points = await this.pointsOf(session)
      return {
        session: sessionMetaOf(session, points),
        points,
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
    // One ledger: the ability estimate lives in the knowledge space only. A
    // self-grade stays in the history and is never evidence.
    if (session.free !== true && selfGrade === undefined) {
      const verdict = judged !== undefined ? judged.verdict : correct ? 'pass' : 'fail'
      const fingerprint = questionFingerprint(item.question)
      for (const conceptId of item.concepts) {
        await recordEvidence(
          this.paths,
          { conceptId, fingerprint, verdict, difficulty: item.difficulty ?? 2, at },
          this.evidenceOptions(session, conceptId),
        )
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
      answerText: answerTextOf(item, answer),
      ...(expected === undefined ? {} : { expected }),
      ...(item.rubric === undefined ? {} : { rubric: [...item.rubric] }),
      ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
    })
    session.asked.push(itemId)

    const points = await this.pointsOf(session)
    const advanced = await this.advance(session, item, correct, points)
    session.updatedAt = at
    await this.save(session)
    return {
      session: sessionMetaOf(session, points),
      points,
      feedback: feedbackOf(item, correct, selfGrade, judgedRecord, judgeUnavailable, judged?.usage),
      history: historyOf(session, advanced.items),
      ...(advanced.next === undefined ? {} : { next: itemView(advanced.next) }),
      ...(advanced.next === undefined ? { summary: summaryOfSession(session, points) } : {}),
    }
  }

  /**
   * Move a session on after one answer.
   *
   * Passing reads the one ledger: a unit run closes `completed` only when every
   * point it measures is at its threshold (a review closes on its first passing
   * answer). Free practice and book chapters have no ledger verdict and end on
   * the question cap. No question is written here — a group tops up at start,
   * so an answer request never waits for generation.
   */
  private async advance(
    session: QuizSession,
    current: QuizItem,
    correct: boolean | null,
    points: readonly QuizPointView[],
  ): Promise<{ next?: QuizItem; items: QuizItem[] }> {
    const asked = new Set(session.asked)
    const targets = session.targets ?? []
    const reviewPassed =
      session.review === true && targets.length > 0 && conceptStatus(session.history, targets).all
    const atTarget = points.length > 0 && points.every(point => point.atTarget)
    if (session.free !== true && (session.review === true ? reviewPassed : atTarget)) {
      await this.close(session, 'completed')
      return { items: await this.itemsAfter(session) }
    }
    if (session.asked.length >= session.limit) {
      await this.close(session, 'exhausted')
      return { items: await this.itemsAfter(session) }
    }

    const pending = new Set(points.filter(point => !point.atTarget).map(point => point.id))
    const used = await this.usedQuestions(session.scope, session.history)
    const pool = await this.itemsAfter(session)
    const next = pickAdaptiveNext(pool, {
      asked,
      current,
      correct,
      skip: used,
      ...(pending.size === 0 ? {} : { focus: pending }),
    })
    if (next === undefined) {
      // No unused question left for the open points: end the group here. The
      // next start tops the bank up, so the reader is never trapped.
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
   * Which questions are already spent.
   *
   * A question proves its knowledge points once; asking it again would add no
   * evidence. Two sources: the ledger (per concept, forever) and the earlier
   * sessions of the same section (so free practice, which writes nothing, still
   * does not repeat itself inside the kept history).
   */
  private async usedQuestions(
    scope: QuizSessionScope,
    history: readonly QuizSessionEntry[] = [],
  ): Promise<(item: QuizItem) => boolean> {
    const knowledge = await ensureKnowledge(this.paths)
    const spent = new Set<string>()
    if (scope.kind === 'unit') {
      for (const other of await this.readScope(scope)) {
        for (const entry of other.history) {
          if (entry.question !== undefined) spent.add(questionFingerprint(entry.question))
        }
      }
    }
    for (const entry of history) {
      if (entry.question !== undefined) spent.add(questionFingerprint(entry.question))
    }
    return item => {
      const fingerprint = questionFingerprint(item.question)
      if (spent.has(fingerprint)) return true
      return item.concepts.some(conceptId => knowledge.concepts[conceptId]?.evidence[fingerprint] !== undefined)
    }
  }

  /**
   * Question texts already asked in this scope.
   *
   * The top-up prompt uses them as "do not repeat": without this, a newly
   * written question could carry a fingerprint the ledger already spent, and
   * the round would pay for a question it can never offer.
   */
  private async spentQuestions(scope: QuizSessionScope): Promise<string[]> {
    const out = new Set<string>()
    for (const other of await this.readScope(scope)) {
      for (const entry of other.history) {
        if (entry.question !== undefined && entry.question.length > 0) out.add(entry.question)
      }
    }
    return [...out]
  }

  /**
   * Target and horizon this section's goal asks for.
   *
   * The ledger stores ability only; the level required (了解 0.6 / 会用 0.75 /
   * 能讲 0.85 / 创新 0.95) and the time left are read from the goal at write
   * time, so two goals can require different depths of one concept.
   */
  private evidenceOptions(session: QuizSession, conceptId: string): { target: number; horizonDays?: number } {
    return {
      target: session.targetThresholds?.[conceptId] ?? DEFAULT_TARGET,
      ...(session.horizonDays === undefined ? {} : { horizonDays: session.horizonDays }),
    }
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
    // An appeal revises this one answer in the ledger: the entry for this
    // question is replaced and the concept is recomputed, so a wrong first
    // verdict no longer keeps a quarter of the mastery. A won appeal counts at
    // 0.7 — the point was still missed the first time. Plan mastery is updated
    // on the same monotonic rule as a first pass.
    if (session.free !== true && entry.question !== undefined) {
      const fingerprint = questionFingerprint(entry.question)
      for (const conceptId of entry.concepts ?? []) {
        await recordEvidence(
          this.paths,
          {
            conceptId,
            fingerprint,
            verdict: judged.verdict,
            difficulty: entry.difficulty ?? 2,
            at,
            ...(nextCorrect ? { weight: APPEAL_WEIGHT } : {}),
          },
          this.evidenceOptions(session, conceptId),
        )
      }
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
      // Legacy free runs are closed, not resumed: the page must not offer a
      // continuation that writes no progress.
      if (candidate.free === true) {
        await this.close(candidate, 'replaced')
        continue
      }
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
    const plan = await this.sessionPlanOf(scope, undefined)
    const points = await this.pointsFor(plan.targets, plan.thresholds)
    const open = points.filter(point => !point.atTarget)
    const openIds = new Set(open.map(point => point.id))
    const ready =
      plan.blocked === undefined && !plan.review && !plan.needsConcepts && points.length > 0 && open.length === 0
    const canGenerate = this.engine !== undefined && (await this.engine.textReady())
    return {
      bank: {
        items: bank?.items.length ?? 0,
        defaultLimit:
          bank === null || ready || plan.blocked !== undefined
            ? 0
            : Math.min(20, this.limitFor(bank, plan.targets.filter(id => openIds.has(id)))),
        notes: await this.notesOf(scope),
        ...(bank === null ? {} : { updatedAt: bank.updatedAt }),
      },
      points,
      open: open.length,
      ready,
      needsConcepts: plan.needsConcepts,
      canGenerate,
      ...(plan.goal === undefined ? {} : { goal: { id: plan.goal.id } }),
      ...(plan.blocked === undefined ? {} : { blocked: plan.blocked }),
      active: activeView !== null && activeView.session.status === 'active' ? activeView : null,
      recent,
    }
  }

  /** Concepts a section already carries (the single copy). */
}
