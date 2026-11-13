/**
 * Browser half of the dsh-study bundle.
 *
 * Contributes the sidebar row and the center-column page: Today (due reviews,
 * next step, weak concepts), the library shelf, the table of contents with
 * completion checkboxes, the reader (original page slices beside generated
 * notes) and the cross-material concept pages.
 *
 * All state comes from the Host through /study-api; this half never writes files.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  CompleteResult,
  ConceptCard,
  ConceptDetailView,
  MaterialCard,
  MaterialStateView,
  PlanDetailView as PlanDetailData,
  PlanSummary,
  TocRow,
  TodayView as TodayData,
  UnitView,
} from '../core/views.ts'
import { openConversation, installActions } from './actions.ts'
import { ImportDialog, GoalDialog } from './dialogs.tsx'
import { renderMarkdown } from './markdown.ts'
import { ensureStudyStyles } from './styles.ts'
import { installTheme } from './theme.ts'

/** The panel id shared by the sidebar row and the main-slot occupant. */
export const STUDY_PANEL_ID = 'study-desk'

/** Row order among the shell's global panel rows (Plugins is 0, Schedule 10). */
const PANEL_ORDER = 30

/** API failure with the server's machine code. */
class ApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** Call one study API endpoint and unwrap `{ ok, value }`. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/study-api${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('bad-response', `接口返回了非 JSON（HTTP ${response.status}）`)
  }
  const value = payload as { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }
  if (response.ok && value.ok === true) return value.value as T
  throw new ApiError(value.error?.code ?? 'error', value.error?.message ?? `请求失败（HTTP ${response.status}）`)
}

/** Human label of a material type. */
function typeLabel(type: MaterialCard['type']): string {
  return type === 'paper' ? '论文' : type === 'article' ? '文章' : '书'
}

/** Whether a unit is learned or in review. */
function isDone(row: TocRow): boolean {
  return row.state === 'learned' || row.state === 'reviewing'
}

/** Render one error message. */
function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

const ROLE_LABEL: Record<string, string> = {
  definition: '定义',
  method: '方法',
  evidence: '证据',
  critique: '批评',
  use: '应用',
}

/** The sidebar row glyph; the shell owns the button, label and geometry. */
function StudyPanelIcon({ size }: { size: number; active: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 3.2c0-.4.3-.7.7-.7h3.4c.6 0 1.1.2 1.4.6.3-.4.8-.6 1.4-.6h3.4c.4 0 .7.3.7.7v8.6c0 .4-.3.7-.7.7H9.7c-.6 0-1.1.2-1.4.6-.3-.4-.8-.6-1.4-.6H3.2a.7.7 0 0 1-.7-.7V3.2Z" />
      <path d="M8 3.8v8.6" />
    </svg>
  )
}

/** A small toast that disappears on its own. */
function Toast({ message, tone }: { message: string; tone: 'ok' | 'error' }): ReactElement {
  return <div className={`study-toast study-toast-${tone}`}>{message}</div>
}

