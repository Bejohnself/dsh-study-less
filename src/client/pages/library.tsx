/**
 * 书架: the knowledge base.
 *
 * The shelf is a checklist, not a file browser: every card shows how much is
 * learned, verified and due, and clicking it opens the shared reader.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { MaterialCard, MaterialStateView, TocRow } from '../../core/views.ts'
import { api, errorText, post } from '../api.ts'
import { firstLeafUid, firstLeafUnder, typeLabel } from '../labels.ts'
import { BookCover } from '../components/cover.tsx'
import { UnitReader } from '../components/reader.tsx'
import { EmptyState, Toast } from '../components/ui.tsx'

/** The library shelf. */
export function LibraryPage({
  onOpen,
  onImport,
  onChanged,
  refreshToken,
}: {
  onOpen: (id: string) => void
  onImport: () => void
  onChanged?: () => void
  refreshToken: number
}): ReactElement {
  const [cards, setCards] = useState<MaterialCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'new' | 'learning' | 'done'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)

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
  }, [refreshToken, showArchived, reloadToken])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const archive = async (card: MaterialCard): Promise<void> => {
    const archived = card.archived !== true
    if (!window.confirm(archived ? '归档后从书架隐藏，已学进度和路径仍保留。继续？' : '恢复这本资料到书架？')) return
    try {
      await post('/material/archive', { mid: card.id, archived })
      setMenu(null)
      setToast({ message: archived ? '已归档。' : '已恢复。', tone: 'ok' })
      setReloadToken(value => value + 1)
      onChanged?.()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  const removeMaterial = async (card: MaterialCard): Promise<void> => {
    if (!window.confirm('删除这份资料及它的练习、进度？此操作不可恢复。')) return
    try {
      await post('/material/delete', { mid: card.id })
      setMenu(null)
      setToast({ message: '资料已删除。', tone: 'ok' })
      setReloadToken(value => value + 1)
      onChanged?.()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

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
        hint="丢一本 PDF 或 arXiv 链接进来，我按它的书签目录拆成能读的几节。"
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
      {filtered.length === 0 ? (
        <div className="study-empty">没有符合筛选的资料。</div>
      ) : (
        <div className="study-shelf">
          {filtered.map(card => {
            const percent = card.units === 0 ? 0 : Math.round((card.learnedUnits / card.units) * 100)
            return (
              <div key={card.id} className="study-cover-slot">
                <button type="button" className="study-cover-card" onClick={() => onOpen(card.id)}>
                  <BookCover mid={card.id} title={card.title} />
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
                <div className="study-cover-menu-wrap">
                  <button
                    type="button"
                    className="study-cover-menu-btn"
                    aria-label="资料操作"
                    onClick={() => setMenu(menu === card.id ? null : card.id)}
                  >
                    ⋯
                  </button>
                  {menu === card.id ? (
                    <div className="study-menu" onMouseLeave={() => setMenu(null)}>
                      <button type="button" onClick={() => void archive(card)}>
                        {card.archived === true ? '恢复' : '归档'}
                      </button>
                      <button type="button" className="study-danger-text" onClick={() => void removeMaterial(card)}>
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {toast !== null ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  )
}

/** Material detail: the shared reader, nothing else. */
export function MaterialPage({
  mid,
  initialUid,
  planId,
  onBack,
  onOpenQuiz,
  onChanged,
  refreshToken,
}: {
  mid: string
  initialUid?: string
  planId?: string
  onBack: () => void
  /** Leave the reader for the unit's practice page. */
  onOpenQuiz?: (mid: string, unit: TocRow, planId?: string) => void
  onChanged?: () => void
  refreshToken?: number
}): ReactElement {
  const [state, setState] = useState<MaterialStateView | null>(null)
  const [current, setCurrent] = useState<string | null>(initialUid ?? null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const value = await api<MaterialStateView>(`/material?mid=${encodeURIComponent(mid)}`)
    setState(value)
    setCurrent(previous => {
      // A parent row is an index entry, so land on the first section under it.
      const start = previous === null ? -1 : value.toc.findIndex(row => row.uid === previous)
      if (start >= 0) return firstLeafUnder(value.toc, start).uid
      return value.next ?? firstLeafUid(value.toc) ?? null
    })
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

  if (error !== null) return <div className="study-empty">无法读取这本资料：{error}</div>
  if (state === null) return <div className="study-empty">正在载入目录…</div>

  if (current === null) {
    return (
      <div className="study-material">
        <button type="button" className="study-back" onClick={onBack}>
          ← 返回
        </button>
        <div className="study-empty">这份资料还没有可读的节。</div>
      </div>
    )
  }

  return (
    <div className="study-material">
      <UnitReader
        mid={mid}
        uid={current}
        toc={state.toc}
        onSelectUnit={setCurrent}
        {...(planId === undefined ? {} : { planId })}
        onBack={onBack}
        {...(onOpenQuiz === undefined ? {} : { onOpenQuiz: unit => onOpenQuiz(mid, unit, planId) })}
        onChanged={onChanged}
      />
    </div>
  )
}
