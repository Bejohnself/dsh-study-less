/**
 * 学习之路: today, paths and review.
 *
 * This is the main surface: one goal becomes concrete steps, each step opens the
 * shared reader, and completing a unit puts it into the FSRS due queue.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  DueItem,
  JobView,
  MaterialCard,
  PlanDetailView,
  PlanSummary,
  TodayView,
  UnitView,
} from '../../core/views.ts'
import { api, errorText, post, waitForJob } from '../api.ts'
import { currentSessionId, openConversation } from '../actions.ts'
import { stepKindLabel, typeLabel } from '../labels.ts'
import { EmptyState, JobBanner, Modal, ProgressBar, SubNav, Toast } from '../components/ui.tsx'

export type LearnTab = 'today' | 'paths' | 'review'

/** The learning-path dashboard. */
export function LearnPage({
  tab,
  onTab,
  onOpenUnit,
  onOpenConcept,
  onOpenInsight,
  onOpenPlan,
  onOpenLibrary,
  refreshToken,
  onChanged,
}: {
  tab: LearnTab
  onTab: (tab: LearnTab) => void
  onOpenUnit: (mid: string, uid: string, planId?: string) => void
  onOpenConcept: (cid: string) => void
  onOpenInsight: (iid: string) => void
  onOpenPlan: (pid: string) => void
  onOpenLibrary: () => void
  refreshToken: number
  onChanged: () => void
}): ReactElement {
  return (
    <div className="study-learn">
      <div className="study-learn-bar">
        <SubNav
          items={[
            { id: 'today', label: '今日' },
            { id: 'paths', label: '路径' },
            { id: 'review', label: '复习' },
          ]}
          active={tab}
          onSelect={onTab}
        />
      </div>

      {tab === 'today' ? (
        <TodayPanel
          onOpenUnit={onOpenUnit}
          onOpenConcept={onOpenConcept}
          onOpenInsight={onOpenInsight}
          onOpenPlan={onOpenPlan}
          onOpenLibrary={onOpenLibrary}
          refreshToken={refreshToken}
        />
      ) : null}
      {tab === 'paths' ? (
        <PlansPanel onOpenPlan={onOpenPlan} refreshToken={refreshToken} onOpenLibrary={onOpenLibrary} />
      ) : null}
      {tab === 'review' ? <ReviewPanel onOpenUnit={onOpenUnit} onOpenConcept={onOpenConcept} onChange={onChanged} refreshToken={refreshToken} /> : null}
    </div>
  )
}

