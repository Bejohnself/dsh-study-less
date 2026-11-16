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
  JobView,
  MaterialCard,
  PlanDetailView,
  BookSummary,
  PlanSummary,
  TodayView,
  UnitView,
} from '../../core/views.ts'
import { api, errorText, post, waitForJob } from '../api.ts'
import { MASCOT } from '../mascot.ts'
import { currentSessionId, openConversation } from '../actions.ts'
import { coverageLabel, moveLabel, provenanceLabel, stepKindLabel, typeLabel } from '../labels.ts'
import type { AttemptMove, Provenance } from '../../core/types.ts'
import { EmptyState, JobBanner, Modal, ProgressBar, SubNav, Toast } from '../components/ui.tsx'

export type LearnTab = 'today' | 'paths' | 'review'

/** Goals whose questions were already auto-requested this session. */
const askedKey = new Set<string>()

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

  const nothing = data.due.length === 0 && data.next === null && data.weak.length === 0 && data.plans.length === 0

  return (
    <div className="study-today">
      <div className="study-today-line">
        <img className="study-today-fish" src={MASCOT.cute} alt="" />
        <span className="study-today-date">{data.date}</span>
        <span className="study-today-hi">
          {data.next !== null
            ? '先从接着读开始？'
            : data.dueCards.length + data.due.length > 0
              ? '有几张卡到期了，先过一遍？'
              : '今天没有非做不可的事。'}
        </span>
        <span className="study-today-spacer" />
        <span className="study-muted">已完成 {data.learnedToday} 节</span>
        <span className={data.dueCards.length + data.due.length > 0 ? 'study-warn-text' : 'study-muted'}>
          {data.dueCards.length + data.due.length > 0
            ? data.dueCards.length + ' 张卡片 · ' + data.due.length + ' 节旧复习'
            : '没有到期复习'}
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
          {data.dueCards.length === 0 && data.due.length === 0 ? (
            <p className="study-muted">今天没有到期的卡。卡只从判错里长出来，答对就退役，结案后彻底消失——所以它不会越堆越多。</p>
          ) : (
            <ul className="study-list">
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
export function PlanDetailPage({
  pid,
  onBack,
  onOpenUnit,
  onOpenConcept,
  onOpenInsight,
  onOpenBook,
  refreshToken,
  onChanged,
}: {
  pid: string
  onBack: () => void
  onOpenUnit: (mid: string, uid: string, planId?: string) => void
  onOpenConcept: (cid: string) => void
  onOpenInsight: (iid: string) => void
  onOpenBook: (bid: string, planId?: string) => void
  refreshToken: number
  onChanged: () => void
}): ReactElement {
  const [data, setData] = useState<PlanDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [chatPrompt, setChatPrompt] = useState<string | null>(null)
  const [chatBusy, setChatBusy] = useState(false)
  const [inlineBusy, setInlineBusy] = useState(false)
  const [book, setBook] = useState<BookSummary | null>(null)
  const [metaDraft, setMetaDraft] = useState({ deliverable: '', deadline: '', audience: '' })
  const [metaSaving, setMetaSaving] = useState(false)
  const [attemptOpen, setAttemptOpen] = useState(false)
  const [attemptSaving, setAttemptSaving] = useState(false)
  const [attempt, setAttempt] = useState<{
    move: AttemptMove
    what: string
    stuck: string
    provenance: Provenance
    result: string
  }>({ move: 'assumption', what: '', stuck: '', provenance: 'adopted-unverified', result: '' })
  const [question, setQuestion] = useState('')
  const [closingNote, setClosingNote] = useState('')
  const [draft, setDraft] = useState<{ qid: string; answer: string; ref: string } | null>(null)
  const [judging, setJudging] = useState<string | null>(null)
  const [noEngine, setNoEngine] = useState(false)
  const [writingQuestions, setWritingQuestions] = useState(false)

  const reload = useCallback(async () => {
    const raw = await api<PlanDetailView>(`/plan?pid=${encodeURIComponent(pid)}`)
    // The panel and the Host reload independently. Until the Host is reloaded it
    // answers with the pre-stage-1 shape, so fill the new fields instead of
    // crashing the page.
    const plan: PlanDetailView = {
      ...raw,
      plan: { ...raw.plan, meta: raw.plan.meta ?? { threshold: 0.8 } },
      boundary: raw.boundary ?? {
        read: 0,
        skim: 0,
        skip: 0,
        readPages: 0,
        skimPages: 0,
        skipPages: 0,
        minPages: 0,
        totalPages: 0,
      },
      attempts: raw.attempts ?? [],
      cards: raw.cards ?? [],
      stuck: raw.stuck ?? [],
      sufficiency: raw.sufficiency ?? [],
      gate: raw.gate ?? {
        independent: 0,
        independentNeeded: 3,
        judged: 0,
        unverified: 0,
        passed: 0,
        asked: 0,
        aiJudged: 0,
        selfJudged: 0,
        threshold: 0.8,
        ready: false,
        reasons: ['Host 还是旧版本：重载插件后再刷新页面'],
      },
    }
    const books = await api<BookSummary[]>(`/books?pid=${encodeURIComponent(pid)}`).catch(() => [])
    setData(plan)
    setBook(books[0] ?? null)
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

  const meta = data?.plan.meta
  useEffect(() => {
    setMetaDraft({
      deliverable: meta?.deliverable ?? '',
      deadline: meta?.deadline ?? '',
      audience: meta?.audience ?? '',
    })
  }, [meta?.deliverable, meta?.deadline, meta?.audience])

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

  const retryInline = async (): Promise<void> => {
    setInlineBusy(true)
    setJob(null)
    try {
      const { jobId } = await post<{ jobId: string }>('/generate/plan/retry', { pid })
      const finished = await waitForJob(jobId, setJob)
      if (finished.status === 'done') {
        await reload()
        onChanged()
        setToast({ message: '路径编排完成', tone: 'ok' })
      } else if (finished.status === 'failed') {
        setToast({ message: finished.error ?? '编排失败', tone: 'error' })
        await reload()
      }
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setInlineBusy(false)
      setJob(null)
    }
  }

  const retryChat = async (): Promise<void> => {
    setChatBusy(true)
    try {
      const value = await post<{ prompted: boolean; prompt: string; error?: string }>('/plan/retry-chat', {
        pid,
        ...(currentSessionId() === undefined ? {} : { sessionId: currentSessionId() }),
      })
      if (value.prompted) {
        setToast({ message: '已交给当前对话，步骤写入后路径会自动更新', tone: 'ok' })
        await reload()
        openConversation()
      } else {
        setChatPrompt(value.prompt)
        setToast({ message: value.error ?? '没有可用的会话；复制下面的 prompt 到聊天框', tone: 'error' })
      }
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setChatBusy(false)
    }
  }

  const compileBook = async (): Promise<void> => {
    setInlineBusy(true)
    setJob(null)
    try {
      const { jobId } = await post<{ jobId: string }>('/generate/book/outline', { pid })
      const finished = await waitForJob(jobId, setJob)
      if (finished.status === 'done') {
        await reload()
        onChanged()
        setToast({ message: '自编书大纲已生成', tone: 'ok' })
      } else if (finished.status === 'failed') {
        setToast({ message: finished.error ?? '大纲生成失败', tone: 'error' })
      }
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setInlineBusy(false)
      setJob(null)
    }
  }

  const removePlan = async (): Promise<void> => {
    if (!window.confirm('删除这个目标？资料内容与复习进度不会被删除。')) return
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
        setToast({ message: '这一节的导读与练习已生成', tone: 'ok' })
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

  /** Reload after a panel action, surfacing failures as a toast. */
  const act = async (message: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run()
      await reload()
      onChanged()
      if (message.length > 0) setToast({ message, tone: 'ok' })
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  const saveMeta = async (): Promise<void> => {
    setMetaSaving(true)
    try {
      await act('目标信息已保存', () =>
        post('/plan/update', {
          pid,
          setMeta: {
            deliverable: metaDraft.deliverable.trim(),
            deadline: metaDraft.deadline.trim(),
            audience: metaDraft.audience.trim(),
          },
        }),
      )
    } finally {
      setMetaSaving(false)
    }
  }

  const crop = async (n: number, coverage: 'read' | 'skim' | 'skip'): Promise<void> => {
    let reason: string | undefined
    if (coverage === 'skip') {
      const value = window.prompt('为什么这段对目标不需要？（必填，会作为「不读」的理由留在裁剪单上）')
      if (value === null) return
      if (value.trim().length === 0) {
        setToast({ message: '不读必须写理由，否则它又会变成一笔欠账', tone: 'error' })
        return
      }
      reason = value.trim()
    }
    setBusy(n)
    try {
      await act('', () => post('/plan/update', { pid, setCoverage: { n, coverage, ...(reason === undefined ? {} : { reason }) } }))
    } finally {
      setBusy(null)
    }
  }

  const saveAttempt = async (): Promise<void> => {
    if (attempt.what.trim().length === 0) return
    setAttemptSaving(true)
    try {
      await act('已记下这次尝试', () =>
        post('/plan/update', {
          pid,
          addAttempt: {
            move: attempt.move,
            what: attempt.what.trim(),
            provenance: attempt.provenance,
            ...(attempt.stuck.trim().length === 0 ? {} : { stuck: attempt.stuck.trim() }),
            ...(attempt.result.trim().length === 0 ? {} : { result: attempt.result.trim() }),
          },
        }),
      )
      setAttempt({ move: 'assumption', what: '', stuck: '', provenance: 'adopted-unverified', result: '' })
      setAttemptOpen(false)
    } finally {
      setAttemptSaving(false)
    }
  }

  const removeAttempt = async (id: string): Promise<void> => {
    await act('', () => post('/plan/update', { pid, removeAttempt: id }))
  }

  const answerQuestion = async (id: string, passed: boolean, reason?: string, answer?: string): Promise<void> => {
    await act(passed ? '已自评通过' : '已记为没过：明天会生成一张卡回来问你', () =>
      post('/plan/update', {
        pid,
        toggleSufficiency: {
          id,
          passed,
          ...(reason === undefined ? {} : { reason }),
          ...(answer === undefined ? {} : { answer }),
        },
      }),
    )
  }

  /** Ask the model to write the questions; the user only answers them. */
  const writeQuestions = async (): Promise<void> => {
    setWritingQuestions(true)
    try {
      const value = await post<{ generated: boolean; reason?: string; plan: PlanDetailView }>('/plan/questions', { pid })
      setData(value.plan)
      onChanged()
      if (!value.generated) {
        setNoEngine(true)
        setToast({ message: '没有可用的文本引擎：只能自己加题', tone: 'error' })
      } else {
        setNoEngine(false)
        setToast({ message: '判定题已生成：接下来只要作答', tone: 'ok' })
      }
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setWritingQuestions(false)
    }
  }

  /** Ask the judge about the answer in the draft; no engine falls back to self-eval. */
  const judgeAnswer = async (id: string): Promise<void> => {
    if (draft === null || draft.answer.trim().length === 0) return
    setJudging(id)
    try {
      const value = await post<{ judged: boolean; reason?: string; plan: PlanDetailView; verdict?: string }>('/plan/judge', {
        pid,
        qid: id,
        answer: draft.answer.trim(),
        ...(draft.ref.length === 0 ? {} : { ref: draft.ref }),
      })
      setData(value.plan)
      onChanged()
      if (!value.judged) {
        setNoEngine(true)
        setToast({ message: '没有可用的文本引擎：这次只能自评', tone: 'error' })
      } else {
        setNoEngine(false)
        setDraft(null)
        setToast({
          message: value.verdict === 'pass' ? '判定：通过' : value.verdict === 'partial' ? '判定：还差一点（明天会以卡片回来）' : '判定：没通过（明天会以卡片回来）',
          tone: value.verdict === 'pass' ? 'ok' : 'error',
        })
      }
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setJudging(null)
    }
  }

  /** Overrule a negative verdict; the reason is mandatory and always shown. */
  const selfPass = async (id: string, answer: string, verdictExists: boolean): Promise<void> => {
    if (answer.trim().length === 0) {
      setToast({ message: '先把答案写下来：没有答案的「通过」不算数', tone: 'error' })
      return
    }
    const reason = verdictExists ? window.prompt('为什么你认为已经达到标准？（会记在结案记录里）') : undefined
    if (verdictExists && (reason === null || reason.trim().length === 0)) return
    await answerQuestion(id, true, reason === undefined ? undefined : reason.trim(), answer.trim())
    setDraft(null)
  }

  const addQuestion = async (): Promise<void> => {
    const value = question.trim()
    if (value.length === 0) return
    const list = [...(data?.sufficiency ?? []).map(item => ({ q: item.q, passed: item.passed })), { q: value }]
    await act('', () => post('/plan/update', { pid, replaceSufficiency: list }))
    setQuestion('')
  }

  const removeQuestion = async (id: string): Promise<void> => {
    const list = (data?.sufficiency ?? []).filter(item => item.id !== id).map(item => ({ q: item.q, passed: item.passed }))
    await act('', () => post('/plan/update', { pid, replaceSufficiency: list }))
  }

  const closeGoal = async (): Promise<void> => {
    const note = closingNote.trim()
    await act('已结案：不再出现在「今天」里', () => post('/plan/close', { pid, ...(note.length === 0 ? {} : { note }) }))
    setClosingNote('')
  }

  const reopen = async (): Promise<void> => {
    await act('目标已重新打开', () => post('/plan/update', { pid, setStatus: 'active' }))
  }

  // The first time a generated plan has no questions, ask the model once.
  useEffect(() => {
    if (data === null || writingQuestions || noEngine) return
    if (data.plan.status === 'draft' || data.plan.status === 'done') return
    if (data.sufficiency.length > 0) return
    if (askedKey.has(pid)) return
    askedKey.add(pid)
    void writeQuestions()
  }, [data, noEngine, pid, writingQuestions])

  if (error !== null) return <div className="study-empty">无法读取路径：{error}</div>
  if (data === null) return <div className="study-empty">正在载入路径…</div>

  const locked = data.plan.status === 'done'
  const isUnitStep = (kind: string): boolean => kind === 'unit' || kind === 'paper-pass'
  const unitSteps = data.steps.filter(step => isUnitStep(step.kind))
  const otherSteps = data.steps.filter(step => !isUnitStep(step.kind))
  const boundaryGroups: Array<{ id: 'read' | 'skim' | 'skip'; title: string; hint: string }> = [
    { id: 'read', title: '必读', hint: '最小集：分母只算这些' },
    { id: 'skim', title: '略读', hint: '知道结论即可，不要求推导' },
    { id: 'skip', title: '不读', hint: '已知不需要，不进「未完成」' },
  ]
  const ATTEMPT_MOVES: AttemptMove[] = ['assumption', 'constraint', 'counterexample', 'ablation', 'transfer']

  return (
    <div className="study-plan-detail">
      <div className="study-material-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 目标
        </button>
        <div className="study-reader-title">
          <h2>{data.plan.goal}</h2>
          <span className="study-reader-sub">
            {data.done}/{data.total} 步
            {data.plan.hoursPerWeek === undefined ? '' : ` · 每周约 ${data.plan.hoursPerWeek} 小时`}
          </span>
        </div>
        <button type="button" className="study-ghost study-danger-text" onClick={() => void removePlan()}>
          删除目标
        </button>
      </div>

      {data.plan.status === 'draft' ? (
        <div className="study-banner">
          <span>
            {generation?.status === 'failed'
              ? `编排失败：${generation.error ?? '未知原因'}`
              : generation?.mode === 'chat'
                ? '已交给当前对话编排；步骤写入后会自动变为「进行中」。'
                : generation?.jobId === undefined
                  ? '已创建目标；当前没有可用的页面内引擎，可以交给对话或手动编排。'
                  : '这条路径正在页面内编排；步骤写入后会自动变为「进行中」。'}
          </span>
          {generation?.jobId === undefined ? null : <JobBanner job={job ?? { ...emptyJob(generation.jobId), status: generation.status as JobView['status'] }} />}
          <button type="button" className="study-ghost" disabled={inlineBusy || chatBusy} onClick={() => void retryInline()}>
            {inlineBusy ? '重试中…' : '重试编排'}
          </button>
          <button type="button" className="study-link" disabled={chatBusy || inlineBusy} onClick={() => void retryChat()}>
            {chatBusy ? '发送中…' : '交给当前对话'}
          </button>
        </div>
      ) : null}

      {chatPrompt === null ? null : (
        <div className="study-fallback">
          <p className="study-modal-note">没能自动发进对话。复制下面的 prompt 到聊天框即可继续：</p>
          <textarea className="study-input study-textarea study-textarea-tall" readOnly value={chatPrompt} />
          <div className="study-modal-actions">
            <button
              type="button"
              className="study-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(chatPrompt)
              }}
            >
              复制
            </button>
          </div>
        </div>
      )}

      {job !== null && data.plan.status !== 'draft' ? <JobBanner job={job} /> : null}
      {data.plan.brief === undefined ? null : <p className="study-definition">{data.plan.brief}</p>}

      <section className="study-goal-card">
        <div className="study-panel-head">
          <h3>目标</h3>
          <span className="study-muted">
            {data.plan.meta.deadline === undefined ? '未设期限' : '期限 ' + data.plan.meta.deadline}
            {data.plan.meta.audience === undefined ? '' : ' · 受众 ' + data.plan.meta.audience}
          </span>
        </div>
        <div className="study-row">
          <div className="study-field">
            <label className="study-field-label">交付物（边界由它推出）</label>
            <input
              type="text"
              className="study-input"
              placeholder="例如：能独立推导这篇论文第 3–5 节，并讲给同事 20 分钟"
              value={metaDraft.deliverable}
              disabled={locked || metaSaving}
              onChange={event => setMetaDraft({ ...metaDraft, deliverable: event.target.value })}
            />
          </div>
          <div className="study-field">
            <label className="study-field-label">期限</label>
            <input
              type="date"
              className="study-input"
              value={metaDraft.deadline}
              disabled={locked || metaSaving}
              onChange={event => setMetaDraft({ ...metaDraft, deadline: event.target.value })}
            />
          </div>
          <div className="study-field">
            <label className="study-field-label">受众</label>
            <input
              type="text"
              className="study-input"
              placeholder="组会 / 同事 / 自己"
              value={metaDraft.audience}
              disabled={locked || metaSaving}
              onChange={event => setMetaDraft({ ...metaDraft, audience: event.target.value })}
            />
          </div>
        </div>
        <div className="study-inline">
          <button type="button" className="study-primary study-primary-tight" disabled={locked || metaSaving} onClick={() => void saveMeta()}>
            {metaSaving ? '保存中…' : '保存目标信息'}
          </button>
          <span className="study-muted">没有交付物的目标不能结案。</span>
        </div>
      </section>

      <section className="study-boundary">
        <div className="study-panel-head">
          <h3>裁剪单</h3>
          <span className="study-muted">
            最小集 {data.boundary.minPages} 页 / 全书 {data.boundary.totalPages} 页 · 必读 {data.boundary.read} · 略读 {data.boundary.skim} · 不读 {data.boundary.skip}
          </span>
        </div>
        {unitSteps.length === 0 ? (
          <p className="study-muted">这个目标还没有范围：重新编排一次，或手动补上要读的节。</p>
        ) : null}
        {boundaryGroups.map(group => {
          const rows = unitSteps.filter(step => step.coverage === group.id)
          return (
            <div key={group.id} className="study-boundary-group">
              <div className="study-boundary-group-head">
                <span className={'study-coverage-pill is-' + group.id}>{group.title}</span>
                <span className="study-muted">{group.hint}</span>
              </div>
              {rows.length === 0 ? (
                <p className="study-muted">没有这一类的范围。</p>
              ) : (
                rows.map(step => (
                  <div key={step.n} className={'study-boundary-row is-' + group.id}>
                    {step.coverage === 'skip' ? (
                      <span className="study-skip-mark">跳过</span>
                    ) : (
                      <input
                        type="checkbox"
                        className="study-check"
                        checked={step.done}
                        disabled={busy === step.n || locked}
                        aria-label={'标记第 ' + step.n + ' 步完成'}
                        onChange={event => void toggle(step.n, event.target.checked)}
                      />
                    )}
                    <div className="study-step-body">
                      <div className="study-step-title">
                        {step.target === undefined ? (
                          <span>{step.why}</span>
                        ) : (
                          <button type="button" className="study-link" onClick={() => onOpenUnit(step.target!.materialId, step.target!.unitId, pid)}>
                            {step.target.title}
                          </button>
                        )}
                        {step.target === undefined ? null : (
                          <span className="study-item-meta">
                            {step.target.materialTitle} · p{step.target.pageStart}–{step.target.pageEnd}
                          </span>
                        )}
                      </div>
                      <div className="study-item-meta">{step.why}</div>
                      {step.skipReason === undefined ? null : <div className="study-skip-reason">不读理由：{step.skipReason}</div>}
                    </div>
                    <div className="study-coverage" role="group" aria-label={'第 ' + step.n + ' 步的边界'}>
                      {(['read', 'skim', 'skip'] as const).map(value => (
                        <button
                          key={value}
                          type="button"
                          className={'study-coverage-btn' + (step.coverage === value ? ' is-on' : '')}
                          disabled={locked || busy !== null}
                          onClick={() => void crop(step.n, value)}
                        >
                          {coverageLabel(value)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )
        })}
      </section>

      <section className="study-attempts">
        <div className="study-panel-head">
          <h3>尝试与卡点</h3>
          <span className="study-muted">
            独立 {data.gate.independent}/{data.gate.independentNeeded} · 判断后改 {data.gate.judged} · 未验证 {data.gate.unverified}
          </span>
        </div>
        {data.stuck.length === 0 ? (
          <p className="study-muted">还没有卡点。每次尝试写一句「卡在哪」，重复出现的会排到前面——那是缺口，不是失败。</p>
        ) : (
          <div className="study-stuck">
            <span className="study-field-label">反复卡住的地方</span>
            <div className="study-chips">
              {data.stuck.map(point => (
                <span key={point.text} className="study-chip">
                  ×{point.count} {point.text}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="study-inline">
          <button type="button" className="study-ghost" disabled={locked} onClick={() => setAttemptOpen(open => !open)}>
            {attemptOpen ? '收起' : '记一次尝试'}
          </button>
          <span className="study-muted">先自己写，再看 AI：一次 1–2 小时，只动一小步。</span>
        </div>
        {attemptOpen ? (
          <div className="study-attempt-form">
            <div className="study-row">
              <div className="study-field">
                <label className="study-field-label">动作</label>
                <select className="study-input" value={attempt.move} onChange={event => setAttempt({ ...attempt, move: event.target.value as AttemptMove })}>
                  {ATTEMPT_MOVES.map(move => (
                    <option key={move} value={move}>
                      {moveLabel(move)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="study-field">
                <label className="study-field-label">归因</label>
                <select className="study-input" value={attempt.provenance} onChange={event => setAttempt({ ...attempt, provenance: event.target.value as Provenance })}>
                  <option value="independent">我独立想到的</option>
                  <option value="judged">我判断后改的</option>
                  <option value="adopted-unverified">AI 给的，未验证</option>
                </select>
              </div>
            </div>
            <div className="study-field">
              <label className="study-field-label">做了什么</label>
              <textarea
                className="study-input study-textarea"
                placeholder="例如：把静态信道假设改成时变，重写第 3 节那一步"
                value={attempt.what}
                onChange={event => setAttempt({ ...attempt, what: event.target.value })}
              />
            </div>
            <div className="study-row">
              <div className="study-field">
                <label className="study-field-label">卡在哪（可选，会变成卡点）</label>
                <input
                  type="text"
                  className="study-input"
                  placeholder="例如：约束写不进奖励函数"
                  value={attempt.stuck}
                  onChange={event => setAttempt({ ...attempt, stuck: event.target.value })}
                />
              </div>
              <div className="study-field">
                <label className="study-field-label">结果（可选）</label>
                <input
                  type="text"
                  className="study-input"
                  placeholder="例如：那一步推完了，收敛性说不清"
                  value={attempt.result}
                  onChange={event => setAttempt({ ...attempt, result: event.target.value })}
                />
              </div>
            </div>
            <div className="study-modal-actions">
              <button type="button" className="study-primary study-primary-tight" disabled={attemptSaving} onClick={() => void saveAttempt()}>
                {attemptSaving ? '保存中…' : '记下这次尝试'}
              </button>
            </div>
          </div>
        ) : null}
        {data.attempts.length === 0 ? null : (
          <ul className="study-attempt-list">
            {data.attempts.map(item => (
              <li key={item.id} className="study-attempt">
                <div className="study-attempt-head">
                  <span className={'study-prov is-' + item.provenance}>{provenanceLabel(item.provenance)}</span>
                  <span className="study-item-meta">
                    {moveLabel(item.move)} · {item.at.slice(0, 10)}
                  </span>
                  <button type="button" className="study-link" disabled={locked} onClick={() => void removeAttempt(item.id)}>
                    删除
                  </button>
                </div>
                <div>{item.what}</div>
                {item.stuck === undefined ? null : <div className="study-item-meta">卡在：{item.stuck}</div>}
                {item.result === undefined ? null : <div className="study-item-meta">结果：{item.result}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="study-gate">
        <div className="study-panel-head">
          <h3>判定与结案</h3>
          <span className="study-muted">
            判定通过 {data.gate.passed}/{data.gate.asked}（AI {data.gate.aiJudged} · 自评 {data.gate.selfJudged}） · 阈值{' '}
            {Math.round(data.gate.threshold * 100)}% · 复习卡 {data.cards.length} 张
          </span>
        </div>
        <div className="study-question-toolbar">
          <button
            type="button"
            className="study-primary study-primary-tight"
            disabled={locked || writingQuestions}
            onClick={() => void writeQuestions()}
          >
            {writingQuestions ? '出题中…' : data.sufficiency.length === 0 ? '让 AI 出判定题' : '重新出题'}
          </button>
          <span className="study-muted">
            题由模型按目标与裁剪范围出，你只作答；判定也只判你写下的答案。
          </span>
        </div>
        {noEngine ? (
          <div className="study-banner">
            <span>未配置文本引擎：判定题只能自评。设置里配好文本引擎后，这里会改成 AI 判定。</span>
          </div>
        ) : null}
        {data.sufficiency.length === 0 ? null : (
          <ul className="study-question-list">
            {data.sufficiency.map(item => {
              const open = draft?.qid === item.id
              const verdict = item.selfPass === true ? 'self' : (item.verdict ?? 'none')
              const label =
                verdict === 'pass'
                  ? '已通过'
                  : verdict === 'partial'
                    ? '部分'
                    : verdict === 'fail'
                      ? '未通过'
                      : verdict === 'self'
                        ? '自评通过'
                        : '未作答'
              return (
                <li key={item.id} className={'study-question' + (item.passed === true ? ' is-passed' : '')}>
                  <div className="study-question-head">
                    <span className={'study-verdict is-' + verdict}>{label}</span>
                    <span className="study-question-text">
                      {item.q}
                      {item.why === undefined ? null : <span className="study-question-why"> · {item.why}</span>}
                    </span>
                    <button
                      type="button"
                      className="study-ghost study-ghost-tight"
                      disabled={locked || judging === item.id}
                      onClick={() => {
                        if (open) setDraft(null)
                        else setDraft({ qid: item.id, answer: item.answer ?? '', ref: '' })
                      }}
                    >
                      {open ? '收起' : item.answer === undefined ? '作答并判定' : '重答'}
                    </button>
                    <button type="button" className="study-link" disabled={locked} onClick={() => void removeQuestion(item.id)}>
                      删除
                    </button>
                  </div>

                  {item.verdict === undefined || item.verdict === 'pass' ? null : (
                    <div className="study-question-feedback">
                      {item.advice === undefined ? null : <div>{item.advice}</div>}
                      {item.missing === undefined || item.missing.length === 0 ? null : (
                        <ul>
                          {item.missing.map(line => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}
                      {item.selfPass === true ? (
                        <div className="study-item-meta">你自评通过：{item.selfPassReason ?? ''}</div>
                      ) : null}
                    </div>
                  )}

                  {open ? (
                    <div className="study-answer">
                      <textarea
                        className="study-input study-textarea"
                        placeholder="把答案写完整：结论、关键步骤、你依赖的假设。写不出来的地方就写『这里不确定』。"
                        value={draft?.answer ?? ''}
                        disabled={judging === item.id}
                        onChange={event => setDraft(current => (current === null ? current : { ...current, answer: event.target.value }))}
                      />
                      <div className="study-inline">
                        <select
                          className="study-input"
                          value={draft?.ref ?? ''}
                          disabled={judging === item.id}
                          onChange={event => setDraft(current => (current === null ? current : { ...current, ref: event.target.value }))}
                        >
                          <option value="">不附原文（只判答案）</option>
                          {data.steps
                            .filter(step => step.target !== undefined && step.coverage !== 'skip')
                            .map(step => (
                              <option key={step.target!.materialId + ':' + step.target!.unitId} value={step.target!.materialId + ':' + step.target!.unitId}>
                                参考：{step.target!.title}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          className="study-primary study-primary-tight"
                          disabled={judging === item.id || (draft?.answer.trim().length ?? 0) === 0}
                          onClick={() => void judgeAnswer(item.id)}
                        >
                          {judging === item.id ? '判定中…' : '请 AI 判定'}
                        </button>
                        <button
                          type="button"
                          className="study-ghost study-ghost-tight"
                          disabled={judging === item.id}
                          onClick={() => void selfPass(item.id, draft?.answer ?? '', item.verdict !== undefined && item.verdict !== 'pass')}
                        >
                          自评通过
                        </button>
                        <button
                          type="button"
                          className="study-ghost study-ghost-tight"
                          disabled={judging === item.id}
                          onClick={() => void answerQuestion(item.id, false, undefined, draft?.answer.trim() ?? '')}
                        >
                          自评没过
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        <details className="study-question-manual">
          <summary className="study-link">自己加一道题（无引擎时的手动兜底）</summary>
        <div className="study-inline">
          <input
            type="text"
            className="study-input"
            placeholder="加一道判定题，例如：能白板推出 Eq.12 吗？"
            value={question}
            disabled={locked}
            onChange={event => setQuestion(event.target.value)}
          />
          <button type="button" className="study-ghost" disabled={locked || question.trim().length === 0} onClick={() => void addQuestion()}>
            添加
          </button>
        </div>
        </details>
        {data.plan.meta.closedAt === undefined ? null : (
          <div className="study-closed">
            已于 {data.plan.meta.closedAt.slice(0, 10)} 结案
            {data.plan.meta.closureNote === undefined ? '' : '：' + data.plan.meta.closureNote}
            <button type="button" className="study-link" onClick={() => void reopen()}>
              重新打开
            </button>
          </div>
        )}
        {data.plan.meta.closedAt !== undefined ? null : data.gate.ready ? (
          <div className="study-gate-ready">
            <p>
              结案门已通过。确认你自己能做到，然后结案——它不再出现在「今天」里。
              {data.gate.selfJudged === 0 ? '' : `（其中 ${data.gate.selfJudged} 道是自评，会写进结案记录）`}
            </p>
            <div className="study-inline">
              <input
                type="text"
                className="study-input"
                placeholder="结案备注（可选）：你做到了什么"
                value={closingNote}
                onChange={event => setClosingNote(event.target.value)}
              />
              <button type="button" className="study-primary study-primary-tight" onClick={() => void closeGoal()}>
                结案
              </button>
            </div>
          </div>
        ) : (
          <ul className="study-gate-reasons">
            {data.gate.reasons.map(reason => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </section>

      <section className={`study-book-card${book === null ? ' is-empty' : ''}`}>
        <div className="study-book-card-head">
          <span className="study-insight-kind">自编书（实验）</span>
          {book === null ? (
            <span className="study-muted">把这条路径编译成一本有目录、有过渡、可连续阅读的独立书稿。</span>
          ) : (
            <span className="study-item-meta">
              {book.title} · {book.done}/{book.chapters} 章已生成
            </span>
          )}
        </div>
        {book === null ? (
          <button type="button" className="study-primary study-primary-tight" disabled={inlineBusy || data.steps.length === 0} onClick={() => void compileBook()}>
            {inlineBusy ? '正在编译…' : '编译成自编书'}
          </button>
        ) : (
          <div className="study-inline">
            <button type="button" className="study-primary study-primary-tight" onClick={() => onOpenBook(book.id, pid)}>
              打开自编书
            </button>
          </div>
        )}
      </section>

      <h3 className="study-section-title">其他步骤</h3>
      {otherSteps.length === 0 ? <p className="study-muted">没有练习或对比步骤。</p> : null}
      <ol className="study-steps">
        {otherSteps.map(step => {
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
