/**
 * The live run, its summary and its past rounds.
 *
 * Split from quiz.tsx: the runner owns fetching and scope, these render one
 * session. They take everything through props, so the runner stays the only
 * state owner.
 */
import {useEffect, useState} from 'react'
import type {ReactElement} from 'react'
import type {QuizFeedbackView, QuizHistoryEntryView, QuizItemView, QuizPointView, QuizSessionIndexView, QuizSessionRecordView, QuizSessionSummary, QuizSessionView} from '../../core/views.ts'
import type {QuizSelfGrade} from '../../core/types.ts'
import {errorText} from '../api.ts'
import {InlineMarkdown, Markdown, ProgressBar} from './ui.tsx'
import {UsageNote} from './usage.tsx'
import type {QuizRunnerScope} from './quiz.tsx'

export function ActiveRun({
  view,
  feedback,
  nextItem,
  resumed,
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
  nextItem: QuizItemView | null
  resumed: boolean
  answer: string
  busy: boolean
  /** Seconds spent waiting on the current submit. */
  waited: number
  onAnswer: (value: string) => void
  onSubmit: (selfGrade?: QuizSelfGrade) => void
  onFill: (want: 'pass' | 'fail') => void
  onAppeal: (itemId: string, selfGrade: QuizSelfGrade, reason: string) => Promise<boolean>
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
  const progress = session.limit === 0 ? 0 : (session.asked / session.limit) * 100
  const currentNumber = Math.max(1, Math.min(session.asked + (feedback === null ? 1 : 0), session.limit))
  const last = view.history[view.history.length - 1]
  const atTarget = session.atTarget
  // Show the live preview once the answer actually contains a math delimiter;
  // plain prose would only be duplicated underneath the textarea.
  const hasMath = /\$|\\\(|\\\[|\\begin\{/.test(answer)
  const written = current.type !== 'choice'

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
        {atTarget === undefined || session.free === true || session.review === true ? null : (
          <span className={atTarget.passed === atTarget.total ? 'study-quiz-progress-num is-on' : 'study-quiz-progress-num'}>
            到档 {atTarget.passed}/{atTarget.total}
          </span>
        )}
        <span className="study-quiz-progress-num">
          正确 {session.correct}/{session.objective}
        </span>
        <span className="study-muted">
          {session.review === true ? '到期复习' : session.free === true ? '旧版自由练习 · 没记进度' : '按目标档位'}
        </span>
      </div>
      <ProgressBar percent={progress} />
      {(view.points ?? []).length === 0 ? null : <PointList points={view.points ?? []} compact />}

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
          <>
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
            onClick={() => onSubmit()}
          >
            {busy ? (waited >= 3 ? `判分中…已 ${waited} 秒` : '判分中…') : '提交本题'}
          </button>
          <button type="button" className="study-link" disabled={busy} onClick={onFinish}>
            结束这一组
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
          <UsageNote usage={feedback.usage} prefix="本题" />
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
            <p className="study-muted">
              {feedback.judgeUnavailable}，先自评。自评只留在本轮记录里，不计掌握度——没有引擎时这一节不会到档。
            </p>
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

/* ------------------------------------------------------------ start screen - */

/** What the page shows before a run: the section's points and the one action. */
export function QuizStart({
  scope,
  index,
  busy,
  onStart,
  onExtract,
}: {
  scope: QuizRunnerScope
  index: QuizSessionIndexView
  busy: boolean
  onStart: () => void
  onExtract: () => void
}): ReactElement {
  const points = index.points ?? []
  const ready = index.ready === true
  const needsConcepts = index.needsConcepts === true
  const canGenerate = index.canGenerate === true
  const blocked = index.blocked
  const blockLine =
    blocked === 'no-goal'
      ? '还没有学习目标：练习只在目标里跑并写进度，先新建一个目标。'
      : blocked === 'outside-goal'
        ? '这一节不在当前目标里：先把它加进目标的路线。'
        : ''
  const noQuestions = index.bank.items === 0 && !canGenerate
  return (
    <div className="study-quiz-start">
      {points.length === 0 ? null : <PointList points={points} />}
      {blocked === undefined ? (
        <p className="study-muted">
          {ready
            ? '这一节的知识点都到档了。等复习到期，或从今日面板进复习。'
            : needsConcepts
              ? '目标覆盖了这一节，但还没有知识点。补上之后，这里才会记录到档进度。'
              : `这一${scope.kind === 'unit' ? '节' : '章'} ${String(index.bank.items)} 题；这一组最多 ${String(
                  index.bank.defaultLimit,
                )} 题，按你答得怎么样挑题。知识点都到档了才收。`}
        </p>
      ) : (
        <p className="study-muted">{blockLine}</p>
      )}
      {blocked === undefined && !ready && index.bank.items === 0 && canGenerate ? (
        <p className="study-muted">题库还是空的：开始练习会先按这一节的知识点现场出题。</p>
      ) : null}
      <div className="study-quiz-start-actions">
        {blocked !== undefined ? null : needsConcepts ? (
          <>
            <button
              type="button"
              className="study-primary study-primary-tight"
              disabled={busy || !canGenerate}
              onClick={onExtract}
            >
              {busy ? '抽取中…' : '补知识点'}
            </button>
            {canGenerate ? (
              <button type="button" className="study-ghost" disabled={busy} onClick={onStart}>
                {busy ? '准备中…' : '开始练习（先抽知识点）'}
              </button>
            ) : (
              <span className="study-muted">需要先在设置里配置文本引擎，才能从原文抽知识点。</span>
            )}
          </>
        ) : ready ? null : (
          <button
            type="button"
            className="study-primary study-primary-tight"
            disabled={busy || noQuestions}
            onClick={onStart}
          >
            {busy ? '准备中…（可能要补知识点或补题）' : '开始练习'}
          </button>
        )}
        {blocked === undefined && noQuestions && !needsConcepts ? (
          <span className="study-muted">这一节还没有题库，也没有可用的文本引擎。</span>
        ) : null}
      </div>
    </div>
  )
}

/** One bar per knowledge point: current mastery against the goal threshold. */
function PointList({ points, compact = false }: { points: QuizPointView[]; compact?: boolean }): ReactElement {
  return (
    <ul className={`study-quiz-points${compact ? ' is-compact' : ''}`}>
      {points.map(point => {
        const pct = Math.max(0, Math.min(100, Math.round(point.mastery * 100)))
        const target = Math.max(0, Math.min(100, Math.round(point.threshold * 100)))
        const answered =
          point.answered === undefined
            ? ''
            : point.answered === 'pass'
              ? ' · 本组通过'
              : point.answered === 'partial'
                ? ' · 本组还差一点'
                : ' · 本组未通过'
        return (
          <li
            key={point.id}
            className={`study-quiz-point${point.atTarget ? ' is-on' : ''}`}
            title={`${point.id} · ${pct}% / 目标 ${target}%${answered}`}
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

/* --------------------------------------------------------- summary/history - */

/** One line that says what the run actually proved. */
function summaryHeadline(summary: QuizSessionSummary, gapCount: number): string {
  if (summary.free === true) return '旧版自由练习结束 · 没记进度'
  if (summary.review === true) {
    return summary.verdict === 'passed' ? '这次复习完成' : '这一组复习没走完'
  }
  if (summary.verdict === 'passed') return '本节知识点都到档了'
  if (summary.verdict === 'failed') {
    return gapCount === 0 ? '这一组结束了' : `这一组还差 ${String(gapCount)} 个知识点`
  }
  return '这一组提前结束了'
}

export function SummaryBlock({
  session,
  points,
  summary,
  onContinue,
  onExit,
}: {
  session: QuizSessionView['session']
  points: QuizPointView[]
  summary?: QuizSessionSummary
  onContinue?: () => void
  onExit?: () => void
}): ReactElement {
  const shown = summary?.points ?? points ?? []
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
            答了 {summary.asked} 题，有效证据 {summary.objective} 题。
            {summary.atTarget === undefined
              ? ''
              : ` 到档 ${String(summary.atTarget.passed)}/${String(summary.atTarget.total)}。`}
            {summary.free === true ? ' 这一组是旧版自由练习，不计进度。' : ''}
          </p>
          {shown.length === 0 ? null : <PointList points={shown} />}
          {summary.free === true || gap.length === 0 ? null : (
            <p className="study-muted">
              还差：{gap.map(point => point.name).join('、')}
            </p>
          )}
        </>
      )}
      {onContinue === undefined && onExit === undefined ? null : (
        <div className="study-quiz-summary-actions">
          {onContinue === undefined ? null : (
            <button type="button" className="study-primary study-primary-tight" onClick={onContinue}>
              再来一组
            </button>
          )}
          {onExit === undefined ? null : (
            <button type="button" className="study-ghost" onClick={onExit}>
              回到目标
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function HistorySection({
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

export function RecentRow({
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

export function whenText(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}