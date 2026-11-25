/**
 * 阅读: today, goals (paths) and review.
 *
 * This is the main surface: one goal becomes concrete steps, each step opens the
 * shared reader, and finishing a section puts its points into the decay review queue.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { MaterialCard, PlanSummary, TodayView } from '../../core/views.ts'
import { api, errorText, post } from '../api.ts'
import { MASCOT } from '../mascot.ts'
import { currentSessionId, openConversation } from '../actions.ts'
import { isDevMode } from '../dev.ts'
import { typeLabel } from '../labels.ts'
import { EmptyState, InlineMarkdown, Modal, ProgressBar, SubNav, Toast } from '../components/ui.tsx'
import { ClosedGoals } from '../components/closedGoals.tsx'

/** The learning-path dashboard. */
/** The reading entry: one today panel over the knowledge space. */
export function LearnPage({
  onOpenUnit,
  onOpenPlan,
  onOpenReview,
  onCreateGoal,
  onRefresh,
  refreshToken,
}: {
  onOpenUnit: (mid: string, uid: string, planId?: string) => void
  onOpenPlan: (pid: string) => void
  onOpenReview: (mid: string, uid: string, planId?: string) => void
  onCreateGoal: () => void
  onRefresh: () => void
  refreshToken: number
}): ReactElement {
  return (
    <div className="study-learn">
      <TodayPanel
        onOpenUnit={onOpenUnit}
        onOpenPlan={onOpenPlan}
        onOpenReview={onOpenReview}
        onCreateGoal={onCreateGoal}
        onRefresh={onRefresh}
        refreshToken={refreshToken}
      />
    </div>
  )
}

