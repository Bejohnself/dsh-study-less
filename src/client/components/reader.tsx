/**
 * The shared unit reader.
 *
 * It is opened from the library, a plan step and the review session. Reading,
 * generating notes, practising and extracting insights all happen here, so the
 * three top-level sections never need a second copy of the reader.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { InsightCard, JobView, QuizSubmitView, UnitView } from '../../core/views.ts'
import { api, errorText, post, waitForJob } from '../api.ts'
import { insightKindLabel } from '../labels.ts'
import { EmptyState, JobBanner, Markdown, Toast } from './ui.tsx'

/** Reader tabs. */
type ReaderTab = 'notes' | 'original' | 'quiz' | 'extras'

/** One extra asset as returned by the unit view. */
type Extra = UnitView['extras'][number]

/** Render one extra asset safely. */
function ExtraView({ asset }: { asset: Extra }): ReactElement {
  if (asset.kind === 'image') {
    return (
      <figure className="study-extra">
        <img src={asset.url} alt={asset.name} loading="lazy" />
        <figcaption>{asset.name}</figcaption>
      </figure>
    )
  }
  if (asset.kind === 'video') {
    return (
      <figure className="study-extra">
        <video controls src={asset.url} />
        <figcaption>{asset.name}</figcaption>
      </figure>
    )
  }
  if (asset.kind === 'animation') {
    return (
      <figure className="study-extra">
        <iframe
          className="study-anim"
          src={asset.url}
          sandbox="allow-scripts"
          title={asset.name}
          loading="lazy"
        />
        <figcaption>{asset.name}</figcaption>
      </figure>
    )
  }
  return (
    <figure className="study-extra">
      <a href={asset.url} target="_blank" rel="noreferrer">
        {asset.name}
      </a>
    </figure>
  )
}

