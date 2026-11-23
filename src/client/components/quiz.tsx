/**
 * One-question-at-a-time adaptive practice.
 *
 * The Host owns the session: it picks the next item, grades one answer and
 * keeps the history on disk. This component only mirrors that state, so closing
 * the page (or refreshing) resumes the same run instead of starting over.
 *
 * The practice order is deterministic. Wrong answers retreat to the same
 * concept at an easier level, right answers move up or across; ties follow the
 * bank's order. History is rendered from the session's own snapshots, so it
 * survives a regenerated bank.
 */
import {useCallback, useEffect, useState} from 'react'
import type {ReactElement} from 'react'
import type {QuizAnswerView, QuizFeedbackView, QuizItemView, QuizReferenceView, QuizSessionIndexView, QuizSessionView} from '../../core/views.ts'
import type {QuizSelfGrade} from '../../core/types.ts'
import {api, ApiError, errorText, post} from '../api.ts'

import {ActiveRun, HistorySection, QuizStart, RecentRow, SummaryBlock, whenText} from './quizRun.tsx'

/** The adaptive practice runner for one unit bank or one book chapter. */
export type QuizRunnerScope =
  | { kind: 'unit'; mid: string; uid: string; concept?: string }
  | { kind: 'book'; bid: string; cid: string }

