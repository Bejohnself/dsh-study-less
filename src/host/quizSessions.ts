/**
 * Adaptive practice sessions: the run.
 *
 * One question on screen at a time, covering up to three of the section's open
 * knowledge points, closest to its threshold first. The next question is written
 * as part of the answer request, so there is no group, no question cap and no
 * bank to run out of. A run closes when every point is at its threshold, when
 * the reader stops, or when the next question cannot be written.
 *
 * Storage and views live in `quizSessionBase` and `quizSessionViews`.
 */

import {APPEAL_WEIGHT, DEFAULT_TARGET, decayedMastery, ensureKnowledge, questionFingerprint, recordEvidence, type EvidenceVerdict} from '../core/knowledge.ts'
import {gradeQuizItem, looksCopiedFromRubric, needsWrittenJudge, nextDifficulty} from '../core/quiz.ts'
import type {QuizItem, QuizJudgeRecord, QuizSelfGrade, QuizSession} from '../core/types.ts'
import type {QuizAnswerView, QuizPointView, QuizReferenceView, QuizSessionIndexView, QuizSessionView} from '../core/views.ts'

import type {JudgeResult} from './generation.ts'
import {NO_ENGINE_MESSAGE, engineReady, judgeInputOf, questionFor} from './quizSessionEngine.ts'
import {answerTextOf, expectedAnswerOf, feedbackOf, sessionMetaOf, summaryOf as summaryOfSession} from './quizSessionViews.ts'
import {StudyError} from './service.ts'

export type { QuizEngine } from './quizSessionEngine.ts'

import {QuizSessionBase, blockMessage} from './quizSessionBase.ts'

/** How many open points one question may cover at once. */
const FOCUS_MAX = 3

/**
 * The points the next question should cover.
 *
 * Closest to their threshold first, so points actually finish: drilling the
 * weakest first rotated through the whole section and left twelve points at
 * half-mastery instead of three at target. `FOCUS_MAX` of them go into one
 * question, and a passing answer credits all of them at once.
 */
function nextFocus(points: readonly QuizPointView[]): QuizPointView[] {
  return [...points]
    .filter(point => !point.atTarget)
    .sort((a, b) => a.threshold - a.mastery - (b.threshold - b.mastery) || a.id.localeCompare(b.id))
    .slice(0, FOCUS_MAX)
}

/**
 * What one answer proved per knowledge point.
 *
 * A passing written answer credits every point the question exercises: that is
 * the batch update that finishes a section. A single choice question is one
 * click, so it only credits its primary point however many were tagged — a
 * selection cannot demonstrate three points. A failed answer does not say which
 * point broke, so it also only debits the primary one; charging all three would
 * count one mistake three times.
 */
function conceptVerdicts(
  concepts: readonly string[],
  verdict: EvidenceVerdict,
  batch: boolean,
): Array<{conceptId: string; verdict: EvidenceVerdict}> {
  if (verdict === 'pass' && batch) return concepts.map(conceptId => ({conceptId, verdict}))
  const [primary] = concepts
  return primary === undefined ? [] : [{conceptId: primary, verdict}]
}