/** Top navigation of the page. */
function Nav({
  active,
  onSelect,
}: {
  active: 'today' | 'library' | 'concepts' | 'plans'
  onSelect: (target: 'today' | 'library' | 'concepts' | 'plans') => void
}): ReactElement {
  const items: Array<{ id: 'today' | 'library' | 'concepts' | 'plans'; label: string }> = [
    { id: 'today', label: '今日' },
    { id: 'library', label: '书架' },
    { id: 'plans', label: '路径' },
    { id: 'concepts', label: '概念' },
  ]
  return (
    <div className="study-nav" role="tablist">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          className={active === item.id ? 'is-on' : ''}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** The Today page: exactly three things to do. */
function TodayView({
  onOpenUnit,
  onOpenConcept,
  onOpenLibrary,
}: {
  onOpenUnit: (mid: string, uid: string) => void
  onOpenConcept: (cid: string) => void
  onOpenLibrary: () => void
}): ReactElement {
  const [data, setData] = useState<TodayData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<TodayData>('/today')
      .then(value => {
        if (alive) setData(value)
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [])

  if (error !== null) return <div className="study-empty">无法读取今日面板：{error}</div>
  if (data === null) return <div className="study-empty">正在整理今天的任务…</div>

  const nothing = data.due.length === 0 && data.next === null && data.weak.length === 0

  return (
    <div className="study-today">
      <div className="study-today-line">
        <span className="study-today-date">{data.date}</span>
        <span className="study-muted">今天已完成 {data.learnedToday} 节</span>
        <span className="study-muted">·</span>
        <span className={data.due.length > 0 ? 'study-warn-text' : 'study-muted'}>
          {data.due.length > 0 ? `${data.due.length} 节待复习` : '没有到期复习'}
        </span>
      </div>

      {nothing ? (
        <div className="study-empty">
          <p>还没有可学的内容。</p>
          <p className="study-hint">
            在对话里说「导入 /path/to/book.pdf」，或说「我想搞懂 X，帮我从书库里排一条路径」。导入后这里每天只给你三件事。
          </p>
          <button type="button" className="study-primary" onClick={onOpenLibrary}>
            去书架看看
          </button>
        </div>
      ) : null}

      <div className="study-today-grid">
        <section className="study-panel">
          <h3>复习到期</h3>
          {data.due.length === 0 ? (
            <p className="study-muted">今天没有到期卡片。间隔重复的收益来自「该复习时复习」，不用加练。</p>
          ) : (
            <ul className="study-list">
              {data.due.slice(0, 8).map(item => (
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
                  <span className="study-plan-goal">{plan.goal}</span>
                  <span className="study-item-meta">
                    {plan.done}/{plan.total} 步{plan.next === undefined ? '' : ` · 下一步：${plan.next.title}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
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
    </div>
  )
}

/** The library shelf. */
function LibraryView({ onOpen, refreshToken }: { onOpen: (id: string) => void; refreshToken: number }): ReactElement {
  const [cards, setCards] = useState<MaterialCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<MaterialCard[]>('/library')
      .then(value => {
        if (alive) setCards(value)
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [refreshToken])

  if (error !== null) return <div className="study-empty">无法读取书库：{error}</div>
  if (cards === null) return <div className="study-empty">正在读取书库…</div>
  if (cards.length === 0) {
    return (
      <div className="study-empty">
        <p>书库还是空的。</p>
        <p className="study-hint">
          在对话里说「导入 /path/to/book.pdf」，或把 PDF 发进对话；Agent 会调用 study_import_book 建立单元并逐节生成精读稿。
        </p>
      </div>
    )
  }

  return (
    <div className="study-shelf">
      {cards.map(card => {
        const percent = card.units === 0 ? 0 : Math.round((card.learnedUnits / card.units) * 100)
        return (
          <button key={card.id} type="button" className="study-book" onClick={() => onOpen(card.id)}>
            <span className="study-book-top">
              <span className={`study-badge study-badge-${card.type}`}>{typeLabel(card.type)}</span>
              {card.dueCount > 0 ? <span className="study-due-badge">{card.dueCount} 待复习</span> : null}
            </span>
            <span className="study-book-title">{card.title}</span>
            <span className="study-book-meta">
              {[card.authors.slice(0, 2).join(' · '), card.year, `${card.pages} 页`, `${card.units} 单元`]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="study-progress">
              <span className="study-progress-bar">
                <span style={{ width: `${percent}%` }} />
              </span>
              <span className="study-progress-text">
                {card.learnedUnits}/{card.units} 已学 · {card.verifiedUnits} 节已校验
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Table of contents with completion checkboxes. */
function TocList({
  state,
  current,
  onSelect,
  onToggle,
  busy,
}: {
  state: MaterialStateView
  current: string | null
  onSelect: (uid: string) => void
  onToggle: (row: TocRow, done: boolean) => void
  busy: string | null
}): ReactElement {
  return (
    <nav className="study-toc" aria-label="目录">
      {state.toc.map(row => {
        const done = isDone(row)
        const active = current === row.uid
        return (
          <div key={row.uid} className={`study-toc-row${active ? ' is-active' : ''}${row.kind === 'pass' ? ' is-pass' : ''}`}>
            <input
              type="checkbox"
              className="study-check"
              checked={done}
              disabled={busy === row.uid}
              aria-label={`标记「${row.title}」学完`}
              onChange={event => onToggle(row, event.target.checked)}
            />
            <button type="button" className="study-toc-title" onClick={() => onSelect(row.uid)}>
              <span className="study-toc-text">{row.title}</span>
              <span className="study-toc-meta">
                p{row.pageStart}
                {row.pageEnd > row.pageStart ? `–${row.pageEnd}` : ''}
                {row.status === 'verified' ? ' · 已校验' : row.status === 'drafted' ? ' · 有精读' : ''}
                {row.due !== undefined ? ` · ${row.due} 到期` : ''}
              </span>
            </button>
          </div>
        )
      })}
    </nav>
  )
}

/** The reader for one unit. */
function UnitReader({
  mid,
  uid,
  onBack,
  onOpenConcept,
}: {
  mid: string
  uid: string
  onBack: () => void
  onOpenConcept: (cid: string) => void
}): ReactElement {
  const [unit, setUnit] = useState<UnitView | null>(null)
  const [tab, setTab] = useState<'notes' | 'original'>('original')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setUnit(null)
    setError(null)
    api<UnitView>(`/unit?mid=${encodeURIComponent(mid)}&uid=${encodeURIComponent(uid)}`)
      .then(value => {
        if (!alive) return
        setUnit(value)
        setTab(value.notes !== null ? 'notes' : 'original')
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [mid, uid])

  if (error !== null) return <div className="study-empty">无法打开这一节：{error}</div>
  if (unit === null) return <div className="study-empty">正在载入…</div>

  return (
    <div className="study-reader">
      <div className="study-reader-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 目录
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

      {tab === 'notes' ? (
        unit.notes === null ? (
          <div className="study-empty">
            <p>这一节还没有精读稿。</p>
            <p className="study-hint">
              在对话里说「为 {unit.material.title} 的「{unit.unit.title}」写精读稿」，Agent 会读原文、写作并调用 study_unit_write 落盘。
            </p>
          </div>
        ) : (
          <article className="study-notes" dangerouslySetInnerHTML={{ __html: renderMarkdown(unit.notes) }} />
        )
      ) : (
        <div className="study-original">
          {unit.original.map(page => (
            <section key={page.page} className="study-page-slice">
              <span className="study-page-no">p{page.page}</span>
              <pre>{page.text}</pre>
            </section>
          ))}
          {unit.truncated ? <div className="study-truncated">原文较长，这里只显示前 30 页。</div> : null}
        </div>
      )}
    </div>
  )
}

/** Material detail: TOC + reader. */
function MaterialView({
  mid,
  initialUid,
  onBack,
  onOpenConcept,
}: {
  mid: string
  initialUid?: string
  onBack: () => void
  onOpenConcept: (cid: string) => void
}): ReactElement {
  const [state, setState] = useState<MaterialStateView | null>(null)
  const [current, setCurrent] = useState<string | null>(initialUid ?? null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const value = await api<MaterialStateView>(`/material?mid=${encodeURIComponent(mid)}`)
    setState(value)
    setCurrent(previous => previous ?? value.next ?? value.toc[0]?.uid ?? null)
  }, [mid])

  useEffect(() => {
    let alive = true
    reload().catch(reason => {
      if (alive) setError(errorText(reason))
    })
    return () => {
      alive = false
    }
  }, [reload])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const toggle = useCallback(
    async (row: TocRow, done: boolean) => {
      if (state === null) return
      setBusy(row.uid)
      try {
        if (done) {
          const result = await api<CompleteResult>('/unit/complete', {
            method: 'POST',
            body: JSON.stringify({ mid, uid: row.uid, rating: 3 }),
          })
          setToast({ message: result.note, tone: 'ok' })
        } else {
          await api<{ revision: number }>('/unit/uncomplete', {
            method: 'POST',
            body: JSON.stringify({ mid, uid: row.uid }),
          })
          setToast({ message: '已取消勾选。', tone: 'ok' })
        }
        await reload()
      } catch (reason) {
        setToast({ message: errorText(reason), tone: 'error' })
      } finally {
        setBusy(null)
      }
    },
    [mid, reload, state],
  )

  if (error !== null) return <div className="study-empty">无法读取这本资料：{error}</div>
  if (state === null) return <div className="study-empty">正在载入目录…</div>

  const next = state.next === undefined ? null : state.toc.find(row => row.uid === state.next) ?? null

  return (
    <div className="study-material">
      <div className="study-material-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 书架
        </button>
        <div className="study-reader-title">
          <h2>{state.material.title}</h2>
          <span className="study-reader-sub">
            {typeLabel(state.material.type)} · {state.material.units} 单元 · {state.material.learnedUnits} 已学
            {state.material.dueCount > 0 ? ` · ${state.material.dueCount} 待复习` : ''}
          </span>
        </div>
        {next !== null ? (
          <button type="button" className="study-next" onClick={() => setCurrent(next.uid)}>
            下一步：{next.title}
          </button>
        ) : null}
      </div>

      <div className="study-body">
        <TocList
          state={state}
          current={current}
          busy={busy}
          onSelect={setCurrent}
          onToggle={(row, done) => {
            void toggle(row, done)
          }}
        />
        <div className="study-content">
          {current === null ? (
            <div className="study-empty">从左侧目录选一节开始。</div>
          ) : (
            <UnitReader mid={mid} uid={current} onBack={() => setCurrent(null)} onOpenConcept={onOpenConcept} />
          )}
        </div>
      </div>

      {toast !== null ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  )
}

/** The cross-material concept list. */
function ConceptListView({ onOpenConcept }: { onOpenConcept: (cid: string) => void }): ReactElement {
  const [items, setItems] = useState<ConceptCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<ConceptCard[]>('/concepts')
      .then(value => {
        if (alive) setItems(value)
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [])

  if (error !== null) return <div className="study-empty">无法读取概念：{error}</div>
  if (items === null) return <div className="study-empty">正在读取概念图…</div>
  if (items.length === 0) {
    return (
      <div className="study-empty">
        <p>还没有概念。</p>
        <p className="study-hint">生成精读稿时登记的概念会出现在这里，并跨书/论文共享掌握度。</p>
      </div>
    )
  }

  return (
    <div className="study-concepts">
      {items.map(item => (
        <button key={item.id} type="button" className="study-concept-card" onClick={() => onOpenConcept(item.id)}>
          <span className="study-concept-head">
            <span className="study-concept-name">{item.name}</span>
            {item.weak ? <span className="study-due-badge">薄弱</span> : null}
          </span>
          <span className="study-mastery">
            <span className="study-mastery-bar">
              <span style={{ width: `${Math.round(item.mastery * 100)}%` }} />
            </span>
            <span className="study-muted">{Math.round(item.mastery * 100)}%</span>
          </span>
          <span className="study-item-meta">
            {item.occurrences} 处 · {item.materials.join(' / ')}
          </span>
        </button>
      ))}
    </div>
  )
}

/** One concept with every place it appears. */
function ConceptDetailView({
  cid,
  onBack,
  onOpenUnit,
  onOpenConcept,
}: {
  cid: string
  onBack: () => void
  onOpenUnit: (mid: string, uid: string) => void
  onOpenConcept: (cid: string) => void
}): ReactElement {
  const [data, setData] = useState<ConceptDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    api<ConceptDetailView>(`/concept?cid=${encodeURIComponent(cid)}`)
      .then(value => {
        if (alive) setData(value)
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [cid])

  if (error !== null) return <div className="study-empty">无法打开概念：{error}</div>
  if (data === null) return <div className="study-empty">正在载入概念…</div>

  return (
    <div className="study-concept-detail">
      <div className="study-material-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 概念
        </button>
        <div className="study-reader-title">
          <h2>{data.concept.name}</h2>
          <span className="study-reader-sub">
            {data.mastery === undefined
              ? '尚未练习'
              : `掌握度 ${Math.round(data.mastery.mastery * 100)}% · 答对 ${data.mastery.correct}/${data.mastery.attempts}`}
          </span>
        </div>
      </div>

      {data.concept.definition.length > 0 ? <p className="study-definition">{data.concept.definition}</p> : null}

      <h3 className="study-section-title">在资料中的位置</h3>
      <ul className="study-list">
        {data.occurrences.map(occurrence => (
          <li key={`${occurrence.materialId}:${occurrence.unitId}:${occurrence.page}:${occurrence.role}`}>
            <button
              type="button"
              className="study-item"
              onClick={() => onOpenUnit(occurrence.materialId, occurrence.unitId)}
            >
              <span className="study-item-title">
                {occurrence.unitTitle} <span className="study-role">{ROLE_LABEL[occurrence.role] ?? occurrence.role}</span>
              </span>
              <span className="study-item-meta">
                {occurrence.materialTitle} · p{occurrence.page}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {data.concept.prereqOf.length > 0 || data.concept.related.length > 0 ? (
        <>
          <h3 className="study-section-title">相关概念</h3>
          <div className="study-chips">
            {[...data.concept.prereqOf, ...data.concept.related].map(related => (
              <button key={related} type="button" className="study-chip" onClick={() => onOpenConcept(related)}>
                {related}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** The list of learning paths. */
function PlanListView({ onOpen }: { onOpen: (pid: string) => void }): ReactElement {
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
  }, [])

  if (error !== null) return <div className="study-empty">无法读取路径：{error}</div>
  if (plans === null) return <div className="study-empty">正在读取学习路径…</div>
  if (plans.length === 0) {
    return (
      <div className="study-empty">
        <p>还没有学习路径。</p>
        <p className="study-hint">
          在对话里说「我想搞懂 Raft 的日志复制，帮我排一条路径」或「读懂这篇论文」，Agent 会先算前置概念缺口，再从书和论文里排出具体步骤。
        </p>
      </div>
    )
  }

  return (
    <div className="study-plans-page">
      {plans.map(plan => {
        const percent = plan.total === 0 ? 0 : Math.round((plan.done / plan.total) * 100)
        return (
          <button key={plan.id} type="button" className="study-plan-card" onClick={() => onOpen(plan.id)}>
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
            <span className="study-progress">
              <span className="study-progress-bar">
                <span style={{ width: `${percent}%` }} />
              </span>
              <span className="study-progress-text">
                {plan.done}/{plan.total} 步{plan.next === undefined ? '' : ` · 下一步：${plan.next}`}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** One learning path with its steps. */
function PlanDetailView({
  pid,
  onBack,
  onOpenUnit,
  onOpenConcept,
}: {
  pid: string
  onBack: () => void
  onOpenUnit: (mid: string, uid: string) => void
  onOpenConcept: (cid: string) => void
}): ReactElement {
  const [data, setData] = useState<PlanDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const reload = useCallback(async () => {
    setData(await api<PlanDetailData>(`/plan?pid=${encodeURIComponent(pid)}`))
  }, [pid])

  useEffect(() => {
    let alive = true
    reload().catch(reason => {
      if (alive) setError(errorText(reason))
    })
    return () => {
      alive = false
    }
  }, [reload])

  const toggle = async (n: number, done: boolean): Promise<void> => {
    setBusy(n)
    try {
      await api<PlanDetailData>('/plan/update', {
        method: 'POST',
        body: JSON.stringify({ pid, setStep: { n, done } }),
      })
      await reload()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(null)
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
      </div>

      {data.plan.status === 'draft' ? (
        <div className="study-banner">
          <span>这条路径还在由 AI 编排（步骤写入后会自动变为「进行中」）。</span>
          <button
            type="button"
            className="study-link"
            onClick={() => {
              openConversation()
            }}
          >
            打开对话
          </button>
        </div>
      ) : null}

      <ol className="study-steps">
        {data.steps.map(step => (
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
                <span className="study-step-kind">{step.kind === 'unit' ? '精读' : step.kind === 'paper-pass' ? '论文' : step.kind === 'drill' ? '练习' : '对比'}</span>
                {step.target === undefined ? (
                  <span>{step.concepts?.map(concept => concept.name).join('、') ?? step.materials?.map(material => material.title).join(' / ') ?? '—'}</span>
                ) : (
                  <button type="button" className="study-link" onClick={() => onOpenUnit(step.target!.materialId, step.target!.unitId)}>
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
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

type View =
  | { kind: 'plans' }
  | { kind: 'plan'; pid: string }
  | { kind: 'today' }
  | { kind: 'library' }
  | { kind: 'concepts' }
  | { kind: 'concept'; cid: string }
  | { kind: 'material'; mid: string; uid?: string }

/** The center-column page. */
function StudyPanel(): ReactElement {
  const [view, setView] = useState<View>({ kind: 'today' })
  const [dialog, setDialog] = useState<'import' | 'goal' | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)

  const nav: 'today' | 'library' | 'concepts' | 'plans' =
    view.kind === 'library' || view.kind === 'material'
      ? 'library'
      : view.kind === 'concept' || view.kind === 'concepts'
        ? 'concepts'
        : view.kind === 'plan' || view.kind === 'plans'
          ? 'plans'
          : 'today'

  const subtitle = useMemo(() => {
    if (view.kind === 'today') return '到期复习 · 路径下一步 · 薄弱概念，一次只给三件事'
    if (view.kind === 'library') return '书与论文统一管理；勾选即记录首次学习，次日进入复习队列'
    if (view.kind === 'concepts') return '跨资料共享掌握度；点开任一概念可跳到所有出现位置'
    if (view.kind === 'plans') return '一个目标串起多份资料；点开路径按顺序推进'
    if (view.kind === 'plan') return '每一步都指向真实单元；勾掉即推进'
    if (view.kind === 'concept') return '这个概念在不同资料里的所有位置'
    return '目录、原文与精读并排；精读稿由 Agent 按固定结构生成'
  }, [view.kind])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openUnit = (mid: string, uid: string): void => {
    setView({ kind: 'material', mid, uid })
  }
  const openConcept = (cid: string): void => {
    setView({ kind: 'concept', cid })
  }

  return (
    <div data-dsh-study="" className="study-page">
      <div className="study-shell">
        <div className="study-head">
          <h1>书桌</h1>
          <span className="study-sub">{subtitle}</span>
          <div className="study-head-nav">
            <Nav active={nav} onSelect={target => setView({ kind: target })} />
            <div className="study-head-actions">
              <button
                type="button"
                className="study-ghost"
                onClick={() => {
                  setDialog('import')
                }}
              >
                ＋ 导入资料
              </button>
              <button
                type="button"
                className="study-primary study-primary-tight"
                onClick={() => {
                  setDialog('goal')
                }}
              >
                ＋ 新建目标
              </button>
            </div>
          </div>
        </div>

        {view.kind === 'today' ? (
          <TodayView onOpenUnit={openUnit} onOpenConcept={openConcept} onOpenLibrary={() => setView({ kind: 'library' })} />
        ) : null}
        {view.kind === 'library' ? (
          <LibraryView
            refreshToken={refreshToken}
            onOpen={mid => setView({ kind: 'material', mid })}
          />
        ) : null}
        {view.kind === 'concepts' ? <ConceptListView onOpenConcept={openConcept} /> : null}
        {view.kind === 'plans' ? <PlanListView onOpen={pid => setView({ kind: 'plan', pid })} /> : null}
        {view.kind === 'plan' ? (
          <PlanDetailView
            pid={view.pid}
            onBack={() => setView({ kind: 'plans' })}
            onOpenUnit={openUnit}
            onOpenConcept={openConcept}
          />
        ) : null}
        {view.kind === 'concept' ? (
          <ConceptDetailView
            cid={view.cid}
            onBack={() => setView({ kind: 'concepts' })}
            onOpenUnit={openUnit}
            onOpenConcept={openConcept}
          />
        ) : null}
        {view.kind === 'material' ? (
          <MaterialView
            mid={view.mid}
            {...(view.uid === undefined ? {} : { initialUid: view.uid })}
            onBack={() => setView({ kind: 'library' })}
            onOpenConcept={openConcept}
          />
        ) : null}

        {dialog === 'import' ? (
          <ImportDialog
            onClose={() => setDialog(null)}
            onImported={message => {
              setRefreshToken(value => value + 1)
              setToast({ message, tone: 'ok' })
            }}
          />
        ) : null}
        {dialog === 'goal' ? (
          <GoalDialog
            onClose={() => setDialog(null)}
            onCreated={message => setToast({ message, tone: 'ok' })}
          />
        ) : null}
        {toast === null ? null : <Toast message={toast.message} tone={toast.tone} />}
      </div>
    </div>
  )
}

/** Slot registry face the shell serves. */
interface SlotsFace {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** The slice of the client context this plugin uses. */
export interface ClientContext {
  slots: SlotsFace
  effect(fn: () => (() => void) | void, label?: string): void
  get(name: string): unknown
}

/** Required client services. */
export const inject = ['slots']

/**
 * Client activation.
 * @param ctx - client root context (slots).
 */
export function apply(ctx: ClientContext): void {
  ensureStudyStyles()
  ctx.effect(() => installTheme(), 'study-desk: theme')

  // Shell faces used by the dialogs: which conversation the main view shows,
  // and how to switch the center column back to it.
  try {
    const sessions = ctx.get('sessions') as
      | { list?: { getSnapshot(): { byId: Record<string, { id: string; retainedBy?: Record<string, number> }> } } }
      | undefined
    const layout = ctx.get('layout') as { selectPanel?: (id: string | null) => void } | undefined
    installActions({
      session: () => {
        const byId = sessions?.list?.getSnapshot().byId ?? {}
        for (const row of Object.values(byId)) {
          if ((row.retainedBy?.mainView ?? 0) > 0) return row.id
        }
        return undefined
      },
      conversation: () => layout?.selectPanel?.(null),
    })
  } catch {
    // A shell without these services only loses the "open conversation" shortcut.
  }
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: STUDY_PANEL_ID,
              order: PANEL_ORDER,
              label: () => '书桌',
            },
            StudyPanelIcon,
          ),
        ),
      )
      disposers.push(
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: STUDY_PANEL_ID, inject: () => ({}) }, StudyPanel),
        ),
      )
    } catch (error) {
      // A shell that cannot serve the seats degrades this plugin, never the GUI.
      console.error('[dsh-study] panel registration failed:', error)
    }
    return () => {
      for (const dispose of disposers.splice(0)) dispose()
    }
  }, 'study-desk: surfaces')
}
