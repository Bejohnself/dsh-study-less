/**
 * Read views of one practice session.
 *
 * The session service owns the run; this module only turns its records into
 * what the panel draws: one question without its answer, feedback after an
 * answer, and the final summary. It is pure: the ledger state arrives as
 * `points`, already resolved by the caller.
 */
import type { QuizItem, QuizJudgeRecord, QuizSession, QuizSessionEntry } from '../core/types.ts'
import type {
  QuizFeedbackView,
  QuizItemView,
  QuizPointView,
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
  correct: boolean,
  judged?: QuizJudgeRecord,
  usage?: UsageCallView,
): QuizFeedbackView {
  const expected = expectedAnswerOf(item)
  return {
    itemId: item.id,
    correct,
    ...(expected === undefined ? {} : { expected }),
    ...(item.rubric === undefined ? {} : { rubric: item.rubric }),
    ...(item.explanation === undefined ? {} : { explanation: item.explanation }),
    ...(judged === undefined ? {} : { judged }),
    ...(usage === undefined ? {} : { usage }),
  }
}

/** What the just-submitted answer looked like, built from its stored entry. */
export function feedbackOfEntry(entry: QuizSessionEntry): QuizFeedbackView {
  return {
    itemId: entry.itemId,
    correct: entry.correct,
    ...(entry.expected === undefined ? {} : { expected: entry.expected }),
    ...(entry.rubric === undefined ? {} : { rubric: entry.rubric }),
    ...(entry.explanation === undefined ? {} : { explanation: entry.explanation }),
    ...(entry.judged === undefined ? {} : { judged: entry.judged }),
    ...(entry.appeals === undefined ? {} : { appeals: entry.appeals }),
  }
}

/** How many points of one run reached their threshold. */
function atTargetOf(points: readonly QuizPointView[]): { passed: number; total: number } | undefined {
  if (points.length === 0) return undefined
  return { passed: points.filter(point => point.atTarget).length, total: points.length }
}

/** Progress line of one session. */
export function sessionMetaOf(session: QuizSession, points: readonly QuizPointView[]): QuizSessionView['session'] {
  const atTarget = atTargetOf(points)
  return {
    id: session.id,
    status: session.status,
    count: session.count,
    ...(atTarget === undefined ? {} : { atTarget }),
    ...(session.review === true ? { review: true } : {}),
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    ...(session.endedReason === undefined ? {} : { endedReason: session.endedReason }),
  }
}

/**
 * Summarise the run from the one ledger.
 *
 * Passing is binary and deterministic: every point this run measures is at its
 * threshold. Anything else is `incomplete`, never a verdict on ability; the
 * question count stays informative and does not decide anything.
 */
export function summaryOf(session: QuizSession, points: readonly QuizPointView[]): QuizSessionSummary {
  const atTarget = atTargetOf(points)
  const all = atTarget !== undefined && atTarget.passed === atTarget.total
  // A focused review closes on its first passing answer, not on the ledger
  // threshold: the concept may still sit below it when asked.
  const verdict: QuizSessionSummary['verdict'] =
    session.status === 'done' && session.endedReason === 'completed' && (session.review === true || all)
      ? 'passed'
      : 'incomplete'
  const gap = points
    .filter(point => !point.atTarget)
    .sort((a, b) => b.threshold - b.mastery - (a.threshold - a.mastery) || a.id.localeCompare(b.id))
  return {
    verdict,
    points: [...points],
    ...(atTarget === undefined ? {} : { atTarget }),
    gap,
    count: session.count,
    ...(session.review === true ? { review: true } : {}),
    ...(session.endedNote === undefined ? {} : { note: session.endedNote }),
  }
}