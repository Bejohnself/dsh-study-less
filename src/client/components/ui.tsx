/**
 * Shared visual primitives for the three study surfaces.
 *
 * The shell owns the sidebar and theme; these components only use the plugin's
 * own prefixed classes so a host upgrade cannot blank the page.
 */
import { useEffect } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { JobView } from '../../core/views.ts'
import { jobStatusLabel } from '../labels.ts'
import { renderMarkdown } from '../markdown.ts'

/** A small toast that disappears on its own. */
export function Toast({ message, tone }: { message: string; tone: 'ok' | 'error' }): ReactElement {
  return <div className={`study-toast study-toast-${tone}`}>{message}</div>
}

/** A modal surface with scrim click and Escape handling. */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}): ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="study-scrim" role="presentation" onClick={onClose}>
      <div
        className={`study-modal${wide === true ? ' study-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={event => event.stopPropagation()}
      >
        <div className="study-modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle === undefined ? null : <p className="study-modal-sub">{subtitle}</p>}
          </div>
          <button type="button" className="study-modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export type TopTab = 'library' | 'learn' | 'insights'

/** The three top-level sections. */
export function TopNav({ active, onSelect }: { active: TopTab; onSelect: (tab: TopTab) => void }): ReactElement {
  const items: Array<{ id: TopTab; label: string }> = [
    { id: 'library', label: '变强清单' },
    { id: 'learn', label: '学习之路' },
    { id: 'insights', label: '大道至简' },
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

/** A secondary row of tabs inside one section. */
export function SubNav<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: Array<{ id: T; label: string; count?: number }>
  active: T
  onSelect: (id: T) => void
}): ReactElement {
  return (
    <div className="study-subnav" role="tablist">
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
          {item.count === undefined ? null : <span className="study-subnav-count">{item.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** A progress bar with an accessible label. */
export function ProgressBar({ percent, label }: { percent: number; label?: string }): ReactElement {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <span className="study-progress" aria-label={label ?? `进度 ${value}%`}>
      <span className="study-progress-bar">
        <span style={{ width: `${value}%` }} />
      </span>
    </span>
  )
}

/** Job status banner with a cancel action while running. */
export function JobBanner({ job, onCancel }: { job: JobView; onCancel?: () => void }): ReactElement {
  const tone = job.status === 'failed' ? 'error' : job.status === 'done' ? 'ok' : 'busy'
  return (
    <div className={`study-job study-job-${tone}`}>
      <div className="study-job-head">
        <span className="study-job-status">{jobStatusLabel(job.status)}</span>
        {job.message === undefined ? null : <span className="study-muted">{job.message}</span>}
        {job.status === 'running' || job.status === 'queued' ? (
          onCancel === undefined ? null : (
            <button type="button" className="study-link" onClick={onCancel}>
              取消
            </button>
          )
        ) : null}
      </div>
      <ProgressBar percent={job.progress * 100} />
      {job.error === undefined ? null : <p className="study-form-error">{job.error}</p>}
      {job.issues === undefined || job.issues.length === 0 ? null : (
        <ul className="study-job-issues">
          {job.issues.slice(0, 6).map(issue => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Render one Markdown block with KaTeX math. */
export function Markdown({ source, className }: { source: string; className?: string }): ReactElement {
  return <article className={className ?? 'study-notes'} dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />
}

/** A row of concept chips. */
export function Chips({
  items,
  onSelect,
}: {
  items: Array<{ id: string; label: string; hint?: string }>
  onSelect?: (id: string) => void
}): ReactElement {
  return (
    <div className="study-chips">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className="study-chip"
          onClick={() => onSelect?.(item.id)}
          disabled={onSelect === undefined}
        >
          {item.label}
          {item.hint === undefined ? null : <span className="study-chip-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}

/** Empty state with an optional action. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: { label: string; onClick: () => void }
}): ReactElement {
  return (
    <div className="study-empty">
      <p>{title}</p>
      {hint === undefined ? null : <p className="study-hint">{hint}</p>}
      {action === undefined ? null : (
        <button type="button" className="study-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}

/** Inline error line. */
export function ErrorNote({ message }: { message: string }): ReactElement {
  return <p className="study-form-error">{message}</p>
}
