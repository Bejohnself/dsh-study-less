/**
 * The live run and its summary.
 *
 * One question at a time: the runner owns fetching and scope, these render one
 * step. They take everything through props, so the runner stays the only state
 * owner. Nothing here shows past questions — they are not kept.
 */
import {useEffect, useState} from 'react'
import type {ReactElement} from 'react'
import type {QuizFeedbackView, QuizPointView, QuizSessionIndexView, QuizSessionSummary, QuizSessionView} from '../../core/views.ts'
import type {QuizSelfGrade} from '../../core/types.ts'
import {errorText} from '../api.ts'
import {InlineMarkdown, Markdown, ProgressBar} from './ui.tsx'
import {UsageNote} from './usage.tsx'

export function ActiveRun({
  view,
  feedback,
  answer,
  busy,
  waited,
  onAnswer,
  onSubmit,
  onFill,
  onAppeal,
  onNext,
  onFinish,
}: {
  view: QuizSessionView
  feedback: QuizFeedbackView | null
  answer: string
  busy: boolean
  /** Seconds spent waiting on the current submit. */
  waited: number
  onAnswer: (value: string) => void
  onSubmit: () => void
  onFill: (want: 'pass' | 'fail') => void
  onAppeal: (itemId: string, claim: QuizSelfGrade, reason: string) => Promise<boolean>
  onNext: () => void
  onFinish: () => void
}): ReactElement {
  const [appealOpen, setAppealOpen] = useState(false)
  useEffect(() => {
    setAppealOpen(false)
  }, [feedback?.itemId])
  const current = view.item
  if (current === undefined) return <div className="study-empty">正在载入题目…</div>
  const session = view.session
  // While the previous answer's feedback is open the count already includes it.
  const number = session.count + (feedback === null ? 1 : 0)
  const atTarget = session.atTarget
  const percent = atTarget === undefined || atTarget.total === 0 ? 0 : (atTarget.passed / atTarget.total) * 100
  const written = current.type !== 'choice'
  // Show the live preview once the answer actually contains a math delimiter;
  // plain prose would only be duplicated underneath the textarea.
  const hasMath = /\$|\\\(|\\\[|\\begin\{/.test(answer)

  return (
    <div className="study-quiz-runner">
      <div className="study-quiz-progress">
        <span className="study-muted">第 {number} 题</span>
        {atTarget === undefined || session.review === true ? null : (
          <span className={atTarget.passed === atTarget.total ? 'study-quiz-progress-num is-on' : 'study-quiz-progress-num'}>
            到档 {atTarget.passed}/{atTarget.total}
          </span>
        )}
        <span className="study-muted">
          {session.review === true ? '到期复习' : '按目标档位'} · 每次出一道，到档才收
        </span>
      </div>
      <ProgressBar percent={percent} />
      {view.points.length === 0 ? null : <PointList points={view.points} compact />}

      <section
        className={`study-quiz-item${
          feedback === null ? '' : feedback.correct ? ' is-correct' : ' is-wrong'
        }`}
      >
        <div className="study-quiz-head">
          <span className="study-quiz-index">{number}</span>
          <span className="study-quiz-type">{current.type}</span>
          {current.page === undefined ? null : <span className="study-muted">p{current.page}</span>}
          {current.difficulty === undefined ? null : <span className="study-muted">难度 {current.difficulty}</span>}
          {feedback === null ? <UsageNote usage={view.usage} prefix="出题" /> : null}
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
                  disabled={feedback !== null}
                  onChange={() => onAnswer(String(choiceIndex))}
                />
                <InlineMarkdown source={choice} />
              </label>
            ))}
          </div>
        ) : (
          <>
            <textarea
              className="study-input study-textarea"
              placeholder={
                current.type === 'evidence'
                  ? '写出页码，并引一句能支撑结论的原文'
                  : '写下你的答案或思路'
              }
              value={answer}
              disabled={feedback !== null}
              onChange={event => onAnswer(event.target.value)}
            />
            <p className="study-quiz-math-hint">
              公式写成 $...$，下面会实时渲染。
              {written ? ' 问答题由模型判分，通常几秒到几十秒；选择题立即出结果。' : ' 选择题提交后立即出结果。'}
            </p>
            {hasMath ? (
              <div className="study-quiz-preview">
                <span className="study-field-label">预览</span>
                <Markdown source={answer} className="study-quiz-answer-preview" />
              </div>
            ) : null}
          </>
        )}
      </section>

      {feedback == null ? (
        <div className="study-quiz-actions">
          <button
            type="button"
            className="study-primary study-primary-tight"
            disabled={busy}
            onClick={onSubmit}
          >
            {busy ? (waited >= 3 ? `判分中…已 ${waited} 秒` : '判分中…') : '提交本题'}
          </button>
          <button type="button" className="study-link" disabled={busy} onClick={onFinish}>
            结束练习
          </button>
          {/*
            Testing shortcut: fills the answer box (reference answer or junk)
            and submits it. Grading is not bypassed.
          */}
          <span className="study-quiz-test">
            <span className="study-muted">测试</span>
            <button type="button" className="study-ghost" disabled={busy} title="填入参考答案并提交" onClick={() => onFill('pass')}>
              填正确答案
            </button>
            <button type="button" className="study-ghost" disabled={busy} title="填入错误答案并提交" onClick={() => onFill('fail')}>
              填错误答案
            </button>
          </span>
        </div>
      ) : (
        <div className="study-quiz-feedback">
          <UsageNote usage={feedback.usage} prefix="判分" />
          <div className={`study-quiz-verdict${feedback.correct ? ' is-correct' : ' is-wrong'}`}>
            {feedback.judged !== undefined
              ? `${(feedback.appeals?.length ?? 0) > 0 ? 'AI 复核' : 'AI 判定'}：${judgedLabel(feedback.judged.verdict)}`
              : feedback.correct
                ? '正确'
                : '不对'}
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

          <div className="study-quiz-actions">
            <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={onNext}>
              {busy ? (waited >= 1 ? `出题中…已 ${waited} 秒` : '出题中…') : '出下一题'}
            </button>
            <span className="study-muted">判分和出题分开：这一下只在等模型写题。</span>
          </div>

          {feedback.judged === undefined ? null : (
            <div className="study-quiz-selfgrade">
              <button type="button" className="study-ghost" disabled={busy} onClick={() => setAppealOpen(open => !open)}>
                {appealOpen ? '收起申诉' : (feedback.appeals?.length ?? 0) > 0 ? '再次申诉' : 'AI 判错了？申诉'}
              </button>
            </div>
          )}
          {appealOpen ? (
            <AppealForm
              defaultGrade={feedback.correct ? 'wrong' : 'correct'}
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

/* ------------------------------------------------------------ start screen - */

/** What the page shows before a run: the section's points and the one action. */
export function QuizStart({
  index,
  busy,
  waited,
  onStart,
  onExtract,
}: {
  index: QuizSessionIndexView
  busy: boolean
  waited: number
  onStart: () => void
  onExtract: () => void
}): ReactElement {
  const points = index.points ?? []
  const ready = index.ready === true
  const review = index.review === true
  const needsConcepts = index.needsConcepts === true
  const canGenerate = index.canGenerate === true
  const blocked = index.blocked
  const blockLine =
    blocked === 'no-goal'
      ? '还没有学习目标：练习只在目标里跑并写进度，先新建一个目标。'
      : blocked === 'outside-goal'
        ? '这一节不在当前目标里：先把它加进目标的路线。'
        : ''
  return (
    <div className="study-quiz-start">
      {points.length === 0 ? null : <PointList points={points} />}
      {blocked !== undefined ? (
        <p className="study-muted">{blockLine}</p>
      ) : !canGenerate ? (
        <p className="study-muted">
          还没有可用的模型：过关测试每次要现场出题、作答由模型判分。先在设置里配置文本引擎，这里就会开。
        </p>
      ) : review ? (
        <p className="study-muted">到期复习：这次只看这一个知识点，答完按回忆质量重排下一次复习。</p>
      ) : ready ? (
        <p className="study-muted">这一节的知识点都到档了。等复习到期，或从今日面板进复习。</p>
      ) : needsConcepts ? (
        <p className="study-muted">目标覆盖了这一节，但还没有知识点。补上之后，这里才会记录到档进度。</p>
      ) : (
        <p className="study-muted">
          {`这一节 ${String(points.length)} 个知识点，${String(index.open)} 个还没到档。每次挑最接近到档的两三个出一道，答对一起记。`}
        </p>
      )}
      <div className="study-quiz-start-actions">
        {blocked !== undefined ? null : needsConcepts ? (
          <>
            <button
              type="button"
              className="study-primary study-primary-tight"
              disabled={busy || !canGenerate}
              onClick={onExtract}
            >
              {busy ? (waited >= 1 ? `抽取中…已 ${waited} 秒` : '抽取中…') : '补知识点'}
            </button>
            {canGenerate ? (
              <button type="button" className="study-ghost" disabled={busy} onClick={onStart}>
                {busy ? '准备中…' : '开始练习（先抽知识点）'}
              </button>
            ) : null}
          </>
        ) : ready && !review ? null : (
          <button
            type="button"
            className="study-primary study-primary-tight"
            disabled={busy || !canGenerate}
            onClick={onStart}
          >
            {busy ? (waited >= 1 ? `正在出题…已 ${waited} 秒` : '正在出题…') : review ? '开始复习' : '开始练习'}
          </button>
        )}
      </div>
    </div>
  )
}

/** One bar per knowledge point: current mastery against the goal threshold. */
function PointList({ points, compact = false }: { points: QuizPointView[]; compact?: boolean }): ReactElement {
  return (
    <ul className={`study-quiz-points${compact ? ' is-compact' : ''}`}>
      {points.map(point => {
        const pct = Math.max(0, Math.min(100, Math.floor(point.mastery * 100)))
        const target = Math.max(0, Math.min(100, Math.round(point.threshold * 100)))
        return (
          <li
            key={point.id}
            className={`study-quiz-point${point.atTarget ? ' is-on' : ''}`}
            title={`${point.id} · ${pct}% / 目标 ${target}%`}
          >
            <span className="study-quiz-point-name">{point.name}</span>
            <span className="study-quiz-point-bar" aria-hidden="true">
              <span className="study-quiz-point-fill" style={{ width: `${pct}%` }} />
              <span className="study-quiz-point-target" style={{ left: `${target}%` }} />
            </span>
            <span className="study-quiz-point-value">
              {pct}% / {target}%
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* ------------------------------------------------- between the questions - */

/** The run after an answer, before the next question exists (or after a refresh). */
export function BetweenQuestions({
  session,
  busy,
  waited,
  error,
  onNext,
  onFinish,
}: {
  session: QuizSessionView['session']
  busy: boolean
  waited: number
  error?: string
  onNext: () => void
  onFinish: () => void
}): ReactElement {
  return (
    <div className="study-quiz-start">
      <p className="study-muted">
        第 {session.count + 1} 题还没写。答过的已经记下了，出题单独走一次调用。
      </p>
      {error === undefined ? null : <p className="study-form-error">{error}</p>}
      <div className="study-quiz-start-actions">
        <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={onNext}>
          {busy ? (waited >= 1 ? `出题中…已 ${waited} 秒` : '出题中…') : '出下一题'}
        </button>
        <button type="button" className="study-link" disabled={busy} onClick={onFinish}>
          结束练习
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- summary - */

/** One line that says what the run actually proved. */
function summaryHeadline(summary: QuizSessionSummary, gapCount: number): string {
  if (summary.review === true) {
    return summary.verdict === 'passed' ? '这个知识点回来了' : '这次复习没走完'
  }
  if (summary.verdict === 'passed') return '本节知识点都到档了'
  return gapCount === 0 ? '这次练习结束了' : `还差 ${String(gapCount)} 个知识点`
}

export function SummaryBlock({
  session,
  summary,
  busy = false,
  waited = 0,
  onContinue,
  onExit,
}: {
  session: QuizSessionView['session']
  summary?: QuizSessionSummary
  busy?: boolean
  waited?: number
  onContinue?: () => void
  onExit?: () => void
}): ReactElement {
  const shown = summary?.points ?? []
  const gap = summary?.gap ?? []
  return (
    <div className="study-quiz-summary">
      <h3>{endTitle(session.endedReason)}</h3>
      {summary === undefined ? null : (
        <>
          <p className={`study-quiz-score${summary.verdict === 'passed' ? '' : ' is-open'}`}>
            {summaryHeadline(summary, gap.length)}
          </p>
          <p className="study-muted">
            答了 {summary.count} 题。
            {summary.atTarget === undefined
              ? ''
              : ` 到档 ${String(summary.atTarget.passed)}/${String(summary.atTarget.total)}。`}
          </p>
          {summary.note === undefined ? null : <p className="study-form-error">{summary.note}</p>}
          {shown.length === 0 ? null : <PointList points={shown} />}
          {gap.length === 0 ? null : <p className="study-muted">还差：{gap.map(point => point.name).join('、')}</p>}
        </>
      )}
      {onContinue === undefined && onExit === undefined ? null : (
        <div className="study-quiz-summary-actions">
          {onContinue === undefined ? null : (
            <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={onContinue}>
              {busy ? (waited >= 1 ? `出题中…已 ${waited} 秒` : '出题中…') : '继续练'}
            </button>
          )}
          {onExit === undefined ? null : (
            <button type="button" className="study-ghost" onClick={onExit}>
              回到首页
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- labels ---- */

function judgedLabel(verdict: 'pass' | 'partial' | 'fail'): string {
  return verdict === 'pass' ? '通过' : verdict === 'partial' ? '还差一点' : '未通过'
}

function endTitle(reason: QuizSessionView['session']['endedReason']): string {
  switch (reason) {
    case 'completed':
      return '本节知识点都到档了'
    case 'exhausted':
      return '下一题没出出来，先停在这'
    case 'finished':
      return '这次练习提前结束'
    case 'replaced':
      return '这次练习被新的一次替换了'
    default:
      return '这次练习结束'
  }
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