/** The reader for one unit. */
export function UnitReader({
  mid,
  uid,
  planId,
  onBack,
  onOpenConcept,
  onOpenInsight,
  onChanged,
}: {
  mid: string
  uid: string
  planId?: string
  onBack: () => void
  onOpenConcept: (cid: string) => void
  onOpenInsight?: (iid: string) => void
  onChanged?: () => void
}): ReactElement {
  const [unit, setUnit] = useState<UnitView | null>(null)
  const [tab, setTab] = useState<ReaderTab>('original')
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [quizResult, setQuizResult] = useState<QuizSubmitView | null>(null)

  const load = useCallback(async () => {
    const value = await api<UnitView>(`/unit?mid=${encodeURIComponent(mid)}&uid=${encodeURIComponent(uid)}`)
    setUnit(value)
    setTab(value.notes !== null ? 'notes' : 'original')
    return value
  }, [mid, uid])

  useEffect(() => {
    let alive = true
    setUnit(null)
    setError(null)
    setAnswers({})
    setQuizResult(null)
    setJob(null)
    load().catch(reason => {
      if (alive) setError(errorText(reason))
    })
    return () => {
      alive = false
    }
  }, [load])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const runJob = useCallback(
    async (path: string, body: Record<string, unknown>, started: string) => {
      setBusy(started)
      setJob(null)
      try {
        const { jobId } = await post<{ jobId: string }>(path, body)
        const finished = await waitForJob(jobId, setJob)
        if (finished.status === 'done') {
          await load()
          onChanged?.()
          setToast({ message: '生成完成', tone: 'ok' })
        } else if (finished.status === 'failed') {
          setToast({ message: finished.error ?? '生成失败', tone: 'error' })
        }
      } catch (reason) {
        setToast({ message: errorText(reason), tone: 'error' })
      } finally {
        setBusy(null)
        setJob(null)
      }
    },
    [load, onChanged],
  )

  const generate = (kind: 'unit' | 'quiz' | 'insight') => {
    if (kind === 'unit' && unit !== null && unit.notes !== null) {
      if (!window.confirm('这一节已有精读稿，重新生成会覆盖它。继续？')) return
    }
    if (kind === 'quiz' && unit !== null && unit.quiz !== null) {
      if (!window.confirm('这一节已有练习题，重新生成会覆盖它。继续？')) return
    }
    void runJob(
      `/generate/${kind}`,
      { mid, uid, ...(planId === undefined ? {} : { planId }) },
      kind === 'unit' ? '正在生成精读…' : kind === 'quiz' ? '正在出题…' : '正在提炼洞察…',
    )
  }

  const cancel = async (): Promise<void> => {
    if (job === null) return
    try {
      await post(`/jobs/${encodeURIComponent(job.id)}/cancel`, {})
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  const submitQuiz = async (): Promise<void> => {
    if (unit?.quiz == null) return
    try {
      const payload = unit.quiz.items.map(item => {
        const raw = answers[item.id] ?? ''
        if (item.type === 'choice') return { itemId: item.id, answer: Number(raw) }
        return { itemId: item.id, answer: raw }
      })
      const result = await post<QuizSubmitView>('/quiz/submit', { mid, uid, answers: payload })
      setQuizResult(result)
      setToast({ message: `得分 ${Math.round(result.score * 100)}%，建议评级 ${result.ratingSuggestion}`, tone: 'ok' })
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  if (error !== null) return <div className="study-empty">无法打开这一节：{error}</div>
  if (unit === null) return <div className="study-empty">正在载入…</div>

  const insights: InsightCard[] = unit.insights

  return (
    <div className="study-reader">
      <div className="study-reader-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 返回
        </button>
        <div className="study-reader-title">
          <h2>{unit.unit.title}</h2>
          <span className="study-reader-sub">
            p{unit.unit.pageStart}
            {unit.unit.pageEnd > unit.unit.pageStart ? `–${unit.unit.pageEnd}` : ''} · {unit.material.title}
          </span>
        </div>
        <div className="study-tabs">
          <button type="button" className={tab === 'original' ? 'is-on' : ''} onClick={() => setTab('original')}>
            原文
          </button>
          <button type="button" className={tab === 'notes' ? 'is-on' : ''} onClick={() => setTab('notes')}>
            精读
          </button>
          <button type="button" className={tab === 'quiz' ? 'is-on' : ''} onClick={() => setTab('quiz')}>
            练习{unit.quiz === null ? '' : ` ${unit.quiz.items.length}`}
          </button>
          <button type="button" className={tab === 'extras' ? 'is-on' : ''} onClick={() => setTab('extras')}>
            图·动画{unit.extras.length === 0 ? '' : ` ${unit.extras.length}`}
          </button>
        </div>
      </div>

      {unit.unit.concepts.length > 0 ? (
        <div className="study-chips">
          {unit.unit.concepts.map(conceptId => (
            <button key={conceptId} type="button" className="study-chip" onClick={() => onOpenConcept(conceptId)}>
              {conceptId}
            </button>
          ))}
        </div>
      ) : null}

      <div className="study-reader-actions">
        <button
          type="button"
          className="study-primary study-primary-tight"
          disabled={busy !== null}
          onClick={() => generate('unit')}
        >
          {busy === '正在生成精读…' ? '生成中…' : unit.notes === null ? '生成精读' : '重写精读'}
        </button>
        <button
          type="button"
          className="study-ghost"
          disabled={busy !== null || unit.notes === null}
          onClick={() => generate('quiz')}
        >
          生成练习
        </button>
        <button
          type="button"
          className="study-ghost"
          disabled={busy !== null || unit.notes === null}
          onClick={() => generate('insight')}
        >
          提炼洞察
        </button>
        {insights.length > 0 ? <span className="study-muted">已提炼 {insights.length} 条</span> : null}
      </div>

      {job === null ? null : <JobBanner job={job} onCancel={() => void cancel()} />}
      {busy !== null && job === null ? <div className="study-muted">{busy}</div> : null}

      {tab === 'notes' ? (
        unit.notes === null ? (
          <EmptyState
            title="这一节还没有精读稿。"
            hint="点「生成精读」会在页面内直接调用已配置的文本引擎；没有配置时会提示你先去设置。"
            action={{ label: '生成精读', onClick: () => generate('unit') }}
          />
        ) : (
          <>
            <Markdown source={unit.notes} />
            {insights.length > 0 ? (
              <>
                <h3 className="study-section-title">这一节提炼的洞察</h3>
                <div className="study-insight-grid">
                  {insights.map(insight => (
                    <button
                      key={insight.id}
                      type="button"
                      className="study-insight-card"
                      onClick={() => onOpenInsight?.(insight.id)}
                    >
                      <span className="study-insight-kind">{insightKindLabel(insight.kind)}</span>
                      <span className="study-insight-title">{insight.title}</span>
                      <span className="study-insight-line">{insight.oneLiner}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )
      ) : null}

      {tab === 'original' ? (
        <div className="study-original">
          {unit.original.map(page => (
            <section key={page.page} className="study-page-slice">
              <span className="study-page-no">p{page.page}</span>
              <pre>{page.text}</pre>
            </section>
          ))}
          {unit.truncated ? <div className="study-truncated">原文较长，这里只显示前 30 页。</div> : null}
        </div>
      ) : null}

      {tab === 'quiz' ? (
        unit.quiz === null ? (
          <EmptyState
            title="还没有练习题。"
            hint="先生成精读，再点「生成练习」；题目会挂到概念上，提交后更新掌握度。"
            action={{ label: '生成练习', onClick: () => generate('quiz') }}
          />
        ) : (
          <div className="study-quiz">
            {unit.quiz.items.map((item, index) => {
              const verdict = quizResult?.attempts.find(attempt => attempt.itemId === item.id)
              return (
                <section key={item.id} className={`study-quiz-item${verdict === undefined ? '' : verdict.correct === true ? ' is-correct' : verdict.correct === false ? ' is-wrong' : ''}`}>
                  <div className="study-quiz-head">
                    <span className="study-quiz-index">{index + 1}</span>
                    <span className="study-quiz-type">{item.type}</span>
                    {item.page === undefined ? null : <span className="study-muted">p{item.page}</span>}
                  </div>
                  <p className="study-quiz-question">{item.question}</p>
                  {item.type === 'choice' && item.choices !== undefined ? (
                    <div className="study-quiz-choices">
                      {item.choices.map((choice, choiceIndex) => (
                        <label key={`${item.id}-${choiceIndex}`} className="study-quiz-choice">
                          <input
                            type="radio"
                            name={item.id}
                            checked={answers[item.id] === String(choiceIndex)}
                            disabled={quizResult !== null}
                            onChange={() => setAnswers(previous => ({ ...previous, [item.id]: String(choiceIndex) }))}
                          />
                          <span>{choice}</span>
                        </label>
                      ))}
                    </div>
                  ) : item.type === 'cloze' || item.type === 'evidence' ? (
                    <input
                      type="text"
                      className="study-input"
                      value={answers[item.id] ?? ''}
                      disabled={quizResult !== null}
                      onChange={event => setAnswers(previous => ({ ...previous, [item.id]: event.target.value }))}
                    />
                  ) : (
                    <textarea
                      className="study-input study-textarea"
                      value={answers[item.id] ?? ''}
                      disabled={quizResult !== null}
                      onChange={event => setAnswers(previous => ({ ...previous, [item.id]: event.target.value }))}
                    />
                  )}
                  {verdict === undefined ? null : (
                    <p className="study-muted">
                      {verdict.correct === null ? '主观题，请自行对照评分要点。' : verdict.correct ? '正确' : '错误'}
                      {verdict.expected === undefined ? '' : ` · 参考答案：${verdict.expected}`}
                    </p>
                  )}
                </section>
              )
            })}
            {quizResult === null ? (
              <button type="button" className="study-primary study-primary-tight" onClick={() => void submitQuiz()}>
                提交并更新掌握度
              </button>
            ) : (
              <div className="study-quiz-score">
                得分 {Math.round(quizResult.score * 100)}% · 建议评级 {quizResult.ratingSuggestion}
              </div>
            )}
          </div>
        )
      ) : null}

      {tab === 'extras' ? (
        unit.extras.length === 0 ? (
          <EmptyState title="还没有图片或动画。" hint="媒体生成会在后续阶段接入；这里已经能安全渲染已生成的资产。" />
        ) : (
          <div className="study-extras">
            {unit.extras.map(asset => (
              <ExtraView key={asset.name} asset={asset} />
            ))}
          </div>
        )
      ) : null}

      {toast === null ? null : <Toast message={toast.message} tone={toast.tone} />}
    </div>
  )
}