function TodayPanel({
  onOpenUnit,
  onOpenConcept,
  onOpenInsight,
  onOpenPlan,
  onOpenLibrary,
  refreshToken,
}: {
  onOpenUnit: (mid: string, uid: string, planId?: string) => void
  onOpenConcept: (cid: string) => void
  onOpenInsight: (iid: string) => void
  onOpenPlan: (pid: string) => void
  onOpenLibrary: () => void
  refreshToken: number
}): ReactElement {
  const [data, setData] = useState<TodayView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setError(null)
    api<TodayView>('/today')
      .then(value => {
        if (alive) setData(value)
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [refreshToken])

  if (error !== null) return <div className="study-empty">无法读取今日面板：{error}</div>
  if (data === null) return <div className="study-empty">正在整理今天的任务…</div>

  const nothing = data.due.length === 0 && data.next === null && data.weak.length === 0 && data.plans.length === 0

  return (
    <div className="study-today">
      <div className="study-today-line">
        <span className="study-today-date">{data.date}</span>
        <span className="study-muted">今天已完成 {data.learnedToday} 节</span>
        <span className="study-muted">·</span>
        <span className={data.due.length > 0 ? 'study-warn-text' : 'study-muted'}>
          {data.due.length > 0 ? `${data.due.length} 节待复习` : '没有到期复习'}
        </span>
        <span className="study-today-spacer" />
      </div>

      {nothing ? (
        <EmptyState
          title="还没有可学的内容。"
          hint="先导入资料，再新建一个目标；也可以直接在对话里说「我想搞懂 X」，让 Agent 从清单里排路径。"
          action={{ label: '去变强清单', onClick: onOpenLibrary }}
        />
      ) : null}

      <div className="study-today-grid">
        <section className="study-panel study-panel-next">
          <h3>下一步</h3>
          {data.next === null ? (
            <p className="study-muted">所有单元都已学完，接下来靠复习巩固。</p>
          ) : (
            <button type="button" className="study-next-card" onClick={() => onOpenUnit(data.next!.materialId, data.next!.unitId)}>
              <span className="study-next-title">{data.next.title}</span>
              <span className="study-item-meta">
                {data.next.materialTitle} · {data.next.source === 'plan' ? '来自学习路径' : '书序下一节'}
              </span>
              <span className="study-next-why">{data.next.why}</span>
            </button>
          )}
          {data.plans.length > 0 ? (
            <ul className="study-plans">
              {data.plans.map(plan => (
                <li key={plan.id}>
                  <button type="button" className="study-plan-row" onClick={() => onOpenPlan(plan.id)}>
                    <span className="study-plan-goal">{plan.goal}</span>
                    <span className="study-item-meta">
                      {plan.done}/{plan.total} 步{plan.next === undefined ? '' : ` · 下一步：${plan.next.title}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="study-panel">
          <h3>复习到期</h3>
          {data.due.length === 0 ? (
            <p className="study-muted">今天没有到期卡片。间隔重复的收益来自「该复习时复习」，不用加练。</p>
          ) : (
            <ul className="study-list">
              {data.due.slice(0, 6).map(item => (
                <li key={item.key}>
                  <button type="button" className="study-item" onClick={() => onOpenUnit(item.materialId, item.unitId)}>
                    <span className="study-item-title">{item.title}</span>
                    <span className="study-item-meta">
                      {item.materialTitle} · 到期 {item.due}
                      {item.overdueDays > 0 ? ` · 逾期 ${item.overdueDays} 天` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="study-panel">
          <h3>薄弱概念</h3>
          {data.weak.length === 0 ? (
            <p className="study-muted">还没有足够练习数据。学完几节、做几道题后这里会出现需要加固的概念。</p>
          ) : (
            <ul className="study-list">
              {data.weak.map(concept => (
                <li key={concept.id}>
                  <button type="button" className="study-item" onClick={() => onOpenConcept(concept.id)}>
                    <span className="study-item-title">{concept.name}</span>
                    <span className="study-item-meta">
                      掌握度 {Math.round(concept.mastery * 100)}% · {concept.occurrences} 处出现
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {data.pinnedInsight === undefined ? null : (
        <button type="button" className="study-pinned-insight" onClick={() => onOpenInsight(data.pinnedInsight!.id)}>
          <span className="study-insight-kind">今日洞察</span>
          <span className="study-insight-title">{data.pinnedInsight.title}</span>
          <span className="study-insight-line">{data.pinnedInsight.oneLiner}</span>
        </button>
      )}
    </div>
  )
}

/** The path list. */
function PlansPanel({
  onOpenPlan,
  onOpenLibrary,
  refreshToken,
}: {
  onOpenPlan: (pid: string) => void
  onOpenLibrary: () => void
  refreshToken: number
}): ReactElement {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<PlanSummary[]>('/plans')
      .then(value => {
        if (alive) setPlans(value)
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [refreshToken])

  if (error !== null) return <div className="study-empty">无法读取路径：{error}</div>
  if (plans === null) return <div className="study-empty">正在读取学习路径…</div>
  if (plans.length === 0) {
    return (
      <EmptyState
        title="还没有学习路径。"
        hint="用右上角「＋ 新建目标」选资料并说清目标；Host 会在页面内直接编排，不需要再复制 prompt 到聊天。"
      />
    )
  }

  return (
    <div className="study-plans-page">
      {plans.map(plan => {
        const percent = plan.total === 0 ? 0 : Math.round((plan.done / plan.total) * 100)
        return (
          <button key={plan.id} type="button" className="study-plan-card" onClick={() => onOpenPlan(plan.id)}>
            <span className="study-plan-head">
              <span className="study-plan-goal">{plan.goal}</span>
              <span className={`study-status-pill study-status-${plan.status}`}>
                {plan.status === 'draft'
                  ? '编排中'
                  : plan.status === 'active'
                    ? '进行中'
                    : plan.status === 'paused'
                      ? '已暂停'
                      : '已完成'}
              </span>
            </span>
            <ProgressBar percent={percent} label={`${plan.done}/${plan.total} 步`} />
            <span className="study-progress-text">
              {plan.done}/{plan.total} 步{plan.next === undefined ? '' : ` · 下一步：${plan.next}`}
            </span>
          </button>
        )
      })}
      <div className="study-plans-footer">
        <button type="button" className="study-link" onClick={onOpenLibrary}>
          去清单选资料
        </button>
      </div>
    </div>
  )
}

/** One plan with its steps and inline generation. */
export function PlanDetailPage({
  pid,
  onBack,
  onOpenUnit,
  onOpenConcept,
  onOpenInsight,
  refreshToken,
  onChanged,
}: {
  pid: string
  onBack: () => void
  onOpenUnit: (mid: string, uid: string, planId?: string) => void
  onOpenConcept: (cid: string) => void
  onOpenInsight: (iid: string) => void
  refreshToken: number
  onChanged: () => void
}): ReactElement {
  const [data, setData] = useState<PlanDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)

  const reload = useCallback(async () => {
    setData(await api<PlanDetailView>(`/plan?pid=${encodeURIComponent(pid)}`))
  }, [pid])

  useEffect(() => {
    let alive = true
    setError(null)
    reload().catch(reason => {
      if (alive) setError(errorText(reason))
    })
    return () => {
      alive = false
    }
  }, [reload, refreshToken])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const generation = data?.plan.generation
  useEffect(() => {
    if (generation?.jobId === undefined) return
    if (generation.status !== 'queued' && generation.status !== 'running') return
    let alive = true
    void waitForJob(generation.jobId, jobValue => {
      if (alive) setJob(jobValue)
    })
      .then(async () => {
        if (!alive) return
        await reload()
        onChanged()
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [generation?.jobId, generation?.status, onChanged, reload])

  const removePlan = async (): Promise<void> => {
    if (!window.confirm('删除这条学习路径？单元内容与进度不会被删除。')) return
    try {
      await post('/plan/delete', { pid })
      onChanged()
      onBack()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  const toggle = async (n: number, done: boolean): Promise<void> => {
    setBusy(n)
    try {
      await post('/plan/update', { pid, setStep: { n, done } })
      await reload()
      onChanged()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const generateStep = async (materialId: string, unitId: string, n: number): Promise<void> => {
    setBusy(n)
    setJob(null)
    try {
      const { jobId } = await post<{ jobId: string }>('/generate/unit', { mid: materialId, uid: unitId, planId: pid })
      const finished = await waitForJob(jobId, setJob)
      if (finished.status === 'done') {
        await reload()
        onChanged()
        setToast({ message: '这一节的精读与练习已生成', tone: 'ok' })
      } else if (finished.status === 'failed') {
        setToast({ message: finished.error ?? '生成失败', tone: 'error' })
      }
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setBusy(null)
      setJob(null)
    }
  }

  if (error !== null) return <div className="study-empty">无法读取路径：{error}</div>
  if (data === null) return <div className="study-empty">正在载入路径…</div>

  return (
    <div className="study-plan-detail">
      <div className="study-material-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 路径
        </button>
        <div className="study-reader-title">
          <h2>{data.plan.goal}</h2>
          <span className="study-reader-sub">
            {data.done}/{data.total} 步
            {data.plan.hoursPerWeek === undefined ? '' : ` · 每周约 ${data.plan.hoursPerWeek} 小时`}
          </span>
        </div>
        <button type="button" className="study-ghost study-danger-text" onClick={() => void removePlan()}>
          删除路径
        </button>
      </div>

      {data.plan.status === 'draft' ? (
        <div className="study-banner">
          <span>
            {generation?.status === 'failed'
              ? `编排失败：${generation.error ?? '未知原因'}`
              : generation?.jobId === undefined
                ? '已创建目标；当前没有可用的页面内引擎，已交给对话或等待手动编排。'
                : '这条路径正在页面内编排；步骤写入后会自动变为「进行中」。'}
          </span>
          {generation?.jobId === undefined ? null : <JobBanner job={job ?? { ...emptyJob(generation.jobId), status: generation.status as JobView['status'] }} />}
          <button type="button" className="study-link" onClick={openConversation}>
            打开对话
          </button>
        </div>
      ) : null}

      {job !== null && data.plan.status !== 'draft' ? <JobBanner job={job} /> : null}
      {data.plan.brief === undefined ? null : <p className="study-definition">{data.plan.brief}</p>}

      <ol className="study-steps">
        {data.steps.map(step => {
          const isUnit = step.kind === 'unit' || step.kind === 'paper-pass'
          return (
            <li key={step.n} className={`study-step${step.done ? ' is-done' : ''}`}>
              <input
                type="checkbox"
                className="study-check"
                checked={step.done}
                disabled={busy === step.n}
                aria-label={`标记第 ${step.n} 步完成`}
                onChange={event => {
                  void toggle(step.n, event.target.checked)
                }}
              />
              <div className="study-step-body">
                <div className="study-step-title">
                  <span className="study-step-kind">{stepKindLabel(step.kind)}</span>
                  {step.target === undefined ? (
                    <span>{step.concepts?.map(concept => concept.name).join('、') ?? step.materials?.map(material => material.title).join(' / ') ?? '—'}</span>
                  ) : (
                    <button type="button" className="study-link" onClick={() => onOpenUnit(step.target!.materialId, step.target!.unitId, pid)}>
                      {step.target.title}
                    </button>
                  )}
                </div>
                <div className="study-item-meta">
                  {step.target === undefined ? '' : `${step.target.materialTitle} · `}
                  {step.why}
                </div>
                {step.concepts !== undefined && step.concepts.length > 0 ? (
                  <div className="study-chips">
                    {step.concepts.map(concept => (
                      <button key={concept.id} type="button" className="study-chip" onClick={() => onOpenConcept(concept.id)}>
                        {concept.name} · {Math.round(concept.mastery * 100)}%
                      </button>
                    ))}
                  </div>
                ) : null}
                {isUnit && step.target !== undefined ? (
                  <div className="study-step-actions">
                    <button
                      type="button"
                      className="study-ghost"
                      disabled={busy !== null}
                      onClick={() => void generateStep(step.target!.materialId, step.target!.unitId, step.n)}
                    >
                      {busy === step.n ? '生成中…' : '生成本步'}
                    </button>
                    <button type="button" className="study-link" onClick={() => onOpenUnit(step.target!.materialId, step.target!.unitId, pid)}>
                      去阅读
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      {toast !== null ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  )
}

function emptyJob(jobId: string): JobView {
  return {
    version: 1,
    id: jobId,
    kind: 'plan',
    status: 'queued',
    target: {},
    progress: 0,
    createdAt: new Date().toISOString(),
  }
}

/** The due-review queue and one-card session. */
function ReviewPanel({
  onOpenUnit,
  onOpenConcept,
  onChange,
  refreshToken,
}: {
  onOpenUnit: (mid: string, uid: string) => void
  onOpenConcept: (cid: string) => void
  onChange: () => void
  refreshToken: number
}): ReactElement {
  const [due, setDue] = useState<DueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const reportError = useCallback((message: string) => {
    setToast({ message, tone: 'error' })
  }, [])

  const reload = useCallback(async () => {
    setDue(await api<DueItem[]>('/due'))
  }, [])

  useEffect(() => {
    let alive = true
    setError(null)
    reload().catch(reason => {
      if (alive) setError(errorText(reason))
    })
    return () => {
      alive = false
    }
  }, [reload, refreshToken])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (error !== null) return <div className="study-empty">无法读取复习队列：{error}</div>
  if (due === null) return <div className="study-empty">正在读取复习队列…</div>

  if (due.length === 0) {
    return <EmptyState title="今天没有到期复习。" hint="完成单元后的第二天会进入这里；按评级更新下一次到期日。" />
  }

  const current = due[Math.min(index, due.length - 1)]
  if (current === undefined) return <div className="study-empty">队列已清空。</div>

  return (
    <div className="study-review">
      <div className="study-today-line">
        <span className="study-muted">
          待复习 {due.length} 节 · 当前第 {Math.min(index + 1, due.length)} 节
        </span>
        <span className="study-today-spacer" />
        <button type="button" className="study-link" onClick={() => onOpenUnit(current.materialId, current.unitId)}>
          打开阅读器
        </button>
      </div>

      <ReviewCard
        key={current.key}
        item={current}
        onRated={async () => {
          const next = await api<DueItem[]>('/due')
          setDue(next)
          setIndex(0)
          onChange()
        }}
        onError={reportError}
      />

      <div className="study-due-list">
        {due.map(item => (
          <button key={item.key} type="button" className="study-due-row" onClick={() => onOpenUnit(item.materialId, item.unitId)}>
            <span>{item.title}</span>
            <span className="study-item-meta">
              {item.materialTitle} · {item.due}
              {item.overdueDays > 0 ? ` · 逾期 ${item.overdueDays} 天` : ''}
            </span>
          </button>
        ))}
      </div>

      {toast !== null ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <div className="study-muted">薄弱概念可以在「大道至简 / 概念」里查看；练习在阅读器的「练习」标签。</div>
    </div>
  )
}

/** One review card: recall first, reveal notes, then rate. */
function ReviewCard({
  item,
  onRated,
  onError,
}: {
  item: DueItem
  onRated: () => Promise<void>
  onError: (message: string) => void
}): ReactElement {
  const [unit, setUnit] = useState<UnitView | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api<UnitView>(`/unit?mid=${encodeURIComponent(item.materialId)}&uid=${encodeURIComponent(item.unitId)}`)
      .then(value => {
        if (alive) setUnit(value)
      })
      .catch(reason => {
        if (alive) onError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [item.materialId, item.unitId, onError])

  const rate = async (rating: 1 | 2 | 3 | 4): Promise<void> => {
    setBusy(true)
    try {
      await post('/review', { mid: item.materialId, uid: item.unitId, rating })
      await onRated()
    } catch (reason) {
      onError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const excerpt = useMemo(() => {
    const notes = unit?.notes ?? ''
    const core = /##\s*核心概念([\s\S]*?)(?:\n##\s|$)/.exec(notes)?.[1]?.trim()
    const goal = /##\s*本节目标([\s\S]*?)(?:\n##\s|$)/.exec(notes)?.[1]?.trim()
    return (core ?? goal ?? notes).slice(0, 1200)
  }, [unit?.notes])

  return (
    <section className="study-review-card">
      <h3>{item.title}</h3>
      <div className="study-item-meta">
        {item.materialTitle} · 到期 {item.due}
        {item.overdueDays > 0 ? ` · 逾期 ${item.overdueDays} 天` : ''}
      </div>
      <p className="study-review-prompt">先合上笔记，用一句话复述这一节在讲什么，再揭示对照。</p>
      {revealed ? (
        <div className="study-review-notes">
          {unit === null ? (
            '正在载入对照…'
          ) : unit.notes === null ? (
            <span className="study-muted">这一节还没有精读稿，可以直接看原文页，或只按理解评级。</span>
          ) : (
            <p>{excerpt}</p>
          )}
        </div>
      ) : (
        <button type="button" className="study-primary study-primary-tight" onClick={() => setRevealed(true)}>
          揭示最小对照
        </button>
      )}
      <div className="study-review-ratings">
        {([1, 2, 3, 4] as const).map(rating => (
          <button
            key={rating}
            type="button"
            className={`study-rating study-rating-${rating}`}
            disabled={busy}
            onClick={() => void rate(rating)}
          >
            {rating === 1 ? '重来' : rating === 2 ? '困难' : rating === 3 ? '良好' : '简单'}
          </button>
        ))}
      </div>
      <p className="study-muted">评级会更新 FSRS 的稳定度与下一次到期日；不用追求全部简单。</p>
    </section>
  )
}

/** The goal wizard: pick materials, describe the target, generate inline. */
export function NewGoalDialog({
  onClose,
  onCreated,
  onOpenLibrary,
}: {
  onClose: () => void
  onCreated: (planId: string, jobId?: string) => void
  onOpenLibrary: () => void
}): ReactElement {
  const [cards, setCards] = useState<MaterialCard[] | null>(null)
  const [goal, setGoal] = useState('')
  const [brief, setBrief] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [depth, setDepth] = useState<'deep' | 'overview'>('deep')
  const [hours, setHours] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackPrompt, setFallbackPrompt] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<MaterialCard[]>('/library')
      .then(value => {
        if (alive) setCards(value)
      })
      .catch(() => {
        if (alive) setCards([])
      })
    return () => {
      alive = false
    }
  }, [])

  const toggle = (id: string): void => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async (): Promise<void> => {
    if (goal.trim().length === 0) {
      setError('先写一句学习目标')
      return
    }
    if (selected.size === 0) {
      setError('至少选一份资料')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const value = await post<{
        planId: string
        jobId?: string | null
        fallback?: boolean
        prompted?: boolean
        error?: string
        prompt?: string
      }>('/generate/plan', {
        goal: goal.trim(),
        brief: brief.trim(),
        materials: [...selected],
        depth,
        ...(hours.trim() === '' ? {} : { hoursPerWeek: Number(hours) }),
        ...(currentSessionId() === undefined ? {} : { sessionId: currentSessionId() }),
      })
      if (value.jobId !== undefined && value.jobId !== null) {
        onCreated(value.planId, value.jobId)
        onClose()
        return
      }
      if (value.prompted === true) {
        onCreated(value.planId)
        onClose()
        return
      }
      setFallbackPrompt(value.prompt ?? '已创建目标；没有可用的文本引擎，也没有可发送的会话。')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="新建学习目标"
      subtitle="选资料 + 说清目标；默认在页面内直接编排，只有未配置文本引擎时才回退到对话。"
      onClose={onClose}
      wide
    >
      <div className="study-field">
        <label className="study-field-label">目标</label>
        <input
          type="text"
          className="study-input"
          placeholder="例如：搞懂 Raft 的日志复制与选举"
          value={goal}
          disabled={busy}
          onChange={event => setGoal(event.target.value)}
        />
      </div>

      <div className="study-field">
        <label className="study-field-label">补充说明（可选）</label>
        <textarea
          className="study-input study-textarea"
          placeholder="背景、希望达到的程度、已有基础…"
          value={brief}
          disabled={busy}
          onChange={event => setBrief(event.target.value)}
        />
      </div>

      <div className="study-field">
        <label className="study-field-label">选择资料</label>
        {cards === null ? (
          <p className="study-muted">正在读取清单…</p>
        ) : cards.length === 0 ? (
          <div className="study-inline">
            <p className="study-muted">清单为空，先导入资料。</p>
            <button type="button" className="study-link" onClick={onOpenLibrary}>
              去清单
            </button>
          </div>
        ) : (
          <div className="study-pick-list">
            {cards.map(card => (
              <label key={card.id} className={`study-pick${selected.has(card.id) ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  className="study-check"
                  checked={selected.has(card.id)}
                  disabled={busy}
                  onChange={() => toggle(card.id)}
                />
                <span className="study-pick-body">
                  <span className="study-pick-title">{card.title}</span>
                  <span className="study-item-meta">
                    {typeLabel(card.type)} · {card.pages} 页 · {card.units} 单元 · 已学 {card.learnedUnits}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="study-row">
        <div className="study-field">
          <label className="study-field-label">深度</label>
          <select className="study-input" value={depth} disabled={busy} onChange={event => setDepth(event.target.value as 'deep' | 'overview')}>
            <option value="deep">精读：逐节重写</option>
            <option value="overview">速览：总览 + 关键节</option>
          </select>
        </div>
        <div className="study-field">
          <label className="study-field-label">每周时间（小时，可选）</label>
          <input
            type="number"
            min="0"
            className="study-input"
            placeholder="3"
            value={hours}
            disabled={busy}
            onChange={event => setHours(event.target.value)}
          />
        </div>
      </div>

      {error === null ? null : <p className="study-form-error">{error}</p>}

      {fallbackPrompt === null ? (
        <div className="study-modal-actions">
          <button type="button" className="study-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={() => void submit()}>
            {busy ? '提交中…' : '创建并开始编排'}
          </button>
        </div>
      ) : (
        <div className="study-fallback">
          <p className="study-modal-note">没有可用的文本引擎，也没有自动发进对话。复制下面这段，粘贴到聊天框即可开始：</p>
          <textarea className="study-input study-textarea study-textarea-tall" readOnly value={fallbackPrompt} />
          <div className="study-modal-actions">
            <button
              type="button"
              className="study-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(fallbackPrompt)
              }}
            >
              复制
            </button>
            <button
              type="button"
              className="study-primary study-primary-tight"
              onClick={() => {
                openConversation()
                onClose()
              }}
            >
              打开对话
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
