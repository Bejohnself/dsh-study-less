/**
 * Read views of one practice session.
 *
 * The session service owns the run; this module only turns its records into
 * what the panel draws: one question without its answer, feedback after an
 * answer, the history snapshot and the final summary. Keeping it separate
 * keeps scoring rules (`core/quiz`) out of the HTTP-facing service.
 */
import { MIN_GRADED_FOR_RATING, conceptStatus, scoreQuizSession } from '../core/quiz.ts'
import { ratingFromScore } from '../core/srs.ts'
import type { QuizItem, QuizJudgeRecord, QuizSelfGrade, QuizSession } from '../core/types.ts'
import type {
  QuizFeedbackView,
  QuizHistoryEntryView,
  QuizItemView,
  QuizSessionRecordView,
  QuizSessionSummary,
  QuizSessionView,
} from '../core/views.ts'

/** One question, without the answer fields a reader must not see yet. */
export function itemView(item: QuizItem): QuizItemView {
  return {
    id: item.id,
    type: item.type,
    question: item.question,
    ...(item.choices === undefined ? {} : { choices: item.choices }),
    concepts: item.concepts,
    ...(item.page === undefined ? {} : { page: item.page }),
    ...(item.difficulty === undefined ? {} : { difficulty: item.difficulty }),
    ...(item.masteryPoint === undefined ? {} : { masteryPoint: item.masteryPoint }),
  }
}

/** Reference answer shown after grading. */
export function expectedAnswerOf(item: QuizItem): string | undefined {
  if (item.type === 'choice' && item.answerIndex !== undefined) return item.choices?.[item.answerIndex]
  if (item.type === 'cloze') return item.answer
  return undefined
}

/** Human-readable answer: choice text for choices, text otherwise. */
export function answerTextOf(item: QuizItem | undefined, answer: unknown): string {
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

/** Feedback revealed after one answer. */
export function feedbackOf(
  item: QuizItem,
  correct: boolean | null,
  selfGrade?: QuizSelfGrade,
  judged?: QuizJudgeRecord,
  judgeUnavailable?: string,
): QuizFeedbackView {
  const expected = expectedAnswerOf(item)
  return {
    itemId: item.id,
    correct,
    ...(selfGrade === undefined ? {} : { selfGrade }),
    ...(expected === undefined ? {} : { expected }),
    ...(item.rubric === undefined ? {} : { rubric: item.rubric }),
    ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
    ...(judged === undefined ? {} : { judged }),
    ...(judgeUnavailable === undefined ? {} : { judgeUnavailable }),
  }
}

/** Answered items, rendered from the session's own snapshots. */
export function historyOf(session: QuizSession, items: readonly QuizItem[]): QuizHistoryEntryView[] {
  return session.history.map(entry => {
    const item = items.find(candidate => candidate.id === entry.itemId)
    const expected = entry.expected ?? (item === undefined ? undefined : expectedAnswerOf(item))
    const rubric = entry.rubric ?? item?.rubric
    const explanation = entry.explanation ?? item?.explanation
    return {
      itemId: entry.itemId,
      question: entry.question ?? item?.question ?? entry.itemId,
      type: entry.type ?? item?.type ?? 'recall',
      answerText: entry.answerText ?? answerTextOf(item, entry.answer),
      correct: entry.correct,
      ...(entry.selfGrade === undefined ? {} : { selfGrade: entry.selfGrade }),
      ...(entry.judged === undefined ? {} : { judged: entry.judged }),
      ...(entry.appeals === undefined ? {} : { appeals: entry.appeals }),
      ...(expected === undefined ? {} : { expected }),
      ...(rubric === undefined ? {} : { rubric }),
      ...(explanation === undefined ? {} : { explanation }),
      at: entry.at,
    }
  })
}

/** Progress line of one session. */
export function sessionMetaOf(session: QuizSession): QuizSessionView['session'] {
  const score = scoreQuizSession(session.history)
  const targets = session.targets ?? []
  const status = targets.length === 0 ? undefined : conceptStatus(session.history, targets)
  return {
    id: session.id,
    status: session.status,
    asked: session.asked.length,
    limit: session.limit,
    correct: score.correct,
    objective: score.graded,
    ...(status === undefined ? {} : { targetsPassed: status.passed.length, targetsTotal: targets.length }),
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    ...(session.endedReason === undefined ? {} : { endedReason: session.endedReason }),
  }
}

/** One row of the recent list. */
export function recordOf(session: QuizSession): QuizSessionRecordView {
  const score = scoreQuizSession(session.history)
  return {
    id: session.id,
    status: session.status,
    asked: session.asked.length,
    limit: session.limit,
    correct: score.correct,
    objective: score.graded,
    score: score.score,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    ...(session.endedAt === undefined ? {} : { endedAt: session.endedAt }),
    ...(session.endedReason === undefined ? {} : { endedReason: session.endedReason }),
  }
}

/**
 * Rate the run: coverage first, then the weighted score.
 *
 * A short run cannot earn a high rating no matter how correct it was; a run
 * that ended early is capped at 2. Passing also needs the section points (or
 * the plan's mastery points) to be complete.
 *
 * `names` and `openPoints` come from the caller: this stays free of service IO.
 */
export function summaryOf(
  session: QuizSession,
  items: readonly QuizItem[],
  names: ReadonlyMap<string, string>,
  openPoints?: number,
): QuizSessionSummary {
  const score = scoreQuizSession(session.history)
  const targets = session.targets ?? []
  const status = targets.length === 0 ? undefined : conceptStatus(session.history, targets)
  const enough = score.graded >= Math.min(session.limit, MIN_GRADED_FOR_RATING)
  const pointsDone = (status === undefined ? score.score >= 0.7 : status.all) && (openPoints ?? 0) === 0
  const verdict: QuizSessionSummary['verdict'] =
    !enough ? 'incomplete' : session.endedReason === 'completed' && pointsDone ? 'passed' : 'failed'
  const base = verdict === 'incomplete' ? undefined : ratingFromScore(score.score)
  const rating = base === undefined ? undefined : verdict === 'passed' ? base : Math.min(2, base)

  const weakIds = new Set<string>()
  for (const entry of session.history) {
    if (entry.correct !== false) continue
    const item = items.find(candidate => candidate.id === entry.itemId)
    for (const conceptId of entry.concepts ?? item?.concepts ?? []) weakIds.add(conceptId)
  }
  return {
    asked: session.asked.length,
    correct: score.correct,
    objective: score.graded,
    score: score.score,
    ...(rating === undefined ? {} : { rating }),
    verdict,
    weakConcepts: [...weakIds].map(id => ({ id, name: names.get(id) ?? id })),
    ...(openPoints === undefined ? {} : { openPoints }),
    ...(status === undefined ? {} : { targets: { passed: status.passed.length, total: targets.length } }),
  }
}