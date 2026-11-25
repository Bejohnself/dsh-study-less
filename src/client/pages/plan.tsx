/**
 * One goal in detail: goal metadata, section route, knowledge targets and closure.
 *
 * The old attempt / judgement-question layer is a compatibility surface and is
 * intentionally absent here: the main loop passes and closes via knowledge.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { JobView, PlanDetailView, PlanStepView } from '../../core/views.ts'
import { api, errorText, post, waitForJob } from '../api.ts'
import { currentSessionId, openConversation } from '../actions.ts'
import { coverageLabel } from '../labels.ts'
import { InlineMarkdown, JobBanner, Toast } from '../components/ui.tsx'
import {
  MASTERY_VIEW_KEY,
  MasterySky,
  PlanViewSwitch,
  ROUTE_GROUPS,
  ROUTE_VIEW_KEY,
  RouteMap,
  readPlanView,
  writePlanView,
  type PlanViewMode,
} from '../components/planVisual.tsx'

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
  refreshToken,
  onChanged,
}: {
  pid: string
  onBack: () => void
  onOpenUnit: (mid: string, uid: string, planId?: string) => void
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
  const [metaDraft, setMetaDraft] = useState({ deliverable: '', deadline: '', audience: '' })
  const [metaSaving, setMetaSaving] = useState(false)
  const [closingNote, setClosingNote] = useState('')
  const [routeView, setRouteView] = useState<PlanViewMode>(() => readPlanView(ROUTE_VIEW_KEY))
  const [masteryView, setMasteryView] = useState<PlanViewMode>(() => readPlanView(MASTERY_VIEW_KEY))
  const [conceptBusy, setConceptBusy] = useState<string | null>(null)

  // 略读的节在星图总览里只留一个暗点；集合每次 data 变化才重建，免得悬停时重排星图。
  const skimTargets = useMemo(
    () =>
      new Set(
        (data?.steps ?? [])
          .filter(step => step.coverage === 'skim' && step.target !== undefined)
          .map(step => `${step.target!.materialId}:${step.target!.unitId}`),
      ),
    [data?.steps],
  )

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
      sections: (raw.sections ?? []).map(section => ({
        ...section,
        level: section.level ?? 2,
        atTarget: section.atTarget === true,
        conceptStates: section.conceptStates ?? [],
        concepts: section.concepts ?? [],
      })),
      // An older Host predates the missing-section count; 0 keeps the page
      // readable until the plugin is reloaded.
      goalProgress: {
        ...(raw.goalProgress ?? { passed: 0, total: 0, ready: false, reasons: [] }),
        missingSections: raw.goalProgress?.missingSections ?? 0,
      },
    }
    setData(plan)
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

  const removePlan = async (): Promise<void> => {
    if (
      !window.confirm(
        '删除这个目标？它的判定卡、为它开的练习记录、它生成的书都会删掉；资料和知识点掌握度保留。这一步不能撤销。',
      )
    )
      return
    try {
      await post('/plan/delete', { pid })
      onChanged()
      onBack()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
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

  const setLevel = async (n: number, level: 1 | 2 | 3 | 4): Promise<void> => {
    setBusy(n)
    try {
      await act('', () => post('/plan/update', { pid, setLevel: { n, level } }))
    } finally {
      setBusy(null)
    }
  }

  /** Fill one section's knowledge points from its original text. */
  const extractConcept = async (target: string): Promise<void> => {
    setConceptBusy(target)
    try {
      await post('/plan/concepts', { pid, target })
      await reload()
      onChanged()
      setToast({ message: '这一节的知识点已补上', tone: 'ok' })
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setConceptBusy(null)
    }
  }

  const crop = async (n: number, coverage: 'read' | 'skim' | 'skip'): Promise<void> => {
    let reason: string | undefined
    if (coverage === 'skip') {
      const value = window.prompt('为什么这段对目标不需要？（必填，会作为「不读」的理由留在节级路线上）')
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

  const closeGoal = async (): Promise<void> => {
    const note = closingNote.trim()
    await act('已结案：不再出现在「今天」里', () => post('/plan/close', { pid, ...(note.length === 0 ? {} : { note }) }))
    setClosingNote('')
  }

  const reopen = async (): Promise<void> => {
    await act('目标已重新打开', () => post('/plan/update', { pid, setStatus: 'active' }))
  }

  const changeRouteView = (mode: PlanViewMode): void => {
    setRouteView(mode)
    writePlanView(ROUTE_VIEW_KEY, mode)
  }

  const changeMasteryView = (mode: PlanViewMode): void => {
    setMasteryView(mode)
    writePlanView(MASTERY_VIEW_KEY, mode)
  }

  const openPoint = (target: string | undefined): void => {
    const parsed = target === undefined ? null : targetOf(target)
    if (parsed !== null) onOpenUnit(parsed.mid, parsed.uid, pid)
  }

  /**
   * The chat path writes the route from another session: nothing here is told
   * when it lands, so a draft polls until it does. Without this the page sits on
   * "编排中" until the reader reloads by hand.
   */
  useEffect(() => {
    if (data === null || data.plan.status !== 'draft') return
    if (data.plan.generation?.status === 'failed') return
    const timer = window.setInterval(() => {
      void reload().catch(() => undefined)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [data?.plan.status, data?.plan.generation?.status, reload])

  if (error !== null) return <div className="study-empty">无法读取路径：{error}</div>
  if (data === null) return <div className="study-empty">正在载入路径…</div>

  const locked = data.plan.status === 'done'
  const isUnitStep = (kind: string): boolean => kind === 'unit' || kind === 'paper-pass'
  const unitSteps = data.steps.filter(step => isUnitStep(step.kind))
  /** Nothing below the goal itself is worth showing until the route exists. */
  const routeReady = unitSteps.length > 0

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
            {metaDraft.deliverable.trim().length > 0 ? (
              <p className="study-field-value">{metaDraft.deliverable}</p>
            ) : (
              // 只在空着时给一次填写机会：结案门要求非空，全锁死会让老目标永久结不了案。
              <input
                type="text"
                className="study-input"
                placeholder="例如：能独立推导这篇论文第 3–5 节，并讲给同事 20 分钟"
                value={metaDraft.deliverable}
                disabled={locked || metaSaving}
                onChange={event => setMetaDraft({ ...metaDraft, deliverable: event.target.value })}
              />
            )}
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
          <span className="study-muted">交付物在建目标时定下，之后不再改；没有它不能结案。</span>
        </div>
      </section>

      {routeReady ? (
        <>
          <section className="study-boundary">
            <div className="study-panel-head is-split">
              <div className="study-panel-head-row">
                <h3>节级路线</h3>
                <PlanViewSwitch value={routeView} onChange={changeRouteView} label="节级路线" />
              </div>
              <span className="study-muted">
                最小集 {data.boundary.minPages} 页 / 全书 {data.boundary.totalPages} 页 · 必读 {data.boundary.read} · 略读 {data.boundary.skim} · 不读 {data.boundary.skip}
              </span>
            </div>
            {routeView === 'visual' ? (
              <RouteMap steps={unitSteps} onOpenUnit={onOpenUnit} planId={pid} />
            ) : (
              <>
                {unitSteps.length === 0 ? (
                  <p className="study-muted">这个目标还没有节级路线：重新编排一次，或手动补上要读的节。</p>
                ) : null}
                {ROUTE_GROUPS.map(group => {
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
                            ) : step.done ? (
                              <span className="study-skip-mark" title="过关测试的这节知识点都已到档">
                                ✓ 到档
                              </span>
                            ) : (
                              <span className="study-skip-mark" aria-hidden="true" />
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
                              <div className="study-item-meta">
                                {step.current === true ? <span className="study-current-mark">下一步</span> : null}
                                <InlineMarkdown source={step.why} />
                              </div>
                              {step.progress === undefined ? null : (
                                <div className="study-item-meta">
                                  掌握 {Math.floor(step.progress.mastery * 100)}% · {step.progress.passed}/{step.progress.total} 知识点达标
                                </div>
                              )}
                              {step.skipReason === undefined ? null : (
                                <div className="study-skip-reason">
                                  不读理由：<InlineMarkdown source={step.skipReason} />
                                </div>
                              )}
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
                            <div className="study-coverage" role="group" aria-label={'第 ' + step.n + ' 步的档位'}>
                              {([1, 2, 3, 4] as const).map(value => (
                                <button
                                  key={value}
                                  type="button"
                                  className={'study-coverage-btn' + ((step.level ?? 2) === value ? ' is-on' : '')}
                                  disabled={locked || busy !== null}
                                  onClick={() => void setLevel(step.n, value)}
                                >
                                  {['', '了解', '会用', '能讲', '创新'][value]}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </section>

          <section className="study-knowledge">
            <div className="study-panel-head is-split">
              <div className="study-panel-head-row">
                <h3>知识点目标</h3>
                <PlanViewSwitch value={masteryView} onChange={changeMasteryView} label="知识点目标" />
              </div>
              <span className="study-muted">
                到档位 {data.sections.filter(section => section.atTarget).length}/{data.sections.length}
                {data.goalProgress.missingSections === 0 ? '' : ` · 还有 ${data.goalProgress.missingSections} 节没有知识点`}
                {' · '}知识点属于节本身，目标只定这一节要到哪一档
              </span>
            </div>
            {masteryView === 'visual' ? (
              <MasterySky sections={data.sections} skim={skimTargets} />
            ) : data.sections.length === 0 ? (
              <p className="study-muted">
                还没有知识点目标。逐节点「补知识点」从原文抽，或重新生成一次路径。
              </p>
            ) : (
              <ul className="study-knowledge-list">
                {data.sections.map(point => {
                  const atTarget = point.conceptStates.filter(state => state.atTarget).length
                  return (
                    <li key={point.target} className={'study-knowledge-item' + (point.atTarget ? ' is-passed' : '')}>
                      <span className={'study-verdict' + (point.atTarget ? ' is-pass' : '')}>
                        {point.atTarget ? '到档' : '未到'}
                      </span>
                      <div className="study-knowledge-body">
                        <div>
                          {point.title}
                          <span className="study-item-meta">
                            {' '}
                            · {['', '了解', '会用', '能讲', '创新'][point.level]}
                          </span>
                        </div>
                        <div className="study-item-meta">
                          掌握 {Math.floor(point.mastery * 100)}% / 目标 {Math.round(point.threshold * 100)}%
                          {point.conceptStates.length === 0
                            ? ' · 未挂知识点'
                            : ` · ${atTarget}/${point.conceptStates.length} 概念达标`}
                        </div>
                        {point.conceptStates.length === 0 ? (
                          <div className="study-point-empty">
                            <span className="study-muted">这一节还没有知识点，结案会漏掉它。</span>
                            <button
                              type="button"
                              className="study-link"
                              disabled={locked || conceptBusy !== null}
                              onClick={() => void extractConcept(point.target)}
                            >
                              {conceptBusy === point.target ? '抽取中…' : '补知识点'}
                            </button>
                          </div>
                        ) : (
                          <ul className="study-point-list">
                            {point.conceptStates.map(state => (
                              <li key={state.id} className={'study-point-row' + (state.atTarget ? ' is-on' : '')}>
                                <span className="study-point-name">{state.name}</span>
                                <span className="study-point-value">
                                  {Math.floor(state.mastery * 100)}% / {Math.round(state.threshold * 100)}%
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="study-gate">
            <div className="study-panel-head">
              <h3>结案条件</h3>
              <span className="study-muted">
                知识点 {data.goalProgress.passed}/{data.goalProgress.total}
                {data.goalProgress.total === 0 ? '' : ' · 全部到档位且复习排到期限之外才可结案'}
              </span>
            </div>
            {data.plan.meta.closedAt === undefined ? null : (
              <div className="study-closed">
                已于 {data.plan.meta.closedAt.slice(0, 10)} 结案
                {data.plan.meta.closureNote === undefined ? '' : '：' + data.plan.meta.closureNote}
                <button type="button" className="study-link" onClick={() => void reopen()}>
                  重新打开
                </button>
              </div>
            )}
            {data.plan.meta.closedAt !== undefined ? null : data.goalProgress.ready ? (
              <div className="study-gate-ready">
                <p>条件已满足。确认你自己能做到，然后结案——它不再出现在「今天」里。</p>
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
                {data.goalProgress.reasons.map(reason => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

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
