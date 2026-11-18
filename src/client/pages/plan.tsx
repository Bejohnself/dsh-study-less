/**
 * One goal in detail: boundary, steps, attempts, questions and closure.
 *
 * Extracted from the learn page because this single view is most of it; the
 * dashboard (today / paths / review) and the goal dialog stay in learn.tsx.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { BookSummary, JobView, PlanDetailView } from '../../core/views.ts'
import type { AttemptMove, Provenance } from '../../core/types.ts'
import { api, errorText, post, waitForJob } from '../api.ts'
import { currentSessionId, openConversation } from '../actions.ts'
import { coverageLabel, moveLabel, provenanceLabel, stepKindLabel } from '../labels.ts'
import { JobBanner, Toast } from '../components/ui.tsx'

/** Goals whose questions were already auto-requested this session. */
const askedKey = new Set<string>()

/** Split `<material>:<unit>` for a jump target; bad keys are not linkable. */
function targetOf(key: string): { mid: string; uid: string } | null {
  const index = key.indexOf(':')
  if (index <= 0 || index === key.length - 1) return null
  return { mid: key.slice(0, index), uid: key.slice(index + 1) }
}

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
      mastery: raw.mastery ?? [],
      sufficiency: raw.sufficiency ?? [],
      gate: raw.gate ?? {
        independent: 0,
        independentNeeded: 3,
        judged: 0,
        unverified: 0,
        masteryPassed: 0,
        masteryTotal: 0,
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

      <section className="study-mastery">
        <div className="study-panel-head">
          <h3>掌握点（图景）</h3>
          <span className="study-muted">
            通过 {data.mastery.filter(point => point.passedAt !== undefined).length}/{data.mastery.length} · 出题与判定都按这张图
          </span>
        </div>
        {data.mastery.length === 0 ? (
          <p className="study-muted">
            还没有掌握点。目标是建的时候由 AI 画出来的；重新生成一次路径会把它们补上。
          </p>
        ) : (
          <ul className="study-mastery-list">
            {data.mastery.map(point => {
              const target = point.target === undefined ? null : targetOf(point.target)
              return (
                <li key={point.id} className={'study-mastery-item' + (point.passedAt === undefined ? '' : ' is-passed')}>
                  <span className={'study-verdict' + (point.passedAt === undefined ? '' : ' is-pass')}>
                    {point.passedAt === undefined ? '未过' : '已过'}
                  </span>
                  <div className="study-mastery-body">
                    <div>
                      {point.title}
                      {point.level === undefined ? null : (
                        <span className="study-item-meta">
                          {' '}
                          · {['', '了解', '会用', '能讲', '创新'][point.level]}
                        </span>
                      )}
                    </div>
                    <div className="study-item-meta">算掌握：{point.standard}</div>
                  </div>
                  {target === null ? null : (
                    <button
                      type="button"
                      className="study-link"
                      onClick={() => onOpenUnit(target.mid, target.uid, pid)}
                    >
                      去这一节过关
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="study-gate">
        <div className="study-panel-head">
          <h3>判定与结案</h3>
          <span className="study-muted">
            判定通过 {data.gate.passed}/{data.gate.asked}（AI {data.gate.aiJudged} · 自评 {data.gate.selfJudged}） · 阈值{' '}
            {Math.round(data.gate.threshold * 100)}% · 复习卡 {data.cards.length} 张
            {data.gate.masteryTotal === 0 ? null : ` · 掌握点 ${data.gate.masteryPassed}/${data.gate.masteryTotal}`}
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