/** The adaptive practice runner for one unit or one book chapter. */
export function QuizRunner({
  scope,
  showRecent = true,
  onChanged,
  onExit,
}: {
  scope: QuizRunnerScope
  /** Hide the cross-session list when the runner is embedded in a chapter. */
  showRecent?: boolean
  onChanged?: () => void
  /** Where "回到目标" leads; absent hides that button. */
  onExit?: () => void
}): ReactElement {
  const [index, setIndex] = useState<QuizSessionIndexView | null>(null)
  const [view, setView] = useState<QuizSessionView | null>(null)
  const [feedback, setFeedback] = useState<QuizFeedbackView | null>(null)
  const [nextItem, setNextItem] = useState<QuizItemView | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resumed, setResumed] = useState(false)
  const [past, setPast] = useState<QuizSessionView | null>(null)
  const [pastBusy, setPastBusy] = useState(false)
  const [waited, setWaited] = useState(0)

  const scopeKey = scope.kind === 'unit' ? `u:${scope.mid}:${scope.uid}` : `b:${scope.bid}:${scope.cid}`
  const query =
    scope.kind === 'unit'
      ? `mid=${encodeURIComponent(scope.mid)}&uid=${encodeURIComponent(scope.uid)}`
      : `bid=${encodeURIComponent(scope.bid)}&cid=${encodeURIComponent(scope.cid)}`

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

  const apply = useCallback((value: QuizSessionView, resume: boolean): void => {
    setView(value)
    setFeedback(null)
    setNextItem(null)
    setAnswer('')
    setError(null)
    setResumed(resume && value.session.status === 'active' && value.session.asked > 0)
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
    setNextItem(null)
    setAnswer('')
    setResumed(false)
    setPast(null)
    setError(null)
    void api<QuizSessionIndexView>(`/quiz/sessions?${query}`)
      .then(value => {
        if (cancelled) return
        setIndex(value)
        if (value.active !== null) apply(value.active, true)
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
      const body =
        scope.kind === 'unit'
          ? { mid: scope.mid, uid: scope.uid, ...(scope.concept === undefined ? {} : { concept: scope.concept }) }
          : { bid: scope.bid, cid: scope.cid }
      const value = await post<QuizSessionView>('/quiz/session/start', body)
      apply(value, true)
      setPast(null)
      onChanged?.()
      await fetchIndex()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  // Fill in a section the goal covers but that carries no knowledge points.
  const extractConcepts = async (): Promise<void> => {
    if (scope.kind !== 'unit' || index?.goal === undefined) return
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

  // Stop a group without waiting for its question cap.
  const finishRun = async (): Promise<void> => {
    if (view === null) return
    setBusy(true)
    setError(null)
    try {
      const value = await post<QuizSessionView>('/quiz/session/finish', { sid: view.session.id })
      setView(value)
      setFeedback(null)
      setNextItem(null)
      await fetchIndex()
      onChanged?.()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (selfGrade?: 'correct' | 'partial' | 'wrong', override?: string): Promise<void> => {
    if (view === null || view.item === undefined) return
    const item = view.item
    const draft = override ?? answer
    if (selfGrade === undefined && item.type !== 'choice' && draft.trim().length === 0) {
      setError('先写下你的答案')
      return
    }
    if (selfGrade === undefined && item.type === 'choice' && draft.length === 0) {
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
        ...(selfGrade === undefined ? {} : { selfGrade }),
      })
      setView(previous =>
        previous === null
          ? previous
          : {
              ...previous,
              session: value.session,
              points: value.points ?? [],
              history: value.history,
              ...(value.summary === undefined ? {} : { summary: value.summary }),
            },
      )
      setFeedback(value.feedback ?? null)
      setResumed(false)
      if (value.summary === undefined) {
        setNextItem(value.next ?? null)
      } else {
        setNextItem(null)
        // The recent list only appears once the run is over; fetch then.
        await fetchIndex()
      }
      onChanged?.()
    } catch (reason) {
      setError(errorText(reason))
      if (reason instanceof ApiError && reason.code === 'conflict') {
        // The session may have been closed (bank changed) or replaced elsewhere;
        // reload this exact session so its history/summary stays on screen.
        try {
          setView(await api<QuizSessionView>(`/quiz/session?sid=${encodeURIComponent(view.session.id)}`))
          setFeedback(null)
          setNextItem(null)
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
      await submit(undefined, draft)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const next = (): void => {
    if (view === null || nextItem === null) return
    setView({ ...view, item: nextItem })
    setNextItem(null)
    setFeedback(null)
    setAnswer('')
    setResumed(false)
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
      const value = await post<QuizSessionView>('/quiz/session/appeal', {
        sid,
        itemId,
        reason,
        claim,
      })
      if (view !== null && view.session.id === sid) {
        // Keep the answered item on screen: a review must not swap the panel to
        // the next question while its feedback is still open.
        setView(previous =>
          previous === null
            ? previous
            : {
                ...previous,
                session: value.session,
                points: value.points ?? [],
                history: value.history,
                ...(value.summary === undefined ? {} : { summary: value.summary }),
              },
        )
      }
      if (past !== null && past.session.id === sid) setPast(value)
      const entry = value.history.find(candidate => candidate.itemId === itemId)
      if (entry !== undefined && view !== null && view.session.id === sid) {
        setFeedback(current =>
          current === null || current.itemId !== itemId
            ? current
            : {
                ...current,
                correct: entry.correct,
                ...(entry.judged === undefined ? {} : { judged: entry.judged }),
                ...(entry.appeals === undefined ? {} : { appeals: entry.appeals }),
              },
        )
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

  const openPast = async (sessionId: string): Promise<void> => {
    setPastBusy(true)
    setError(null)
    try {
      setPast(await api<QuizSessionView>(`/quiz/session?sid=${encodeURIComponent(sessionId)}`))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setPastBusy(false)
    }
  }

  return (
    <div className="study-quiz">
      {error === null ? null : <p className="study-form-error">{error}</p>}

      {index === null && view === null ? <div className="study-empty">正在载入…</div> : null}

      {view === null && index !== null ? (
        <QuizStart
          scope={scope}
          index={index}
          busy={busy}
          onStart={() => void start()}
          onExtract={() => void extractConcepts()}
        />
      ) : null}

      {view !== null && view.session.status === 'done' ? (
        <SummaryBlock
          session={view.session}
          points={view.points}
          {...(view.summary === undefined ? {} : { summary: view.summary })}
          onContinue={view.summary?.verdict === 'passed' ? undefined : () => void start()}
          {...(onExit === undefined ? {} : { onExit })}
        />
      ) : null}

      {view !== null && view.session.status === 'active' ? (
        <ActiveRun
          view={view}
          feedback={feedback}
          nextItem={nextItem}
          resumed={resumed}
          answer={answer}
          busy={busy}
          waited={waited}
          onAnswer={setAnswer}
          onSubmit={selfGrade => void submit(selfGrade)}
          onFill={want => void fillAndSubmit(want)}
          onAppeal={(itemId, selfGrade, reason) => appeal(view.session.id, itemId, selfGrade, reason)}
          onNext={next}
          onFinish={() => void finishRun()}
        />
      ) : null}

      {view !== null && view.history.length > 0 ? (
        <HistorySection
          entries={view.history}
          collapsed={view.session.status === 'active'}
          onAppeal={(itemId, selfGrade, reason) => appeal(view.session.id, itemId, selfGrade, reason)}
        />
      ) : null}

      {past === null ? null : (
        <section className="study-quiz-past">
          <div className="study-quiz-past-head">
            <h3>{whenText(past.session.startedAt)} 那一组</h3>
            <button type="button" className="study-ghost" onClick={() => setPast(null)}>
              收起
            </button>
          </div>
          <SummaryBlock
            session={past.session}
            points={past.points ?? []}
            {...(past.summary === undefined ? {} : { summary: past.summary })}
          />
          <HistorySection
            entries={past.history}
            onAppeal={(itemId, selfGrade, reason) => appeal(past.session.id, itemId, selfGrade, reason)}
          />
        </section>
      )}

      {showRecent && index !== null && index.recent.length > 0 && (view === null || view.session.status === 'done') ? (
        <section className="study-quiz-recent">
          <h3>最近几组</h3>
          <div className="study-quiz-recent-list">
            {index.recent.map(record => (
              <RecentRow key={record.id} record={record} busy={pastBusy} onOpen={() => void openPast(record.id)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------ one run ----- */
