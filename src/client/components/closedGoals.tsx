/**
 * 阅读页底部的结案记录。
 *
 * A closed goal leaves Today, but closing is a human judgement and has to stay
 * reversible. The archive is deliberately quiet and collapsed: a record, not a
 * dashboard. It reads the existing plan list and details, so it adds no store.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { PlanDetailView, PlanSummary } from '../../core/views.ts'
import { api, errorText } from '../api.ts'

/** A truncated one-liner for the archive row. */
function archiveNote(text: string | undefined): string {
  if (text === undefined) return ''
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= 48 ? clean : clean.slice(0, 48) + '…'
}

/**
 * Closed goals, folded away at the bottom of the reading page.
 *
 * A closed goal leaves Today, but it must stay reachable: closing is a human
 * judgement and has to be reversible. The archive is deliberately quiet and
 * collapsed — a record, not a dashboard.
 */
export function ClosedGoals({
  onOpenPlan,
  refreshToken,
}: {
  onOpenPlan: (pid: string) => void
  refreshToken: number
}): ReactElement | null {
  const [closed, setClosed] = useState<PlanSummary[] | null>(null)
  const [entries, setEntries] = useState<PlanDetailView[] | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setClosed(null)
    setEntries(null)
    setOpen(false)
    setError(null)
    api<PlanSummary[]>('/plans')
      .then(value => {
        if (alive) setClosed(value.filter(plan => plan.status === 'done'))
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [refreshToken])

  const toggle = async (): Promise<void> => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (closed === null) return
    if (entries !== null) return
    setError(null)
    try {
      const loaded = await Promise.all(
        closed.map(plan => api<PlanDetailView>(`/plan?pid=${encodeURIComponent(plan.id)}`)),
      )
      loaded.sort((left, right) =>
        (right.plan.meta.closedAt ?? '').localeCompare(left.plan.meta.closedAt ?? ''),
      )
      setEntries(loaded)
    } catch (reason) {
      setError(errorText(reason))
      setEntries(null)
      setOpen(false)
    }
  }

  if (closed === null) {
    return error === null ? null : <p className="study-muted study-archive-note">结案记录读不出来：{error}</p>
  }
  if (closed.length === 0) return null

  return (
    <div className="study-closed-archive">
      <button type="button" className="study-link" onClick={() => void toggle()}>
        {open ? `已结案 ${closed.length} 个 · 收起` : `已结案 ${closed.length} 个 · 查看`}
      </button>
      {error === null ? null : <p className="study-muted study-archive-note">结案记录读不出来：{error}</p>}
      {open ? (
        entries === null ? (
          <p className="study-muted study-archive-note">正在读取结案记录…</p>
        ) : (
          <ul className="study-list">
            {entries.map(entry => {
              const meta = entry.plan.meta
              const note = archiveNote(meta.closureNote)
              return (
                <li key={entry.plan.id}>
                  <button type="button" className="study-item" onClick={() => onOpenPlan(entry.plan.id)}>
                    <span className="study-item-title">{entry.plan.goal}</span>
                    <span className="study-item-meta">
                      {meta.deliverable ?? '未写交付物'}
                      {meta.closedAt === undefined ? '' : ` · 结案 ${meta.closedAt.slice(0, 10)}`}
                      {note === '' ? '' : ` · ${note}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )
      ) : null}
    </div>
  )
}

