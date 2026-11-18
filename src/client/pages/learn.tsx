/**
 * 阅读: today, goals (paths) and review.
 *
 * This is the main surface: one goal becomes concrete steps, each step opens the
 * shared reader, and completing a unit puts it into the FSRS due queue.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  CardView,
  DueItem,
  MaterialCard,
  PlanSummary,
  TodayView,
  UnitView,
} from '../../core/views.ts'
import { api, errorText, post } from '../api.ts'
import { MASCOT } from '../mascot.ts'
import { currentSessionId, openConversation } from '../actions.ts'
import { typeLabel } from '../labels.ts'
import { EmptyState, Modal, ProgressBar, SubNav, Toast } from '../components/ui.tsx'

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
            { id: 'paths', label: '目标' },
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

  const dueKnowledge = data.knowledge?.due ?? []
  const dueCount = dueKnowledge.length + data.dueCards.length + data.due.length
  const nothing = dueCount === 0 && data.next === null && data.weak.length === 0 && data.plans.length === 0

  return (
    <div className="study-today">
      <div className="study-today-line">
        <img className="study-today-fish" src={MASCOT.cute} alt="" />
        <span className="study-today-date">{data.date}</span>
        <span className="study-today-hi">
          {data.next !== null
            ? '先从接着读开始？'
            : dueCount > 0
              ? '有几个知识点到期了，先过一遍？'
              : '今天没有非做不可的事。'}
        </span>
        <span className="study-today-spacer" />
        <span className="study-muted">
          {data.knowledge === undefined
            ? `已完成 ${data.learnedToday} 节`
            : `知识点 ${data.knowledge.total} 个 · 已结案 ${data.knowledge.settled}`}
        </span>
        <span className={dueCount > 0 ? 'study-warn-text' : 'study-muted'}>
          {dueCount > 0 ? `${dueKnowledge.length} 个知识点到期` : '没有到期复习'}
        </span>
      </div>

      {nothing ? (
        <EmptyState
          title="还没定目标呢。"
          hint="先挑一本书，再说清要交出什么、什么时候、给谁看——边界是从那句话推出来的，不是从目录。"
          action={{ label: '去书架挑一本', onClick: onOpenLibrary }}
        />
      ) : null}

      <div className="study-today-grid">
        <section className="study-panel study-panel-next">
          <h3>接着读</h3>
          {data.next === null ? (
            <p className="study-muted">这几本都学完了。剩下的事只有两件：复习，和结案。</p>
          ) : (
            <button
            type="button"
            className="study-next-card"
            onClick={() => onOpenUnit(data.next!.materialId, data.next!.unitId, data.next!.planId)}
          >
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
                    {plan.deliverable === undefined ? null : <span className="study-item-meta">要交出：{plan.deliverable}</span>}
                    <span className="study-item-meta">
                      {plan.done}/{plan.total} 个必读范围
                      {plan.next === undefined ? '' : ' · 下一步：' + plan.next.title}
                      {plan.gateReady ? ' · 可结案' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="study-panel">
          <h3>该复习了</h3>
          {dueCount === 0 ? (
            <p className="study-muted">今天没有到期的知识点。练习过的概念会按 FSRS 排下一次；到目标且下次复习落在目标期之后，就自动结案。</p>
          ) : (
            <ul className="study-list">
              {dueKnowledge.slice(0, 6).map(entry => (
                <li key={entry.conceptId}>
                  <button type="button" className="study-item" onClick={() => onOpenConcept(entry.conceptId)}>
                    <span className="study-item-title">{entry.name}</span>
                    <span className="study-item-meta">
                      掌握 {Math.round(entry.mastery * 100)}% / 目标 {Math.round(entry.target * 100)}%
                      {entry.overdueDays > 0 ? ` · 逾期 ${entry.overdueDays} 天` : ' · 今天到期'}
                    </span>
                  </button>
                </li>
              ))}
              {data.dueCards.slice(0, 4).map(card => (
                <li key={card.id}>
                  <button
                    type="button"
                    className="study-item"
                    onClick={() => {
                      if (card.planId !== undefined) onOpenPlan(card.planId)
                    }}
                  >
                    <span className="study-item-title">{card.prompt}</span>
                    <span className="study-item-meta">
                      卡片 · {card.goal ?? '来自目标'}
                      {card.overdueDays > 0 ? ` · 逾期 ${card.overdueDays} 天` : ''}
                    </span>
                  </button>
                </li>
              ))}
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
          <h3>练一下最弱的</h3>
          {data.weak.length === 0 ? (
            <p className="study-muted">还没攒够数据。学几节、做几道题，这里就会冒出该加固的概念。</p>
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
        title="还没有目标。"
        hint="用右上角「＋ 新建目标」：写清交付物、期限和受众，再选资料；边界会从交付物推出来。"
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
                      : '已结案'}
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
          去书架选资料
        </button>
      </div>
    </div>
  )
}

/** One plan with its steps and inline generation. */

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
  const [cards, setCards] = useState<CardView[] | null>(null)
  const [due, setDue] = useState<DueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const reportError = useCallback((message: string) => {
    setToast({ message, tone: 'error' })
  }, [])

  const reload = useCallback(async () => {
    const [cardList, dueList] = await Promise.all([api<CardView[]>('/cards'), api<DueItem[]>('/due')])
    setCards(cardList)
    setDue(dueList)
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
  if (cards === null || due === null) return <div className="study-empty">正在读取复习队列…</div>

  if (cards.length === 0 && due.length === 0) {
    return (
      <EmptyState
        title="今天没有到期的卡。"
        hint="卡只会从判错里长出来：答对就退役，结案就消失。所以这一栏空着是好事。旧账留在下面。"
      />
    )
  }

  const current = cards[Math.min(index, cards.length - 1)]

  return (
    <div className="study-review">
      {current === undefined ? null : (
        <>
          <div className="study-today-line">
            <span className="study-muted">
              待复习 {cards.length} 张卡片 · 当前第 {Math.min(index + 1, cards.length)} 张
            </span>
            <span className="study-today-spacer" />
            <span className="study-item-meta">{current.goal ?? '来自目标'}</span>
          </div>
          <CardReview
            key={current.id}
            card={current}
            onRated={async () => {
              setCards(await api<CardView[]>('/cards'))
              setIndex(0)
              onChange()
            }}
            onError={reportError}
          />
        </>
      )}

      {due.length === 0 ? null : (
        <>
          <h3 className="study-section-title">旧：按节复习 {due.length}</h3>
          <p className="study-muted">这些是阶段一之前按整节排的到期单元；新目标只用卡片复习。</p>
          <div className="study-due-list">
            {due.map(item => (
              <button key={item.key} type="button" className="study-due-row" onClick={() => onOpenUnit(item.materialId, item.unitId)}>
                <span>{item.title}</span>
                <span className="study-item-meta">
                  {item.materialTitle} · {item.due}
                  {item.overdueDays > 0 ? ' · 逾期 ' + item.overdueDays + ' 天' : ''}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {toast !== null ? <Toast message={toast.message} tone={toast.tone} /> : null}
      <div className="study-muted">薄弱概念在「笔记 / 概念」里查看；练习在阅读器的「练习」标签。</div>
    </div>
  )
}

/** One card: recall the answer, reveal the context, then rate. */
function CardReview({
  card,
  onRated,
  onError,
}: {
  card: CardView
  onRated: () => void
  onError: (message: string) => void
}): ReactElement {
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)

  const rate = async (rating: 1 | 2 | 3 | 4): Promise<void> => {
    setBusy(true)
    try {
      await post('/card/review', { cid: card.id, rating })
      setRevealed(false)
      onRated()
    } catch (reason) {
      onError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="study-review-card">
      <h3>{card.prompt}</h3>
      <div className="study-item-meta">
        {card.overdueDays > 0 ? '逾期 ' + card.overdueDays + ' 天 · ' : ''}
        已复习 {card.reps} 次
      </div>
      <p className="study-review-prompt">先合上笔记，把这道题完整答出来（能写就写），再揭示对照。</p>
      {revealed ? (
        <div className="study-review-notes">{card.detail ?? '这道题没有额外对照：答得出才算过。'}</div>
      ) : (
        <button type="button" className="study-primary study-primary-tight" onClick={() => setRevealed(true)}>
          揭示对照
        </button>
      )}
      <div className="study-review-ratings">
        {([1, 2, 3, 4] as const).map(rating => (
          <button
            key={rating}
            type="button"
            className={'study-rating study-rating-' + rating}
            disabled={busy}
            onClick={() => void rate(rating)}
          >
            {rating === 1 ? '重来' : rating === 2 ? '困难' : rating === 3 ? '良好' : '简单'}
          </button>
        ))}
      </div>
      <p className="study-muted">评级只影响这张卡的下次到期；结案的目标不会再来找你。</p>
    </section>
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
            <span className="study-muted">这一节还没有导读，可以直接看原文页，或只按理解评级。</span>
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
  const [deliverable, setDeliverable] = useState('')
  const [deadline, setDeadline] = useState('')
  const [audience, setAudience] = useState('')
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
      setError('先写一句目标')
      return
    }
    if (deliverable.trim().length === 0) {
      setError('先写清交付物：这次要交出什么？没有交付物，边界就没有依据')
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
      // The crop list and the closure gate are projected from these three
      // fields, so they are written before the panel opens.
      await post('/plan/update', {
        pid: value.planId,
        setMeta: {
          deliverable: deliverable.trim(),
          deadline: deadline.trim(),
          audience: audience.trim(),
        },
      }).catch(() => undefined)
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
      title="新建目标"
      subtitle="说清要交出什么、什么时候、给谁看，再选资料；边界会从交付物推出来。"
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

      <div className="study-row">
        <div className="study-field">
          <label className="study-field-label">交付物（必填）</label>
          <input
            type="text"
            className="study-input"
            placeholder="例如：能独立推导这篇论文第 3–5 节，并讲给同事 20 分钟"
            value={deliverable}
            disabled={busy}
            onChange={event => setDeliverable(event.target.value)}
          />
        </div>
        <div className="study-field">
          <label className="study-field-label">期限</label>
          <input type="date" className="study-input" value={deadline} disabled={busy} onChange={event => setDeadline(event.target.value)} />
        </div>
        <div className="study-field">
          <label className="study-field-label">受众</label>
          <input
            type="text"
            className="study-input"
            placeholder="组会 / 同事 / 自己"
            value={audience}
            disabled={busy}
            onChange={event => setAudience(event.target.value)}
          />
        </div>
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
            <option value="deep">导读：逐节重写</option>
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