function TodayPanel({
  onOpenUnit,
  onOpenPlan,
  onOpenReview,
  onCreateGoal,
  onRefresh,
  refreshToken,
}: {
  onOpenUnit: (mid: string, uid: string, planId?: string) => void
  onOpenPlan: (pid: string) => void
  onOpenReview: (mid: string, uid: string, planId?: string) => void
  onCreateGoal: () => void
  onRefresh: () => void
  refreshToken: number
}): ReactElement {
  const [data, setData] = useState<TodayView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clockBusy, setClockBusy] = useState(false)
  const [clockError, setClockError] = useState<string | null>(null)
  const [goalBusy, setGoalBusy] = useState(false)
  const [goalError, setGoalError] = useState<string | null>(null)
  const [extending, setExtending] = useState(false)
  const [deadlineDraft, setDeadlineDraft] = useState('')

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

  // Test aid: move the desk's "today" forward without touching stored dates.
  const shiftClock = async (reset: boolean): Promise<void> => {
    if (clockBusy) return
    setClockBusy(true)
    setClockError(null)
    try {
      await post('/clock', reset ? { reset: true } : {})
      onRefresh()
    } catch (reason) {
      setClockError(errorText(reason))
    } finally {
      setClockBusy(false)
    }
  }

  // The deadline has passed: push it out or close the goal, right here.
  const extendGoal = async (): Promise<void> => {
    if (data?.goal === undefined || goalBusy) return
    const value = deadlineDraft.trim()
    if (value === '') {
      setGoalError('先选一个期限')
      return
    }
    setGoalBusy(true)
    setGoalError(null)
    try {
      await post('/plan/update', { pid: data.goal.id, setMeta: { deadline: value } })
      setExtending(false)
      onRefresh()
    } catch (reason) {
      setGoalError(errorText(reason))
    } finally {
      setGoalBusy(false)
    }
  }

  const closeGoal = async (): Promise<void> => {
    if (data?.goal === undefined || goalBusy) return
    setGoalBusy(true)
    setGoalError(null)
    try {
      await post('/plan/close', { pid: data.goal.id })
      onRefresh()
    } catch (reason) {
      setGoalError(errorText(reason))
    } finally {
      setGoalBusy(false)
    }
  }

  if (error !== null) return <div className="study-empty">无法读取今日面板：{error}</div>
  if (data === null) return <div className="study-empty">正在整理今天的任务…</div>

  const dueKnowledge = data.knowledge?.due ?? []
  const dueCount = dueKnowledge.length
  const nothing = dueCount === 0 && data.next === null && data.plans.length === 0 && data.goal === undefined
  // Group by section: the review column points at a section, not at one point.
  const reviewGroups = new Map<
    string,
    {
      key: string
      materialId: string
      unitId: string
      unitTitle?: string
      materialTitle?: string
      count: number
      weakest: number
      target: number
      overdue: number
    }
  >()
  for (const entry of dueKnowledge) {
    if (entry.materialId === undefined || entry.unitId === undefined) continue
    const key = `${entry.materialId}:${entry.unitId}`
    const existing = reviewGroups.get(key)
    if (existing === undefined) {
      reviewGroups.set(key, {
        key,
        materialId: entry.materialId,
        unitId: entry.unitId,
        ...(entry.unitTitle === undefined ? {} : { unitTitle: entry.unitTitle }),
        ...(entry.materialTitle === undefined ? {} : { materialTitle: entry.materialTitle }),
        count: 1,
        weakest: entry.mastery,
        target: entry.target,
        overdue: entry.overdueDays,
      })
      continue
    }
    existing.count += 1
    existing.overdue = Math.max(existing.overdue, entry.overdueDays)
    if (entry.mastery < existing.weakest) {
      existing.weakest = entry.mastery
      existing.target = entry.target
    }
  }
  const reviewSections = [...reviewGroups.values()].sort(
    (left, right) => right.overdue - left.overdue || left.weakest - right.weakest,
  )
  const looseDue = dueKnowledge.filter(entry => entry.materialId === undefined || entry.unitId === undefined)

  return (
    <div className="study-today">
      <div className="study-today-line">
        <img className="study-today-fish" src={MASCOT.cute} alt="" />
        <span className="study-today-date">{data.date}</span>
        {isDevMode() ? (
        <span className="study-clock">
          {data.clockOffsetDays > 0 ? (
            <span className="study-warn-text">测试时钟 +{data.clockOffsetDays} 天</span>
          ) : null}
          <button
            type="button"
            className="study-ghost study-ghost-tight"
            disabled={clockBusy}
            onClick={() => void shiftClock(false)}
          >
            {clockBusy ? '…' : '推进一天'}
          </button>
          {data.clockOffsetDays > 0 ? (
            <button
              type="button"
              className="study-ghost study-ghost-tight"
              disabled={clockBusy}
              onClick={() => void shiftClock(true)}
            >
              回到今天
            </button>
          ) : null}
          {clockError !== null ? <span className="study-warn-text">{clockError}</span> : null}
        </span>
        ) : null}
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
            : `知识点 ${data.knowledge.total} 个 · 已稳 ${data.knowledge.settled}`}
        </span>
        <span className={dueCount > 0 ? 'study-warn-text' : 'study-muted'}>
          {dueCount > 0 ? `${dueKnowledge.length} 个知识点到期` : '没有到期复习'}
        </span>
      </div>

      {nothing ? (
        <EmptyState
          title="还没定目标呢。"
          hint="先写清要交出什么、什么时候、给谁看；书只是完成它的材料，边界由目标推出来。"
          action={{ label: '新建一个目标', onClick: onCreateGoal }}
        />
      ) : null}

      <div className="study-today-grid">
        <section className="study-panel study-panel-goal">
          <h3>当前目标</h3>
          {data.goal === undefined ? (
            <p className="study-muted">还没有目标。练习只在目标里跑并写进度。先点右上角「＋ 新建目标」。</p>
          ) : (
            <>
              <button type="button" className="study-next-card" onClick={() => onOpenPlan(data.goal!.id)}>
                <span className="study-next-title">{data.goal.goal}</span>
                <span className="study-item-meta">
                  {data.goal.deliverable === undefined ? '' : `要交出：${data.goal.deliverable}`}
                  {data.goal.deadline === undefined ? '' : ` · 期限 ${data.goal.deadline}`}
                  {data.goal.deadline === undefined || data.date < data.goal.deadline ? '' : data.goal.overdueDays > 0 ? ` · 已过 ${data.goal.overdueDays} 天` : ' · 今天到期'}
                </span>
                <span className="study-next-why">
                  知识点 {data.goal.passed}/{data.goal.total}
                  {data.goal.missingSections > 0 ? ` · 还有 ${data.goal.missingSections} 节没有知识点` : ''}
                  {data.goal.readyToClose ? ' · 可以结案了' : ' · 未达成'}
                </span>
              </button>
              {data.goal.deadline !== undefined && data.date >= data.goal.deadline ? (
                <div className="study-inline study-goal-actions">
                  {extending ? (
                    <>
                      <input
                        type="date"
                        className="study-input"
                        value={deadlineDraft}
                        disabled={goalBusy}
                        onChange={event => setDeadlineDraft(event.target.value)}
                      />
                      <button type="button" className="study-ghost study-ghost-tight" disabled={goalBusy} onClick={() => void extendGoal()}>
                        {goalBusy ? '保存中…' : '保存期限'}
                      </button>
                      <button type="button" className="study-ghost study-ghost-tight" disabled={goalBusy} onClick={() => setExtending(false)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="study-ghost study-ghost-tight"
                        disabled={goalBusy}
                        onClick={() => {
                          setGoalError(null)
                          setDeadlineDraft(data.goal!.deadline ?? '')
                          setExtending(true)
                        }}
                      >
                        延期
                      </button>
                      <button
                        type="button"
                        className="study-primary study-primary-tight"
                        disabled={goalBusy || !data.goal.readyToClose}
                        title={data.goal.readyToClose ? '结案后不再出现在「今天」' : '还有知识点没到档，或到期没排到期限之外'}
                        onClick={() => void closeGoal()}
                      >
                        {goalBusy ? '处理中…' : '结案'}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
              {goalError === null ? null : <p className="study-warn-text study-goal-error">{goalError}</p>}
            </>
          )}
        </section>

        <section className="study-panel study-panel-next">
          <h3>接着读</h3>
          {data.next === null ? (
            <p className="study-muted">
              {data.goal === undefined
                ? '还没有目标。先定一个目标，才知道接下来读哪一节。'
                : data.goal.readyToClose
                  ? '目前的目标都已完成啦，静候复习吧~'
                  : '这个目标的节都读完了。剩下的事只有复习和结案。'}
            </p>
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
              <span className="study-next-why">
                <InlineMarkdown source={data.next.why} />
              </span>
            </button>
          )}
        </section>

        <section className="study-panel">
          <h3>该复习了</h3>
          {dueCount === 0 ? (
            <p className="study-muted">
              {data.goal === undefined
                ? '还没有目标。目标内的知识点跌破档位后才会出现在这里。'
                : '今天没有掉档的知识点。跌破档位的点会按节出现在这里。'}
            </p>
          ) : (
            <ul className="study-list">
              {reviewSections.map(group => (
                <li key={group.key}>
                  <button
                    type="button"
                    className="study-item"
                    onClick={() => onOpenReview(group.materialId, group.unitId, data.goal?.id)}
                  >
                    <span className="study-item-title">{group.unitTitle ?? group.key}</span>
                    <span className="study-item-meta">
                      {group.materialTitle === undefined ? '' : `${group.materialTitle} · `}
                      {group.count} 个知识点掉档 · 最低 {Math.floor(group.weakest * 100)}% /{' '}
                      {Math.round(group.target * 100)}%
                      {group.overdue > 0 ? ` · 逾期 ${group.overdue} 天` : ' · 今天到期'}
                    </span>
                  </button>
                </li>
              ))}
              {looseDue.slice(0, 2).map(entry => (
                <li key={entry.conceptId}>
                  <div className="study-item">
                    <span className="study-item-title">{entry.name}</span>
                    <span className="study-item-meta">
                      掌握 {Math.floor(entry.mastery * 100)}% / 目标 {Math.round(entry.target * 100)}%
                      {entry.overdueDays > 0 ? ` · 逾期 ${entry.overdueDays} 天` : ' · 今天到期'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ClosedGoals onOpenPlan={onOpenPlan} refreshToken={refreshToken} />
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
    if (deadline.trim().length === 0) {
      setError('期限必填：它决定什么时候算完成')
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
        deliverable: deliverable.trim(),
        deadline: deadline.trim(),
        audience: audience.trim(),
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
      title="新建目标"
      subtitle="知止而后有定：读哪些节、读到什么程度，现在定下来；不用读完整本。"
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
          <label className="study-field-label">期限（必填）</label>
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