export class QuizSessionService extends QuizSessionBase {
  /**
   * Start a run, or resume this scope's active one.
   *
   * `restart: true` closes the active run as `replaced` and creates a new one.
   * The first question is written here, for the section's most nearly passed
   * open points.
   */
  async start(input: {
    material?: string
    unit?: string
    limit?: number
    restart?: boolean
    /** Focus one concept (review); unit scope only. */
    concept?: string
  }): Promise<QuizSessionView> {
    await this.recover()
    const scope = this.scopeOf(input)
    const plan = await this.sessionPlanOf(scope, input.concept)
    let targets = plan.targets
    let thresholds = plan.thresholds
    const review = plan.review

    if (plan.needsConcepts) {
      // A goal covers this section but it has no knowledge points yet. Extract
      // them once, inline: without points there is nothing to measure, and the
      // run is refused rather than downgraded to one that writes nothing.
      let filled = false
      if (await engineReady(this.engine)) {
        try {
          const extracted = await this.engine!.extractConcepts({material: scope.material, unit: scope.unit})
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
    if (!(await engineReady(this.engine))) throw new StudyError('unsupported', NO_ENGINE_MESSAGE)

    const actives = (await this.readScope(scope))
      .filter(session => session.status === 'active')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

    if (input.restart === true) {
      for (const candidate of actives) await this.close(candidate, 'replaced')
    } else if (actives.length > 0) {
      const resumed = actives[0]!
      for (const extra of actives.slice(1)) await this.close(extra, 'replaced')
      resumed.updatedAt = new Date().toISOString()
      await this.save(resumed)
      return this.view(resumed)
    }

    // A run only asks what is still open: a point already at the goal's
    // threshold does not come back until review says it decayed.
    const points = await this.pointsFor(targets, thresholds)
    const open = points.filter(point => !point.atTarget)
    if (!review && open.length === 0) {
      throw new StudyError('invalid', '这一节的目标都达成了；要再练就从今日面板的到期复习进')
    }
    const focus = review ? points.slice(0, 1) : nextFocus(points)
    const primary = focus[0]
    if (primary === undefined) throw new StudyError('invalid', '这一节还没有可练的知识点')
    const first = await questionFor(this.engine, scope, focus.map(point => point.id), {
      difficulty: nextDifficulty(focus),
    })

    const now = new Date().toISOString()
    const session: QuizSession = {
      version: 3,
      id: `qs-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
      scope,
      status: 'active',
      count: 0,
      current: first.item,
      ...(first.usage === undefined ? {} : { currentUsage: first.usage }),
      startedAt: now,
      updatedAt: now,
      ...(targets.length === 0 ? {} : { targets }),
      ...(review ? { review: true as const } : {}),
      ...(Object.keys(thresholds).length === 0 ? {} : { targetThresholds: thresholds }),
    }
    await this.save(session)
    return this.view(session)
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
    const item = session.current
    if (session.status !== 'active' || item === undefined || item.id !== itemId) {
      throw new StudyError('conflict', '只能取当前这道题的参考答案')
    }
    if (item.type === 'choice' && item.answerIndex !== undefined) {
      return { answer: item.choices?.[item.answerIndex] ?? '', index: item.answerIndex, source: 'exact' }
    }
    if (item.type === 'cloze' && item.answer !== undefined) {
      return { answer: item.answer, source: 'exact' }
    }
    const points = item.rubric ?? []
    const prefix = item.page === undefined ? '' : `p${String(item.page)}：`
    return {
      answer: points.length === 0 ? `${prefix}（这道题没有存参考答案）` : prefix + points.join('；'),
      source: points.length === 0 ? 'none' : 'rubric',
    }
  }

  /**
   * Submit one answer and record it.
   *
   * Grading is all this does: the next question is written by `next`, so the
   * feedback lands as soon as the judge answers instead of waiting on a second
   * model call.
   */
  async answer(
    sessionId: string,
    itemId: string,
    answer: unknown,
  ): Promise<QuizAnswerView> {
    const session = await this.load(sessionId)
    if (session.status !== 'active') throw new StudyError('conflict', '这次练习已经结束')
    const item = session.current
    if (item === undefined) throw new StudyError('conflict', '这一节没有在等的题目，请重新开始')
    if (item.id !== itemId) throw new StudyError('conflict', '这不是当前题目，请刷新后重试')
    if (needsWrittenJudge(item) && (typeof answer !== 'string' || answer.trim().length === 0)) {
      throw new StudyError('invalid', '先写下你的答案')
    }

    const verdict = gradeQuizItem(item, answer)
    let judged: JudgeResult | undefined
    // Cloze answers are written answers: an equal spelling is settled above,
    // anything else is judged by meaning, never by string equality alone.
    if (needsWrittenJudge(item) && verdict.correct !== true) {
      if (!(await engineReady(this.engine))) throw new StudyError('unsupported', NO_ENGINE_MESSAGE)
      try {
        judged = await this.engine!.judgeQuizAnswer(await judgeInputOf(this.service, session.scope, item, answer))
      } catch (error) {
        // Nothing is recorded: the question stays on screen so the reader can
        // resubmit instead of losing the answer to a transient failure.
        throw new StudyError('unsupported', `判分失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const correct = judged !== undefined ? judged.verdict === 'pass' : verdict.correct === true
    const at = new Date().toISOString()
    // One ledger: the ability estimate lives in the knowledge space only, and
    // evidence is deduped by question fingerprint, so a repeated question never
    // adds a second gain.
    const fingerprint = questionFingerprint(item.question)
    const verdicts = conceptVerdicts(item.concepts, judged?.verdict ?? (correct ? 'pass' : 'fail'), item.type !== 'choice')
    const knowledge = await ensureKnowledge(this.paths)
    const today = this.service.today()
    const reviewConcepts: string[] = []
    // An answer repairs a concept when that point had reached its threshold
    // before and has fallen below it now; those passes earn spacing. Initial
    // learning passes keep the plain gain.
    const isReview = (conceptId: string): boolean => {
      const state = knowledge.concepts[conceptId]
      const threshold = session.targetThresholds?.[conceptId] ?? DEFAULT_TARGET
      return (
        session.review === true ||
        (state !== undefined && state.peak >= threshold && decayedMastery(state, today) < threshold)
      )
    }
    for (const granted of verdicts) {
      const review = isReview(granted.conceptId)
      if (review) reviewConcepts.push(granted.conceptId)
      await recordEvidence(this.paths, {
        conceptId: granted.conceptId,
        fingerprint,
        verdict: granted.verdict,
        difficulty: item.difficulty ?? 2,
        at,
        ...(review ? { review: true } : {}),
      })
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
    session.last = {
      itemId: item.id,
      answer,
      correct,
      ...(judgedRecord === undefined ? {} : { judged: judgedRecord }),
      at,
      question: item.question,
      type: item.type,
      concepts: [...item.concepts],
      difficulty: item.difficulty ?? 2,
      ...(item.page === undefined ? {} : { page: item.page }),
      answerText: answerTextOf(item, answer),
      ...(expected === undefined ? {} : { expected }),
      ...(item.rubric === undefined ? {} : { rubric: [...item.rubric] }),
      ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
      ...(reviewConcepts.length === 0 ? {} : { reviewConcepts }),
    }
    session.count += 1
    session.current = undefined
    delete session.currentUsage
    session.updatedAt = at

    const points = await this.pointsOf(session)
    // A focused review is done as soon as its one answer passed; a section run
    // is done only when the ledger says every point reached its threshold.
    const passed = session.review === true ? correct : points.length > 0 && points.every(point => point.atTarget)
    if (passed) await this.close(session, 'completed')
    else await this.save(session)

    return {
      session: sessionMetaOf(session, points),
      points,
      feedback: feedbackOf(item, correct, judgedRecord, judged?.usage),
      ...(passed ? { summary: summaryOfSession(session, points) } : {}),
    }
  }

  /**
   * Write the next question of an active run.
   *
   * Separate from `answer` on purpose: the reader sees the grade first, then
   * waits on this call with its own progress. Calling it when a question is
   * already waiting just returns that question, so a double click is harmless.
   * A failed generation leaves the run active with no question, so the button
   * can be pressed again instead of ending the run.
   */
  async next(sessionId: string): Promise<QuizSessionView> {
    const session = await this.load(sessionId)
    if (session.status !== 'active') throw new StudyError('conflict', '这次练习已经结束')
    if (session.current !== undefined) return this.view(session)
    const points = await this.pointsOf(session)
    const focus = session.review === true ? points.slice(0, 1) : nextFocus(points)
    const primary = focus[0]
    if (primary === undefined) throw new StudyError('invalid', '这一节没有未到档的知识点，但也没全到档')
    const generated = await questionFor(
      this.engine,
      session.scope,
      focus.map(point => point.id),
      {
        ...(session.last?.question === undefined ? {} : { avoid: session.last.question }),
        difficulty: nextDifficulty(focus),
      },
    )
    session.current = generated.item
    if (generated.usage === undefined) delete session.currentUsage
    else session.currentUsage = generated.usage
    session.updatedAt = new Date().toISOString()
    await this.save(session)
    return this.view(session)
  }

  /**
   * Re-judge the answer just submitted after a rebuttal.
   *
   * The reader's claim is advisory only: the model sees the original answer, the
   * previous verdict and the rebuttal, then decides again. Appeals are unlimited
   * and the last verdict wins; a changed verdict applies one compensating answer
   * instead of rewriting mastery history. Only the latest answer is kept, so an
   * older question cannot be appealed.
   */
  async appeal(
    sessionId: string,
    itemId: string,
    reason: string,
    claim?: QuizSelfGrade,
  ): Promise<QuizSessionView> {
    const session = await this.load(sessionId)
    const entry = session.last
    if (entry === undefined || entry.itemId !== itemId) throw new StudyError('not-found', '只有刚答完的那道题可以申诉')
    if (entry.judged === undefined) throw new StudyError('invalid', '只有 AI 判过的题可以申诉')
    if (!(await engineReady(this.engine))) {
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
      type: entry.type,
      question: entry.question,
      concepts: entry.concepts,
      origin: 'generated',
      ...(entry.rubric === undefined ? {} : { rubric: entry.rubric }),
      ...(entry.page === undefined ? {} : { page: entry.page }),
    }
    const judged = await this.engine!.judgeQuizAnswer({
      ...(await judgeInputOf(this.service, session.scope, snapshot, entry.answer)),
      rebuttal: text,
      ...(claim === undefined ? {} : { claim }),
      previousVerdict: entry.judged.verdict,
      previousMissing: entry.judged.missing,
      ...(entry.judged.advice === undefined ? {} : { previousAdvice: entry.judged.advice }),
      ...(entry.appeals === undefined ? {} : { previousRebuttals: entry.appeals.map(appeal => appeal.reason) }),
    })

    const nextCorrect = judged.verdict === 'pass'
    const at = new Date().toISOString()
    // An appeal revises this one answer in the ledger: the entry for this
    // question is replaced and the concept is recomputed, so a wrong first
    // verdict no longer keeps a quarter of the mastery. A won appeal counts at
    // 0.7 — the point was still missed the first time.
    const fingerprint = questionFingerprint(entry.question)
    for (const granted of conceptVerdicts(entry.concepts, judged.verdict, entry.type !== 'choice')) {
      await recordEvidence(this.paths, {
        conceptId: granted.conceptId,
        fingerprint,
        verdict: granted.verdict,
        difficulty: entry.difficulty,
        at,
        ...(nextCorrect ? { weight: APPEAL_WEIGHT } : {}),
        ...(entry.reviewConcepts?.includes(granted.conceptId) === true ? { review: true } : {}),
      })
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
    session.updatedAt = at
    await this.save(session)
    return this.view(session)
  }

  /** End a session early. */
  async finish(sessionId: string): Promise<QuizSessionView> {
    const session = await this.load(sessionId)
    if (session.status === 'active') await this.close(session, 'finished')
    return this.view(session)
  }

  /** Read one session view. */
  async get(sessionId: string): Promise<QuizSessionView> {
    return this.view(await this.load(sessionId))
  }

  /**
   * The section's ledger state and its active run.
   *
   * The newest active session wins; older active duplicates are closed so two
   * tabs cannot silently answer into different runs.
   */
  async index(input: {
    material?: string
    unit?: string
    book?: string
    chapter?: string
    /** Focused review of one due concept: the page may start even at target. */
    concept?: string
  }): Promise<QuizSessionIndexView> {
    await this.recover()
    const scope = this.scopeOf(input)
    const sessions = await this.readScope(scope)
    const actives = sessions
      .filter(session => session.status === 'active')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    let active: QuizSession | null = null
    for (const candidate of actives) {
      if (active === null) active = candidate
      else await this.close(candidate, 'replaced')
    }
    const activeView = active === null ? null : await this.view(active)
    const plan = await this.sessionPlanOf(scope, input.concept)
    const points = await this.pointsFor(plan.targets, plan.thresholds)
    const open = points.filter(point => !point.atTarget)
    const ready =
      plan.blocked === undefined && !plan.needsConcepts && points.length > 0 && open.length === 0
    return {
      points,
      open: open.length,
      ready,
      needsConcepts: plan.needsConcepts,
      canGenerate: await engineReady(this.engine),
      ...(plan.review ? { review: true as const } : {}),
      ...(plan.goal === undefined ? {} : { goal: { id: plan.goal.id } }),
      ...(plan.blocked === undefined ? {} : { blocked: plan.blocked }),
      active: activeView !== null && activeView.session.status === 'active' ? activeView : null,
    }
  }
}