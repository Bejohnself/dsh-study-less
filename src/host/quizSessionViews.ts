/**
 * Read views of one practice session.
 *
 * The session service owns the run; this module only turns its records into
 * what the panel draws: one question without its answer, feedback after an
 * answer, the history snapshot and the final summary. It is pure: the ledger
 * state arrives as `points`, already resolved by the caller.
 */
import { scoreQuizSession } from '../core/quiz.ts'
import type { QuizItem, QuizJudgeRecord, QuizSelfGrade, QuizSession } from '../core/types.ts'
import type {
  QuizFeedbackView,
  QuizHistoryEntryView,
  QuizItemView,
  QuizPointView,
  QuizSessionRecordView,
  QuizSessionSummary,
  QuizSessionView,
  UsageCallView,
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
  usage?: UsageCallView,
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
    ...(usage === undefined ? {} : { usage }),
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

/** Latest verdict this run produced for one knowledge point. */
export function answeredOf(session: QuizSession, conceptId: string): QuizPointView['answered'] {
  for (let index = session.history.length - 1; index >= 0; index -= 1) {
    const entry = session.history[index]
    if (entry === undefined || !(entry.concepts ?? []).includes(conceptId)) continue
    if (entry.judged !== undefined) return entry.judged.verdict
    if (entry.selfGrade !== undefined) {
      return entry.selfGrade === 'correct' ? 'pass' : entry.selfGrade === 'partial' ? 'partial' : 'fail'
    }
    if (entry.correct === true) return 'pass'
    if (entry.correct === false) return 'fail'
    return undefined
  }
  return undefined
}

/** How many points of one run reached their threshold. */
function atTargetOf(points: readonly QuizPointView[]): { passed: number; total: number } | undefined {
  if (points.length === 0) return undefined
  return { passed: points.filter(point => point.atTarget).length, total: points.length }
}

/** Progress line of one session. */
export function sessionMetaOf(session: QuizSession, points: readonly QuizPointView[]): QuizSessionView['session'] {
  const score = scoreQuizSession(session.history)
  const atTarget = atTargetOf(points)
  return {
    id: session.id,
    status: session.status,
    asked: session.asked.length,
    limit: session.limit,
    correct: score.correct,
    objective: score.graded,
    ...(atTarget === undefined ? {} : { atTarget }),
    ...(session.review === true ? { review: true } : {}),
    ...(session.free === true ? { free: true } : {}),
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
 * Summarise the run from the one ledger.
 *
 * Passing is binary and deterministic: every point this run measured is at its
 * threshold. A run that stopped early or was replaced is `incomplete`, never a
 * verdict on ability. A legacy free run (recorded before practice became
 * goal-only) is `incomplete` too: it measured nothing. The answer count and weighted score
 * stay informative; they do not decide anything.
 */
export function summaryOf(session: QuizSession, points: readonly QuizPointView[]): QuizSessionSummary {
  const score = scoreQuizSession(session.history)
  const atTarget = atTargetOf(points)
  const all = atTarget !== undefined && atTarget.passed === atTarget.total
  const verdict: QuizSessionSummary['verdict'] =
    session.status !== 'done'
      ? 'incomplete'
      : session.free === true
        ? 'incomplete'
        : session.review === true
          ? session.endedReason === 'completed'
            ? 'passed'
            : 'incomplete'
          : session.endedReason === 'completed' && all
            ? 'passed'
            : session.endedReason === 'exhausted'
              ? 'failed'
              : 'incomplete'
  const gap = points
    .filter(point => !point.atTarget)
    .sort(
      (a, b) =>
        b.threshold - b.mastery - (a.threshold - a.mastery) || a.id.localeCompare(b.id),
    )
  return {
    asked: session.asked.length,
    correct: score.correct,
    objective: score.graded,
    score: score.score,
    verdict,
    points: [...points],
    ...(atTarget === undefined ? {} : { atTarget }),
    gap,
    ...(session.review === true ? { review: true } : {}),
    ...(session.free === true ? { free: true } : {}),
  }
}
