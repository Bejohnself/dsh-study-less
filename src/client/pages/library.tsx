/**
 * 书架: the knowledge base.
 *
 * The shelf is a checklist, not a file browser: every card shows how much is
 * learned, verified and due, and clicking it opens the shared reader.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { BookSummary, MaterialCard, MaterialStateView, TocRow } from '../../core/views.ts'
import { api, errorText, post } from '../api.ts'
import { isDone, typeLabel } from '../labels.ts'
import { BookCover } from '../components/cover.tsx'
import { UnitReader } from '../components/reader.tsx'
import { EmptyState, Toast } from '../components/ui.tsx'

/** The library shelf. */
export function LibraryPage({
  onOpen,
  onImport,
  onOpenBook,
  refreshToken,
}: {
  onOpen: (id: string) => void
  onImport: () => void
  onOpenBook: (bid: string) => void
  refreshToken: number
}): ReactElement {
  const [cards, setCards] = useState<MaterialCard[] | null>(null)
  const [books, setBooks] = useState<BookSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'new' | 'learning' | 'done'>('all')
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    let alive = true
    setCards(null)
    setError(null)
    api<MaterialCard[]>(`/library${showArchived ? '?archived=1' : ''}`)
      .then(value => {
        if (alive) setCards(value)
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [refreshToken, showArchived])

  useEffect(() => {
    let alive = true
    api<BookSummary[]>('/books')
      .then(value => {
        if (alive) setBooks(value)
      })
      .catch(() => {
        if (alive) setBooks([])
      })
    return () => {
      alive = false
    }
  }, [refreshToken])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (cards ?? []).filter(card => {
      if (filter !== 'all' && card.status !== filter) return false
      if (term.length === 0) return true
      return `${card.title} ${card.authors.join(' ')} ${card.tags.join(' ')}`.toLowerCase().includes(term)
    })
  }, [cards, filter, query])

  if (error !== null) return <div className="study-empty">无法读取清单：{error}</div>
  if (cards === null) return <div className="study-empty">正在读取清单…</div>
  if (cards.length === 0) {
    return (
      <EmptyState
        title="书架还是空的。"
        hint="丢一本 PDF 或 arXiv 链接进来，我把它拆成能读的几节——目录会自己抽好。"
        action={{ label: '放一本书进来', onClick: onImport }}
      />
    )
  }

  return (
    <div className="study-library">
      <div className="study-library-tools">
        <input
          type="search"
          className="study-input"
          placeholder="搜索标题 / 作者 / 标签"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <select className="study-input study-select" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
          <option value="all">全部状态</option>
          <option value="new">未开始</option>
          <option value="learning">在学</option>
          <option value="done">已学完</option>
        </select>
        <label className="study-inline-check">
          <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
          显示归档
        </label>
        <button type="button" className="study-ghost" onClick={onImport}>
          ＋ 导入
        </button>
      </div>

      {books.length === 0 ? null : (
        <section className="study-book-shelf">
          <h3>自编书</h3>
          <div className="study-book-shelf-grid">
            {books.map(book => (
              <button key={book.id} type="button" className="study-book-mini" onClick={() => onOpenBook(book.id)}>
                <span className="study-book-mini-cover" aria-hidden="true">
                  {book.title.slice(0, 2)}
                </span>
                <span className="study-book-mini-main">
                  <span className="study-insight-kind">自编书</span>
                  <span className="study-book-title">{book.title}</span>
                  <span className="study-item-meta">
                    {book.done}/{book.chapters} 章已生成 · {book.status === 'ready' ? '可读' : '编排中'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 ? (
        <div className="study-empty">没有符合筛选的资料。</div>
      ) : (
        <div className="study-shelf">
          {filtered.map(card => {
            const percent = card.units === 0 ? 0 : Math.round((card.learnedUnits / card.units) * 100)
            return (
              <button key={card.id} type="button" className="study-cover-card" onClick={() => onOpen(card.id)}>
                <BookCover mid={card.id} title={card.title} type={card.type} />
                <span className="study-cover-badges">
                  <span className="study-cover-badges-left">
                    <span className={`study-badge study-badge-${card.type}`}>{typeLabel(card.type)}</span>
                    {card.archived === true ? <span className="study-badge study-badge-archive">已归档</span> : null}
                  </span>
                  {card.dueCount > 0 ? <span className="study-due-badge">{card.dueCount} 待复习</span> : null}
                </span>
                <span className="study-cover-foot">
                  <span className="study-cover-title">{card.title}</span>
                  <span className="study-cover-meta">
                    {[card.authors.slice(0, 2).join(' · '), card.year, `${card.pages} 页`, `${card.units} 单元`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="study-cover-progress">
                    <span className="study-progress-bar">
                      <span style={{ width: `${percent}%` }} />
                    </span>
                    <span className="study-cover-progress-text">
                      {card.learnedUnits}/{card.units} 已学{card.verifiedUnits > 0 ? ` · ${card.verifiedUnits} 节已校验` : ''}
                    </span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
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
                {row.status === 'verified' ? ' · 已校验' : row.status === 'drafted' ? ' · 有导读' : ''}
                {row.due !== undefined ? ` · ${row.due} 到期` : ''}
              </span>
            </button>
          </div>
        )
      })}
    </nav>
  )
}

/** Material detail: TOC + shared reader. */
export function MaterialPage({
  mid,
  initialUid,
  planId,
  onBack,
  onOpenConcept,
  onOpenInsight,
  onOpenPlan,
  onChanged,
  refreshToken,
}: {
  mid: string
  initialUid?: string
  planId?: string
  onBack: () => void
  onOpenConcept: (cid: string) => void
  onOpenInsight: (iid: string) => void
  /** Jump to the goal this range belongs to. */
  onOpenPlan?: (pid: string) => void
  onChanged?: () => void
  refreshToken?: number
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
  }, [reload, refreshToken])

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
          await post('/unit/complete', { mid, uid: row.uid, rating: 3 })
          setToast({ message: '已记下首次学习，明天进入复习。', tone: 'ok' })
        } else {
          await post('/unit/uncomplete', { mid, uid: row.uid })
          setToast({ message: '已取消勾选。', tone: 'ok' })
        }
        await reload()
        onChanged?.()
      } catch (reason) {
        setToast({ message: errorText(reason), tone: 'error' })
      } finally {
        setBusy(null)
      }
    },
    [mid, onChanged, reload, state],
  )

  const removeMaterial = async (): Promise<void> => {
    if (state === null) return
    if (!window.confirm('删除这份资料及它的导读、练习、进度？此操作不可恢复。')) return
    try {
      await post('/material/delete', { mid })
      onChanged?.()
      onBack()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  const archive = async (): Promise<void> => {
    if (state === null) return
    const archived = state.material.archived !== true
    if (!window.confirm(archived ? '归档后从清单隐藏，已学进度和路径仍保留。继续？' : '恢复这本资料到清单？')) return
    try {
      await post('/material/archive', { mid, archived })
      setToast({ message: archived ? '已归档。' : '已恢复。', tone: 'ok' })
      await reload()
      onChanged?.()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  if (error !== null) return <div className="study-empty">无法读取这本资料：{error}</div>
  if (state === null) return <div className="study-empty">正在载入目录…</div>

  const next = state.next === undefined ? null : (state.toc.find(row => row.uid === state.next) ?? null)

  return (
    <div className="study-material">
      <div className="study-material-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 清单
        </button>
        <div className="study-reader-title">
          <h2>
            {state.material.title}
            {state.material.archived === true ? <span className="study-badge study-badge-archive">已归档</span> : null}
          </h2>
          <span className="study-reader-sub">
            {typeLabel(state.material.type)} · {state.material.units} 单元 · {state.material.learnedUnits} 已学
            {state.material.dueCount > 0 ? ` · ${state.material.dueCount} 待复习` : ''}
          </span>
        </div>
        <div className="study-inline">
          {next !== null ? (
            <button type="button" className="study-next" onClick={() => setCurrent(next.uid)}>
              下一步：{next.title}
            </button>
          ) : null}
          <button type="button" className="study-ghost" onClick={() => void archive()}>
            {state.material.archived === true ? '恢复' : '归档'}
          </button>
          <button type="button" className="study-ghost study-danger-text" onClick={() => void removeMaterial()}>
            删除
          </button>
        </div>
      </div>

      {current === null ? (
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
            <div className="study-empty">从左侧目录选一节开始。</div>
          </div>
        </div>
      ) : (
        // The reader owns the full width: its own header carries the section,
        // the page range and the actions, and the table of contents becomes a
        // drawer. Nesting it in the 296px column is what squeezed the PDF.
        <UnitReader
          mid={mid}
          uid={current}
          toc={state.toc}
          onSelectUnit={setCurrent}
          {...(planId === undefined ? {} : { planId })}
          onBack={() => {
            // Opening from a goal: back leaves the range and returns to the
            // goal panel, not to an empty reader.
            if (planId !== undefined) onBack()
            else setCurrent(null)
          }}
          onOpenConcept={onOpenConcept}
          onOpenInsight={onOpenInsight}
          {...(onOpenPlan === undefined ? {} : { onOpenPlan })}
          onChanged={onChanged}
        />
      )}

      {toast !== null ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  )
}
