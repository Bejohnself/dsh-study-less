/**
 * One-question-at-a-time practice.
 *
 * The Host owns the session: it writes the next question for the section's
 * weakest open knowledge point, grades one answer and keeps the one answer just
 * submitted. This component only mirrors that state, so closing the page (or
 * refreshing) resumes the same run instead of starting over.
 *
 * There is no group, no cap and no history: a run continues until every
 * knowledge point of the section reaches its goal threshold.
 */
import {useCallback, useEffect, useState} from 'react'
import type {ReactElement} from 'react'
import type {QuizAnswerView, QuizFeedbackView, QuizReferenceView, QuizSessionIndexView, QuizSessionView} from '../../core/views.ts'
import type {QuizSelfGrade} from '../../core/types.ts'
import {api, ApiError, errorText, post} from '../api.ts'

import {ActiveRun, BetweenQuestions, QuizStart, SummaryBlock} from './quizRun.tsx'

/** The practice runner for one unit. */
export type QuizRunnerScope = { kind: 'unit'; mid: string; uid: string; concept?: string }

/** The practice runner for one unit. */
export function QuizRunner({
  scope,
  onChanged,
  onExit,
}: {
  scope: QuizRunnerScope
  onChanged?: () => void
  /** Where "回到首页" leads; absent hides that button. */
  onExit?: () => void
}): ReactElement {
  const [index, setIndex] = useState<QuizSessionIndexView | null>(null)
  const [view, setView] = useState<QuizSessionView | null>(null)
  const [feedback, setFeedback] = useState<QuizFeedbackView | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waited, setWaited] = useState(0)

  const scopeKey = `u:${scope.mid}:${scope.uid}:${scope.concept ?? ''}`
  const query = `mid=${encodeURIComponent(scope.mid)}&uid=${encodeURIComponent(scope.uid)}${
    scope.concept === undefined ? '' : `&concept=${encodeURIComponent(scope.concept)}`
  }`

  // A model call can take a while; say how long instead of a static "判分中…".
  useEffect(() => {
    if (!busy) {
      setWaited(0)
      return
    }
    const started = Date.now()
    const timer = window.setInterval(() => setWaited(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  const apply = useCallback((value: QuizSessionView): void => {
    setView(value)
    setFeedback(null)
    setAnswer('')
    setError(null)
  }, [])

  const fetchIndex = useCallback(async (): Promise<QuizSessionIndexView | null> => {
    try {
      const value = await api<QuizSessionIndexView>(`/quiz/sessions?${query}`)
      setIndex(value)
      return value
    } catch (reason) {
      setError(errorText(reason))
      return null
    }
  }, [query])

  useEffect(() => {
    let cancelled = false
    setIndex(null)
    setView(null)
    setFeedback(null)
    setAnswer('')
    setError(null)
    void api<QuizSessionIndexView>(`/quiz/sessions?${query}`)
      .then(value => {
        if (cancelled) return
        setIndex(value)
        if (value.active !== null) apply(value.active)
      })
      .catch(reason => {
        if (!cancelled) setError(errorText(reason))
      })
    return () => {
      cancelled = true
    }
  }, [scopeKey, query, apply])

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const value = await post<QuizSessionView>('/quiz/session/start', {
        mid: scope.mid,
        uid: scope.uid,
        ...(scope.concept === undefined ? {} : { concept: scope.concept }),
      })
      apply(value)
      onChanged?.()
      await fetchIndex()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Write the next question. Its own request, with its own elapsed counter:
   * grading no longer waits on generation, and neither does the reader.
   */
  const nextQuestion = async (): Promise<void> => {
    if (view === null) return
    setBusy(true)
    setError(null)
    try {
      const value = await post<QuizSessionView>('/quiz/session/next', { sid: view.session.id })
      setView(value)
      setFeedback(null)
      setAnswer('')
      if (value.summary !== undefined) await fetchIndex()
      onChanged?.()
    } catch (reason) {
      // The run stays open with no question, so this button is the retry.
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  // Fill in a section the goal covers but that carries no knowledge points.
  const extractConcepts = async (): Promise<void> => {
    if (index?.goal === undefined) return
    setBusy(true)
    setError(null)
    try {
      await post('/plan/concepts', { pid: index.goal.id, target: `${scope.mid}:${scope.uid}` })
      await fetchIndex()
      onChanged?.()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  // Stop the run without waiting for the section to reach its threshold.
  const finishRun = async (): Promise<void> => {
    if (view === null) return
    setBusy(true)
    setError(null)
    try {
      const value = await post<QuizSessionView>('/quiz/session/finish', { sid: view.session.id })
      setView(value)
      setFeedback(null)
      await fetchIndex()
      onChanged?.()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (override?: string): Promise<void> => {
    if (view === null || view.item === undefined) return
    const item = view.item
    const draft = override ?? answer
    if (item.type !== 'choice' && draft.trim().length === 0) {
      setError('先写下你的答案')
      return
    }
    if (item.type === 'choice' && draft.length === 0) {
      setError('先选择一个选项')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const value = await post<QuizAnswerView>('/quiz/session/answer', {
        sid: view.session.id,
        itemId: item.id,
        answer: item.type === 'choice' ? Number(draft) : draft,
      })
      setView(previous =>
        previous === null
          ? previous
          : {
              ...previous,
              session: value.session,
              points: value.points,
              ...(value.summary === undefined ? {} : { summary: value.summary }),
            },
      )
      setFeedback(value.feedback)
      if (value.summary !== undefined) await fetchIndex()
      onChanged?.()
    } catch (reason) {
      setError(errorText(reason))
      if (reason instanceof ApiError && reason.code === 'conflict') {
        // The session may have been closed or replaced elsewhere; reload this
        // exact session so its summary stays on screen.
        try {
          setView(await api<QuizSessionView>(`/quiz/session?sid=${encodeURIComponent(view.session.id)}`))
          setFeedback(null)
        } catch {
          // The session is gone; the index below decides what to show next.
        }
        await fetchIndex()
      }
    } finally {
      setBusy(false)
    }
  }

  // Test shortcut: fill the answer with the stored/reference answer (or junk)
  // and submit it, so grading and progress run exactly as a typed answer would.
  const fillAndSubmit = async (want: 'pass' | 'fail'): Promise<void> => {
    if (view === null || view.item === undefined) return
    const item = view.item
    setBusy(true)
    setError(null)
    try {
      const reference = await api<QuizReferenceView>(
        `/quiz/session/reference?sid=${encodeURIComponent(view.session.id)}&itemId=${encodeURIComponent(item.id)}`,
      )
      let draft: string
      if (item.type === 'choice') {
        const correct = reference.index === undefined || reference.index < 0 ? 0 : reference.index
        const wrong = item.choices?.findIndex((_, index) => index !== correct) ?? -1
        draft = String(want === 'pass' ? correct : wrong < 0 ? -1 : wrong)
      } else {
        draft = want === 'pass' ? reference.answer : '这一题先跳过，还没想明白。'
      }
      setAnswer(draft)
      await submit(draft)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const appeal = async (
    sid: string,
    itemId: string,
    claim: QuizSelfGrade,
    reason: string,
  ): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const value = await post<QuizSessionView>('/quiz/session/appeal', { sid, itemId, reason, claim })
      if (view !== null && view.session.id === sid) {
        // Keep the answered item on screen: a review must not swap the panel to
        // the next question while its feedback is still open.
        setView(previous =>
          previous === null
            ? previous
            : { ...previous, session: value.session, points: value.points, ...(value.last === undefined ? {} : { last: value.last }) },
        )
        if (value.last !== undefined && value.last.itemId === itemId) setFeedback(value.last)
      }
      await fetchIndex()
      onChanged?.()
      return true
    } catch (reasonValue) {
      setError(errorText(reasonValue))
      // Rethrow so the inline appeal form shows the failure next to its button.
      throw reasonValue
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="study-quiz">
      {error === null ? null : <p className="study-form-error">{error}</p>}

      {index === null && view === null ? <div className="study-empty">正在载入…</div> : null}

      {view === null && index !== null ? (
        <QuizStart
          index={index}
          busy={busy}
          waited={waited}
          onStart={() => void start()}
          onExtract={() => void extractConcepts()}
        />
      ) : null}

      {view !== null && view.session.status === 'done' ? (
        <SummaryBlock
          session={view.session}
          {...(view.summary === undefined ? {} : { summary: view.summary })}
          busy={busy}
          waited={waited}
          onContinue={view.summary?.verdict === 'passed' ? undefined : () => void start()}
          {...(onExit === undefined ? {} : { onExit })}
        />
      ) : null}

      {view !== null && view.session.status === 'active' && view.item === undefined ? (
        <BetweenQuestions
          session={view.session}
          busy={busy}
          waited={waited}
          error={error === null ? undefined : error}
          onNext={() => void nextQuestion()}
          onFinish={() => void finishRun()}
        />
      ) : null}

      {view !== null && view.session.status === 'active' && view.item !== undefined ? (
        <ActiveRun
          view={view}
          feedback={feedback}
          answer={answer}
          busy={busy}
          waited={waited}
          onAnswer={setAnswer}
          onSubmit={() => void submit()}
          onFill={want => void fillAndSubmit(want)}
          onAppeal={(itemId, claim, reason) => appeal(view.session.id, itemId, claim, reason)}
          onNext={() => void nextQuestion()}
          onFinish={() => void finishRun()}
        />
      ) : null}
    </div>
  )
}