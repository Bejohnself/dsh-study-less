/**
 * Shared visual primitives for the three study surfaces.
 *
 * The shell owns the sidebar and theme; these components only use the plugin's
 * own prefixed classes so a host upgrade cannot blank the page.
 */
import { useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { JobView } from '../../core/views.ts'
import { jobStatusLabel } from '../labels.ts'
import { renderInlineMarkdown, renderMarkdown } from '../markdown.ts'
import { UsageNote } from './usage.tsx'
import { getPreference, setPreference, subscribePreference, type ThemePreference } from '../theme.ts'

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

/** The three looks, in the order the header button cycles through them. */
export const THEME_STEPS: Array<{ id: ThemePreference; label: string; hint: string }> = [
  { id: 'light', label: '纸', hint: '纸：白底墨字' },
  { id: 'dark', label: '墨', hint: '墨：黑底纸字' },
  { id: 'auto', label: '跟随外壳', hint: '跟随外壳' },
]

/** The current look, as a one-line label (used by the button and the dialog). */
export function themeLabel(preference: ThemePreference): string {
  return THEME_STEPS.find(step => step.id === preference)?.hint ?? '跟随外壳'
}

/** A small glyph per look: sun, moon, half-lit circle. */
function ThemeGlyph({ preference }: { preference: ThemePreference }): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
      {preference === 'light' ? (
        <>
          <circle cx="8" cy="8" r="3.1" />
          <path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" />
        </>
      ) : preference === 'dark' ? (
        <path d="M12.9 9.9A5.2 5.2 0 0 1 6.1 3.1a5.3 5.3 0 1 0 6.8 6.8Z" />
      ) : (
        <>
          <circle cx="8" cy="8" r="5.4" />
          <path d="M8 2.6v10.8a5.4 5.4 0 0 0 0-10.8Z" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  )
}

/** Header button: one click steps 纸 → 墨 → 跟随外壳. */
export function ThemeToggle(): ReactElement {
  const [preference, setLocal] = useState<ThemePreference>(getPreference())
  useEffect(() => subscribePreference(setLocal), [])

  const index = THEME_STEPS.findIndex(step => step.id === preference)
  const next = THEME_STEPS[(index + 1) % THEME_STEPS.length]!

  return (
    <button
      type="button"
      className="study-theme-toggle"
      aria-label={`外观：${themeLabel(preference)}，点击切换到${next.label}`}
      title={`外观：${themeLabel(preference)}　点击换成「${next.label}」`}
      onClick={() => setPreference(next.id)}
    >
      <ThemeGlyph preference={preference} />
    </button>
  )
}

/** The top-level sections; the experimental 笔记 entry can be hidden in settings. */
export function TopNav({
  active,
  onSelect,
  showInsights = true,
}: {
  active: TopTab
  onSelect: (tab: TopTab) => void
  showInsights?: boolean
}): ReactElement {
  const items: Array<{ id: TopTab; label: string }> = [
    { id: 'library', label: '书架' },
    { id: 'learn', label: '阅读' },
    ...(showInsights ? [{ id: 'insights' as TopTab, label: '笔记（实验）' }] : []),
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
/** How long the model has been working, ticking while the job runs. */
export function JobElapsed({ job }: { job: JobView }): ReactElement | null {
  const running = job.status === 'running' || job.status === 'queued'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  const started = Date.parse(job.startedAt ?? job.createdAt)
  if (!Number.isFinite(started)) return null
  const ended = job.endedAt === undefined ? now : Date.parse(job.endedAt)
  const seconds = Math.max(0, Math.round((ended - started) / 1000))
  if (seconds < 1) return null
  return <span className="study-muted">{running ? `已 ${seconds} 秒` : `用了 ${seconds} 秒`}</span>
}

export function JobBanner({ job, onCancel }: { job: JobView; onCancel?: () => void }): ReactElement {
  const tone = job.status === 'failed' ? 'error' : job.status === 'done' ? 'ok' : 'busy'
  return (
    <div className={`study-job study-job-${tone}`}>
      <div className="study-job-head">
        <span className="study-job-status">{jobStatusLabel(job.status)}</span>
        {job.message === undefined ? null : <span className="study-muted">{job.message}</span>}
        <JobElapsed job={job} />
        {job.status === 'running' || job.status === 'queued' ? (
          onCancel === undefined ? null : (
            <button type="button" className="study-link" onClick={onCancel}>
              取消
            </button>
          )
        ) : null}
      </div>
      <ProgressBar percent={job.progress * 100} />
      {job.usage === undefined ? null : <UsageNote usage={job.usage} />}
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


/** Render one short Markdown fragment inline (quiz choices, labels). */
export function InlineMarkdown({ source }: { source: string }): ReactElement {
  return <span dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(source) }} />
}
