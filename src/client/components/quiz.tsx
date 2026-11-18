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
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  JobView,
  QuizAnswerView,
  QuizFeedbackView,
  QuizHistoryEntryView,
  QuizItemView,
  QuizSessionIndexView,
  QuizSessionRecordView,
  QuizSessionSummary,
  QuizSessionView,
} from '../../core/views.ts'
import type { QuizSelfGrade } from '../../core/types.ts'
import { api, ApiError, errorText, post, waitForJob } from '../api.ts'
import { EmptyState, InlineMarkdown, JobBanner, Markdown, ProgressBar } from './ui.tsx'

/** The adaptive practice runner for one unit bank or one book chapter. */
export type QuizRunnerScope =
  | { kind: 'unit'; mid: string; uid: string }
  | { kind: 'book'; bid: string; cid: string }
  | { kind: 'plan'; pid: string; mid: string; uid: string }

/** The adaptive practice runner for one unit or one book chapter. */
export function QuizRunner({
  scope,
  showRecent = true,
  onChanged,
}: {
  scope: QuizRunnerScope
  /** Hide the cross-session list when the runner is embedded in a chapter. */
  showRecent?: boolean
  onChanged?: () => void
}): ReactElement {
  const [index, setIndex] = useState<QuizSessionIndexView | null>(null)
  const [view, setView] = useState<QuizSessionView | null>(null)
  const [feedback, setFeedback] = useState<QuizFeedbackView | null>(null)
  const [nextItem, setNextItem] = useState<QuizItemView | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [job, setJob] = useState<JobView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumed, setResumed] = useState(false)
  const [past, setPast] = useState<QuizSessionView | null>(null)
  const [pastBusy, setPastBusy] = useState(false)

  const scopeKey =
    scope.kind === 'unit'
      ? `u:${scope.mid}:${scope.uid}`
      : scope.kind === 'book'
        ? `b:${scope.bid}:${scope.cid}`
        : `p:${scope.pid}:${scope.mid}:${scope.uid}`
  const query =
    scope.kind === 'unit'
      ? `mid=${encodeURIComponent(scope.mid)}&uid=${encodeURIComponent(scope.uid)}`
      : scope.kind === 'book'
        ? `bid=${encodeURIComponent(scope.bid)}&cid=${encodeURIComponent(scope.cid)}`
        : `pid=${encodeURIComponent(scope.pid)}&mid=${encodeURIComponent(scope.mid)}&uid=${encodeURIComponent(scope.uid)}`

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

  const start = async (restart: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const body =
        scope.kind === 'unit'
          ? { mid: scope.mid, uid: scope.uid }
          : scope.kind === 'book'
            ? { bid: scope.bid, cid: scope.cid }
            : { pid: scope.pid, mid: scope.mid, uid: scope.uid }
      const value = await post<QuizSessionView>('/quiz/session/start', {
        ...body,
        ...(restart ? { restart: true } : {}),
      })
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

  const restart = (): void => {
    if (view === null) return
    if (view.session.asked === 0) {
      // Nothing to restart yet: the Host's default start already resumes this one.
      void start(false)
      return
    }
    if (!window.confirm('这一组还没答完，重开会结束当前进度；已答记录会留在「最近几组」里。继续？')) {
      return
    }
    void start(true)
  }

  const submit = async (selfGrade?: 'correct' | 'partial' | 'wrong'): Promise<void> => {
    if (view === null || view.item === undefined) return
    const item = view.item
    if (selfGrade === undefined && item.type !== 'choice' && answer.trim().length === 0) {
      setError('先写下你的答案')
      return
    }
    if (selfGrade === undefined && item.type === 'choice' && answer.length === 0) {
      setError('先选择一个选项')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const value = await post<QuizAnswerView>('/quiz/session/answer', {
        sid: view.session.id,
        itemId: item.id,
        answer: item.type === 'choice' ? Number(answer) : answer,
        ...(selfGrade === undefined ? {} : { selfGrade }),
      })
      setView(previous =>
        previous === null
          ? previous
          : {
              ...previous,
              session: value.session,
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

  const generate = async (): Promise<void> => {
    if (scope.kind !== 'unit') return
    if (
      index !== null &&
      index.bank.items > 0 &&
      !window.confirm('重新出题会换掉这一节的现有题目；已答记录还在「最近几组」里。继续？')
    ) {
      return
    }
    setGenerating(true)
    setError(null)
    setJob(null)
    try {
      const { jobId } = await post<{ jobId: string }>('/generate/quiz', {
        mid: scope.mid,
        uid: scope.uid,
      })
      const finished = await waitForJob(jobId, setJob)
      if (finished.status === 'done') {
        setJob(null)
        // A new bank invalidates the old run: show its start screen, not a
        // stale summary that the next answer would reject.
        setView(null)
        setFeedback(null)
        setNextItem(null)
        setPast(null)
        onChanged?.()
        await fetchIndex()
      } else if (finished.status === 'failed') {
        setJob(finished)
      }
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setGenerating(false)
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
      {job === null ? null : <JobBanner job={job} />}

      {index === null && view === null ? <div className="study-empty">正在载入…</div> : null}

      {view === null && index !== null ? (
        scope.kind === 'plan' ? (
          <PlanStart
            mastery={index.bank.mastery}
            busy={busy}
            onStart={() => void start(false)}
          />
        ) : index.bank.items === 0 ? (
          <BankEmpty scope={scope} busy={busy} onStart={() => void start(false)} />
        ) : (
          <div className="study-quiz-start">
            <p className="study-muted">
              这一{scope.kind === 'unit' ? '节' : '章'} {String(index.bank.items)} 题；这一组最多{' '}
              {String(index.bank.defaultLimit)} 题，按你答得怎么样挑题，知识点都过了就收。
            </p>
            {scope.kind === 'unit' ? (
              <p className="study-rail-foot">题目从这一节的原文与导读里出；答错会更新概念掌握度。</p>
            ) : null}
            <button
              type="button"
              className="study-primary study-primary-tight"
              disabled={busy}
              onClick={() => void start(false)}
            >
              {busy ? '准备中…' : '开始练习'}
            </button>
            {scope.kind === 'unit' ? (
              <button
                type="button"
                className="study-link"
                disabled={busy || generating}
                onClick={() => void generate()}
              >
                {generating ? '正在出题…' : '重新出题（换掉现有题目）'}
              </button>
            ) : null}
          </div>
        )
      ) : null}

      {view !== null && view.session.status === 'done' ? (
        <SummaryBlock
          session={view.session}
          {...(view.summary === undefined ? {} : { summary: view.summary })}
          onRestart={view.summary?.openPoints === 0 ? undefined : () => void start(false)}
          {...(scope.kind === 'unit' ? { onRegenerate: () => void generate() } : {})}
          regenerating={generating}
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
          onAnswer={setAnswer}
          onSubmit={selfGrade => void submit(selfGrade)}
          onAppeal={(itemId, selfGrade, reason) => appeal(view.session.id, itemId, selfGrade, reason)}
          onNext={next}
          onRestart={restart}
          restartLabel={scope.kind === 'unit' ? '重做这组题' : '换一组新题'}
          {...(scope.kind === 'unit' ? { onRegenerate: () => void generate(), regenerating: generating } : {})}
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

function ActiveRun({
  view,
  feedback,
  nextItem,
  resumed,
  answer,
  busy,
  onAnswer,
  onSubmit,
  onAppeal,
  onNext,
  onRestart,
  restartLabel,
  onRegenerate,
  regenerating,
}: {
  view: QuizSessionView
  feedback: QuizFeedbackView | null
  nextItem: QuizItemView | null
  resumed: boolean
  answer: string
  busy: boolean
  onAnswer: (value: string) => void
  onSubmit: (selfGrade?: QuizSelfGrade) => void
  onAppeal: (itemId: string, selfGrade: QuizSelfGrade, reason: string) => Promise<boolean>
  onNext: () => void
  onRestart: () => void
  restartLabel: string
  onRegenerate?: () => void
  regenerating?: boolean
}): ReactElement {
  const [appealOpen, setAppealOpen] = useState(false)
  useEffect(() => {
    setAppealOpen(false)
  }, [feedback?.itemId])
  const current = view.item
  if (current === undefined) return <div className="study-empty">正在载入题目…</div>
  const session = view.session
  const progress = session.limit === 0 ? 0 : (session.asked / session.limit) * 100
  const currentNumber = Math.max(1, Math.min(session.asked + (feedback === null ? 1 : 0), session.limit))
  const last = view.history[view.history.length - 1]

  return (
    <div className="study-quiz-runner">
      {resumed && last !== undefined ? (
        <p className="study-quiz-resume">
          上次答到第 {session.asked}/{session.limit} 题；上一题{verdictText(last)}。接着答就行。
        </p>
      ) : null}
      <div className="study-quiz-progress">
        <span className="study-muted">
          第 {currentNumber} / {session.limit} 题
        </span>
        <span className="study-quiz-progress-num">
          正确 {session.correct}/{session.objective}
        </span>
        {session.targetsTotal === undefined ? null : (
          <span className="study-muted">
            知识点 {session.targetsPassed ?? 0}/{session.targetsTotal}
          </span>
        )}
        {session.asked === 0 ? null : (
          <>
            <button type="button" className="study-ghost" disabled={busy} onClick={onRestart}>
              {restartLabel}
            </button>
            {onRegenerate === undefined ? null : (
              <button
                type="button"
                className="study-ghost"
                disabled={busy || regenerating === true}
                onClick={onRegenerate}
              >
                {regenerating === true ? '正在出题…' : '换一批新题'}
              </button>
            )}
          </>
        )}
      </div>
      <ProgressBar percent={progress} />

      <section
        className={`study-quiz-item${
          feedback === null
            ? ''
            : feedback.correct === true
              ? ' is-correct'
              : feedback.correct === false
                ? ' is-wrong'
                : ''
        }`}
      >
        <div className="study-quiz-head">
          <span className="study-quiz-index">{currentNumber}</span>
          <span className="study-quiz-type">{current.type}</span>
          {current.page === undefined ? null : <span className="study-muted">p{current.page}</span>}
          {current.difficulty === undefined ? null : <span className="study-muted">难度 {current.difficulty}</span>}
        </div>
        <Markdown source={current.question} className="study-quiz-question" />
        {current.type === 'choice' && current.choices !== undefined ? (
          <div className="study-quiz-choices">
            {current.choices.map((choice, choiceIndex) => (
              <label key={`${current.id}-${String(choiceIndex)}`} className="study-quiz-choice">
                <input
                  type="radio"
                  name={current.id}
                  checked={answer === String(choiceIndex)}
                  disabled={feedback !== null && feedback.needsSelfGrade !== true}
                  onChange={() => onAnswer(String(choiceIndex))}
                />
                <InlineMarkdown source={choice} />
              </label>
            ))}
          </div>
        ) : (
          <textarea
            className="study-input study-textarea"
            placeholder={
              current.type === 'evidence'
                ? '写出页码，并引一句能支撑结论的原文'
                : '写下你的答案或思路'
            }
            value={answer}
            disabled={feedback !== null && feedback.needsSelfGrade !== true}
            onChange={event => onAnswer(event.target.value)}
          />
        )}
      </section>

      {feedback == null ? (
        <button
          type="button"
          className="study-primary study-primary-tight"
          disabled={busy}
          onClick={() => onSubmit()}
        >
          {busy ? '判分中…' : '提交本题'}
        </button>
      ) : (
        <div className="study-quiz-feedback">
          <div
            className={`study-quiz-verdict${
              feedback.correct === true ? ' is-correct' : feedback.correct === false ? ' is-wrong' : ''
            }`}
          >
            {feedback.needsSelfGrade === true
              ? '主观题：先对照下面的要点，再自评'
              : feedback.judged !== undefined
                ? `${(feedback.appeals?.length ?? 0) > 0 ? 'AI 复核' : 'AI 判定'}：${judgedLabel(feedback.judged.verdict)}`
                : feedback.selfGrade === 'partial'
                  ? '部分正确'
                  : feedback.selfGrade === 'wrong'
                    ? '没答对'
                    : feedback.correct === true
                      ? '正确'
                      : feedback.correct === false
                        ? '不对'
                        : '已记录'}
          </div>
          {feedback.expected === undefined ? null : (
            <p>
              参考答案：<InlineMarkdown source={feedback.expected} />
            </p>
          )}
          {feedback.judged === undefined ? null : (
            <div className="study-quiz-rubric">
              <span className="study-muted">
                AI 判定：{judgedLabel(feedback.judged.verdict)} · 把握{' '}
                {Math.round(feedback.judged.confidence * 100)}%
              </span>
              {(feedback.judged.missing ?? []).length === 0 ? null : (
                <ul>
                  {(feedback.judged.missing ?? []).map(item => (
                    <li key={item}>
                      <Markdown source={item} className="study-quiz-rubric-item" />
                    </li>
                  ))}
                </ul>
              )}
              {feedback.judged.advice === undefined ? null : (
                <p className="study-muted">{feedback.judged.advice}</p>
              )}
            </div>
          )}
          {feedback.appeals === undefined || feedback.appeals.length === 0 ? null : (
            <div className="study-quiz-rubric">
              <span className="study-muted">复核记录</span>
              <ul>
                {feedback.appeals.map((round, roundIndex) => (
                  <li key={`${round.at}-${String(roundIndex)}`}>
                    第 {roundIndex + 1} 次：{judgedLabel(round.verdict)} · {round.engine} · {round.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {feedback.needsSelfGrade === true && feedback.judgeUnavailable !== undefined ? (
            <p className="study-muted">{feedback.judgeUnavailable}，先自评。</p>
          ) : null}
          {feedback.rubric === undefined || feedback.rubric.length === 0 ? null : (
            <div className="study-quiz-rubric">
              <span className="study-muted">评分要点</span>
              <ul>
                {feedback.rubric.map(item => (
                  <li key={item}>
                    <Markdown source={item} className="study-quiz-rubric-item" />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {feedback.explanation === undefined ? null : (
            <Markdown source={feedback.explanation} className="study-quiz-explanation" />
          )}

          {feedback.needsSelfGrade === true ? (
            <div className="study-quiz-selfgrade">
              <button
                type="button"
                className="study-primary study-primary-tight"
                disabled={busy}
                onClick={() => onSubmit('correct')}
              >
                我答对了
              </button>
              <button type="button" className="study-ghost" disabled={busy} onClick={() => onSubmit('partial')}>
                部分正确
              </button>
              <button type="button" className="study-ghost" disabled={busy} onClick={() => onSubmit('wrong')}>
                没答对
              </button>
            </div>
          ) : nextItem === null ? null : (
            <button type="button" className="study-primary study-primary-tight" onClick={onNext}>
              下一题
            </button>
          )}

          {feedback.judged === undefined ? null : (
            <div className="study-quiz-selfgrade">
              <button type="button" className="study-ghost" disabled={busy} onClick={() => setAppealOpen(open => !open)}>
                {appealOpen ? '收起申诉' : (feedback.appeals?.length ?? 0) > 0 ? '再次申诉' : 'AI 判错了？申诉'}
              </button>
            </div>
          )}
          {appealOpen ? (
            <AppealForm
              defaultGrade={feedback.correct === true ? 'wrong' : 'correct'}
              disabled={busy}
              onSubmit={async (grade, reason) => {
                const ok = await onAppeal(feedback.itemId, grade, reason)
                if (ok) setAppealOpen(false)
                return ok
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------- summary/history - */

function SummaryBlock({
  session,
  summary,
  onRestart,
  onRegenerate,
  regenerating,
}: {
  session: QuizSessionView['session']
  summary?: QuizSessionSummary
  onRestart?: () => void
  onRegenerate?: () => void
  regenerating?: boolean
}): ReactElement {
  return (
    <div className="study-quiz-summary">
      <h3>{endTitle(session.endedReason)}</h3>
      {summary === undefined ? null : (
        <>
          {summary.objective === 0 ? (
            <p className="study-quiz-score">答了 {summary.asked} 题，还没有可判分的记录。</p>
          ) : (
            <p className="study-quiz-score">
              {summary.verdict === 'passed' ? '通过' : summary.verdict === 'failed' ? '未通过' : '未完成'} ·
              得分 {Math.round(summary.score * 100)}% · 答对 {summary.correct}/{summary.objective}
              {summary.rating === undefined ? '' : ` · 评级 ${summary.rating}`}
            </p>
          )}
          <p className="study-muted">
            这一组答了 {summary.asked}/{session.limit} 题。
            {summary.rating === undefined ? '题量不够，先不评级。' : ''}
          </p>
          {summary.targets === undefined ? null : (
            <p className="study-muted">
              本节 {summary.targets.total} 个知识点，已过 {summary.targets.passed} 个。
            </p>
          )}
          {summary.openPoints === undefined ? null : summary.openPoints === 0 ? (
            <p className="study-muted">这一节的掌握点都过了。</p>
          ) : (
            <p className="study-muted">这一节还剩 {summary.openPoints} 个掌握点没过；再来一组会出新的题。</p>
          )}
          {summary.openPoints !== undefined ? null : (summary.weakConcepts ?? []).length > 0 ? (
            <p className="study-muted">需要加固：{(summary.weakConcepts ?? []).map(concept => concept.name).join('、')}</p>
          ) : (
            <p className="study-muted">这一组没有明显薄弱概念。</p>
          )}
        </>
      )}
      {onRestart === undefined ? null : (
        <button type="button" className="study-primary study-primary-tight" onClick={onRestart}>
          再来一组
        </button>
      )}
      {onRegenerate === undefined ? null : (
        <button type="button" className="study-link" disabled={regenerating} onClick={onRegenerate}>
          {regenerating ? '正在出题…' : '换一批新题（换掉这一节题库）'}
        </button>
      )}
    </div>
  )
}

function HistorySection({
  entries,
  collapsed = false,
  onAppeal,
}: {
  entries: QuizHistoryEntryView[]
  collapsed?: boolean
  onAppeal?: (itemId: string, selfGrade: QuizSelfGrade, reason: string) => Promise<boolean>
}): ReactElement | null {
  if (entries.length === 0) return null
  const list = (
    <ol className="study-quiz-history-list">
      {entries.map((entry, index) => (
        <HistoryRow key={`${entry.itemId}-${String(index)}`} entry={entry} index={index} onAppeal={onAppeal} />
      ))}
    </ol>
  )
  if (collapsed) {
    return (
      <details className="study-quiz-history">
        <summary>本轮记录（{entries.length}）</summary>
        {list}
      </details>
    )
  }
  return (
    <section className="study-quiz-history">
      <h3>本轮记录（{entries.length}）</h3>
      {list}
    </section>
  )
}

function HistoryRow({
  entry,
  index,
  onAppeal,
}: {
  entry: QuizHistoryEntryView
  index: number
  onAppeal?: (itemId: string, selfGrade: QuizSelfGrade, reason: string) => Promise<boolean>
}): ReactElement {
  const [appealOpen, setAppealOpen] = useState(false)
  const tone = entry.correct === true ? ' is-correct' : entry.correct === false ? ' is-wrong' : ''
  return (
    <li className="study-quiz-history-row">
      <div className="study-quiz-history-head">
        <span className="study-quiz-index">{index + 1}</span>
        <span className={`study-quiz-verdict${tone}`}>{verdictText(entry)}</span>
        <span className="study-muted">{entry.type}</span>
      </div>
      <Markdown source={entry.question} className="study-quiz-question" />
      <div className="study-quiz-history-answer">
        <span className="study-muted">你的答案：</span>
        <InlineMarkdown source={entry.answerText} />
      </div>
      {entry.judged === undefined ? null : (
        <div className="study-quiz-rubric">
          <span className="study-muted">
            {entry.appeals === undefined || entry.appeals.length === 0 ? 'AI 判定' : 'AI 复核'}：
            {judgedLabel(entry.judged.verdict)} · 把握 {Math.round(entry.judged.confidence * 100)}%
          </span>
          {(entry.judged.missing ?? []).length === 0 ? null : (
            <ul>
              {(entry.judged.missing ?? []).map(item => (
                <li key={item}>
                  <Markdown source={item} className="study-quiz-rubric-item" />
                </li>
              ))}
            </ul>
          )}
          {entry.judged.advice === undefined ? null : <p className="study-muted">{entry.judged.advice}</p>}
        </div>
      )}
      {entry.appeals === undefined || entry.appeals.length === 0 ? null : (
        <div className="study-quiz-rubric">
          <span className="study-muted">复核记录</span>
          <ul>
            {entry.appeals.map((round, roundIndex) => (
              <li key={`${round.at}-${String(roundIndex)}`}>
                第 {roundIndex + 1} 次：{judgedLabel(round.verdict)} · {round.engine} · {round.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {entry.expected === undefined ? null : (
        <p className="study-quiz-history-expected">
          参考答案：<InlineMarkdown source={entry.expected} />
        </p>
      )}
      {entry.rubric === undefined || entry.rubric.length === 0 ? null : (
        <div className="study-quiz-rubric">
          <span className="study-muted">评分要点</span>
          <ul>
            {entry.rubric.map(item => (
              <li key={item}>
                <Markdown source={item} className="study-quiz-rubric-item" />
              </li>
            ))}
          </ul>
        </div>
      )}
      {entry.explanation === undefined ? null : (
        <Markdown source={entry.explanation} className="study-quiz-explanation" />
      )}
      {entry.judged === undefined || onAppeal === undefined ? null : (
        <>
          <div className="study-quiz-selfgrade">
            <button type="button" className="study-ghost" onClick={() => setAppealOpen(open => !open)}>
              {appealOpen ? '收起申诉' : (entry.appeals?.length ?? 0) > 0 ? '再次申诉' : 'AI 判错了？申诉'}
            </button>
          </div>
          {appealOpen ? (
            <AppealForm
              defaultGrade={entry.correct === true ? 'wrong' : 'correct'}
              onSubmit={async (grade, reason) => {
                const ok = await onAppeal(entry.itemId, grade, reason)
                if (ok) setAppealOpen(false)
                return ok
              }}
            />
          ) : null}
        </>
      )}
    </li>
  )
}

function AppealForm({
  defaultGrade,
  disabled = false,
  onSubmit,
}: {
  defaultGrade: QuizSelfGrade
  disabled?: boolean
  onSubmit: (grade: QuizSelfGrade, reason: string) => Promise<boolean>
}): ReactElement {
  const [grade, setGrade] = useState<QuizSelfGrade>(defaultGrade)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    if (reason.trim().length < 4) {
      setError('写清申诉理由（至少 4 个字）')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(grade, reason.trim())
    } catch (reasonValue) {
      setError(errorText(reasonValue))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="study-quiz-selfgrade">
      <select
        className="study-input"
        value={grade}
        disabled={disabled || busy}
        onChange={event => setGrade(event.target.value as QuizSelfGrade)}
      >
        <option value="correct">我答对了</option>
        <option value="partial">部分正确</option>
        <option value="wrong">没答对</option>
      </select>
      <input
        type="text"
        className="study-input"
        placeholder="补上漏掉的要点，或指出判分错误；AI 会重新判"
        value={reason}
        disabled={disabled || busy}
        onChange={event => setReason(event.target.value)}
      />
      <button type="button" className="study-primary study-primary-tight" disabled={disabled || busy} onClick={() => void submit()}>
        {busy ? '复核中…' : '提交复核'}
      </button>
      {error === null ? null : <p className="study-form-error">{error}</p>}
    </div>
  )
}

function RecentRow({
  record,
  busy,
  onOpen,
}: {
  record: QuizSessionRecordView
  busy: boolean
  onOpen: () => void
}): ReactElement {
  return (
    <button type="button" className="study-quiz-recent-row" disabled={busy} onClick={onOpen}>
      <span>{whenText(record.updatedAt)}</span>
      <span>
        {record.asked}/{record.limit} 题
      </span>
      <span>
        答对 {record.correct}/{record.objective}
      </span>
      <span className="study-muted">{record.objective === 0 ? '未判分' : endReasonText(record.endedReason)}</span>
    </button>
  )
}

function PlanStart({
  mastery,
  busy,
  onStart,
}: {
  mastery?: { open: number; total: number; passed: number }
  busy: boolean
  onStart: () => void
}): ReactElement {
  if (mastery === undefined || mastery.total === 0) {
    return (
      <EmptyState
        title="这个目标在这一节还没有掌握点。"
        hint="掌握点写在目标图景里；重新生成一次路径，AI 会把它们补上。"
      />
    )
  }
  if (mastery.open === 0) {
    return <EmptyState title="这一节的掌握点都过了。" hint="去目标的其它步骤，或者换一节练。" />
  }
  return (
    <div className="study-quiz-start">
      <p className="study-muted">
        这一节 {mastery.total} 个掌握点，已过 {mastery.passed} 个，还差 {mastery.open} 个。AI 按没过的点现场出题，答过
        才算过。
      </p>
      <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={onStart}>
        {busy ? 'AI 正在出题…' : '开始过关测试'}
      </button>
    </div>
  )
}

function BankEmpty({
  scope,
  busy,
  onStart,
}: {
  scope: QuizRunnerScope
  busy: boolean
  onStart: () => void
}): ReactElement {
  if (scope.kind === 'book') {
    return <EmptyState title="这一章还没有练习题。" hint="章节练习会跟着章节一起生成。" />
  }
  return (
    <EmptyState
      title="这一节还没有题库。"
      hint="开始练习时按这一节的知识点现场出题，一次一题；后面的题按你答得怎么样再补。需要可用的文本引擎。"
      action={{ label: busy ? '正在出题…' : '开始练习', onClick: onStart }}
    />
  )
}

/* --------------------------------------------------------------- labels ---- */

function verdictText(entry: QuizHistoryEntryView): string {
  if (entry.judged !== undefined) {
    const prefix = (entry.appeals?.length ?? 0) > 0 ? '复核' : 'AI'
    return `${prefix}：${judgedLabel(entry.judged.verdict)}`
  }
  if (entry.correct === true) return '正确'
  if (entry.selfGrade === 'partial') return '部分正确'
  if (entry.correct === false) return entry.selfGrade === 'wrong' ? '没答对' : '不对'
  return '已记录'
}

function judgedLabel(verdict: 'pass' | 'partial' | 'fail'): string {
  return verdict === 'pass' ? '通过' : verdict === 'partial' ? '还差一点' : '未通过'
}

function endTitle(reason: QuizSessionView['session']['endedReason']): string {
  switch (reason) {
    case 'completed':
      return '本节知识点都过了'
    case 'exhausted':
      return '题量用完，这一组就到这里'
    case 'finished':
      return '这一组提前结束'
    case 'replaced':
      return '这一组被新的一组替换了'
    case 'bank-changed':
      return '题目换过了，这一组就到这里'
    default:
      return '这一组结束'
  }
}

function endReasonText(reason: QuizSessionRecordView['endedReason']): string {
  switch (reason) {
    case 'completed':
      return '全过'
    case 'exhausted':
      return '题用完了'
    case 'finished':
      return '提前结束'
    case 'replaced':
      return '被替换'
    case 'bank-changed':
      return '题换了'
    default:
      return ''
  }
}

function whenText(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}