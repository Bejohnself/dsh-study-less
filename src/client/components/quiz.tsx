/**
 * One-question-at-a-time adaptive practice.
 *
 * The Host chooses the next item; this component only submits the current
 * answer, shows the verdict/rubric, then reveals the next question. Question,
 * choices, expected answer and rubric all go through the Markdown/KaTeX
 * renderer, so formulas are no longer shown as raw `$...$`.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import type {
  QuizAnswerView,
  QuizFeedbackView,
  QuizItemView,
  QuizSessionSummary,
  QuizSessionView,
} from '../../core/views.ts'
import { errorText, post } from '../api.ts'
import { InlineMarkdown, Markdown, ProgressBar } from './ui.tsx'

/** The adaptive practice runner for one unit bank. */
export type QuizRunnerScope =
  | { kind: 'unit'; mid: string; uid: string }
  | { kind: 'book'; bid: string; cid: string }

/** The adaptive practice runner for one unit or one book chapter. */
export function QuizRunner({ scope }: { scope: QuizRunnerScope }): ReactElement {
  const [session, setSession] = useState<QuizSessionView['session'] | null>(null)
  const [current, setCurrent] = useState<QuizItemView | null>(null)
  const [feedback, setFeedback] = useState<QuizFeedbackView | null>(null)
  const [nextItem, setNextItem] = useState<QuizItemView | null>(null)
  const [summary, setSummary] = useState<QuizSessionSummary | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const value = await post<QuizSessionView>(
        '/quiz/session/start',
        scope.kind === 'unit' ? { mid: scope.mid, uid: scope.uid } : { bid: scope.bid, cid: scope.cid },
      )
      setSession(value.session)
      setCurrent(value.item ?? null)
      setFeedback(null)
      setNextItem(null)
      setSummary(null)
      setAnswer('')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const parseAnswer = (item: QuizItemView): unknown => {
    if (item.type === 'choice') return Number(answer)
    return answer
  }

  const submit = async (selfGrade?: 'correct' | 'partial' | 'wrong'): Promise<void> => {
    if (session === null || current === null) return
    if (selfGrade === undefined && answer.trim().length === 0 && current.type !== 'choice') {
      setError('先写下你的答案')
      return
    }
    if (selfGrade === undefined && current.type === 'choice' && answer.length === 0) {
      setError('先选择一个选项')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const value = await post<QuizAnswerView>('/quiz/session/answer', {
        sid: session.id,
        itemId: current.id,
        answer: parseAnswer(current),
        ...(selfGrade === undefined ? {} : { selfGrade }),
      })
      setSession(value.session)
      setFeedback(value.feedback)
      if (value.summary !== undefined) {
        setSummary(value.summary)
        setCurrent(null)
      }
      if (value.next !== undefined) setNextItem(value.next)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const next = (): void => {
    if (nextItem === null) return
    setCurrent(nextItem)
    setNextItem(null)
    setFeedback(null)
    setAnswer('')
  }

  const restart = (): void => {
    setSession(null)
    setCurrent(null)
    setFeedback(null)
    setNextItem(null)
    setSummary(null)
    setAnswer('')
    void start()
  }

  if (session === null) {
    return (
      <div className="study-quiz-start">
        <p className="study-muted">一次一题，答完立即判分；下一题会根据对错选择同概念或相关概念。</p>
        {error === null ? null : <p className="study-form-error">{error}</p>}
        <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={() => void start()}>
          {busy ? '准备中…' : '开始练习'}
        </button>
      </div>
    )
  }

  if (summary !== null && current === null) {
    return (
      <div className="study-quiz-summary">
        <h3>这一组完成</h3>
        <p className="study-quiz-score">
          得分 {Math.round(summary.score * 100)}% · 答对 {summary.correct}/{summary.objective} · 建议评级 {summary.ratingSuggestion}
        </p>
        {summary.weakConcepts.length > 0 ? (
          <p className="study-muted">需要加固：{summary.weakConcepts.map(concept => concept.name).join('、')}</p>
        ) : (
          <p className="study-muted">这一组没有明显薄弱概念。</p>
        )}
        <button type="button" className="study-primary study-primary-tight" onClick={restart}>
          再来一组
        </button>
      </div>
    )
  }

  if (current === null) return <div className="study-empty">正在载入题目…</div>

  const progress = session.limit === 0 ? 0 : (session.asked / session.limit) * 100
  const currentNumber = Math.max(1, Math.min(session.asked + (feedback === null ? 1 : 0), session.limit))
  return (
    <div className="study-quiz-runner">
      <div className="study-quiz-progress">
        <span className="study-muted">
          第 {currentNumber} / {session.limit} 题
        </span>
        <span className="study-quiz-progress-num">
          正确 {session.correct}/{session.objective}
        </span>
      </div>
      <ProgressBar percent={progress} />

      <section className={`study-quiz-item${feedback === null ? '' : feedback.correct === true ? ' is-correct' : feedback.correct === false ? ' is-wrong' : ''}`}>
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
              <label key={`${current.id}-${choiceIndex}`} className="study-quiz-choice">
                <input
                  type="radio"
                  name={current.id}
                  checked={answer === String(choiceIndex)}
                  disabled={feedback !== null && feedback.needsSelfGrade !== true}
                  onChange={() => setAnswer(String(choiceIndex))}
                />
                <InlineMarkdown source={choice} />
              </label>
            ))}
          </div>
        ) : (
          <textarea
            className="study-input study-textarea"
            placeholder={current.type === 'evidence' ? '写出页码，例如 p24' : '写下你的答案或思路'}
            value={answer}
            disabled={feedback !== null && feedback.needsSelfGrade !== true}
            onChange={event => setAnswer(event.target.value)}
          />
        )}
      </section>

      {error === null ? null : <p className="study-form-error">{error}</p>}

      {feedback === null ? (
        <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={() => void submit()}>
          {busy ? '判分中…' : '提交本题'}
        </button>
      ) : (
        <div className="study-quiz-feedback">
          <div className="study-quiz-verdict">
            {feedback.needsSelfGrade === true
              ? '主观题：先对照下面的要点，再自评'
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
          {feedback.explanation === undefined ? null : <Markdown source={feedback.explanation} className="study-quiz-explanation" />}

          {feedback.needsSelfGrade === true ? (
            <div className="study-quiz-selfgrade">
              <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={() => void submit('correct')}>
                我答对了
              </button>
              <button type="button" className="study-ghost" disabled={busy} onClick={() => void submit('partial')}>
                部分正确
              </button>
              <button type="button" className="study-ghost" disabled={busy} onClick={() => void submit('wrong')}>
                没答对
              </button>
            </div>
          ) : nextItem === null ? null : (
            <button type="button" className="study-primary study-primary-tight" onClick={next}>
              下一题
            </button>
          )}
        </div>
      )}
    </div>
  )
}
