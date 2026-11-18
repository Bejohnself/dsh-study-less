/**
 * Browser half of the dsh-study-less bundle.
 *
 * Contributes the sidebar row and the center-column page. All state comes from
 * the Host through /study-api; this half never writes files.
 */
import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { StudyApp } from './app.tsx'
import { installActions } from './actions.ts'
import { ensureStudyStyles } from './styles.ts'
import { installTheme } from './theme.ts'

/** The panel id shared by the sidebar row and the main-slot occupant. */
export const STUDY_PANEL_ID = 'study-desk'

/**
 * A render error must degrade this panel, never blank the shell.
 *
 * The boundary shows the message instead of a white page, so a bug in one view
 * can be reported and the rest of the GUI keeps working.
 */
class PanelBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[dsh-study-less] panel crashed:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div data-dsh-study="" className="study-page">
          <div className="study-empty">
            <p>书桌这一页出错了。</p>
            <p className="study-hint">{this.state.error.message}</p>
            <button type="button" className="study-primary" onClick={() => this.setState({ error: null })}>
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/** The registered main-slot component: the panel plus its error boundary. */
function StudyPanel(): ReactElement {
  return (
    <PanelBoundary>
      <StudyApp />
    </PanelBoundary>
  )
}

/** Row order among the shell's global panel rows (Plugins is 0, Schedule 10). */
const PANEL_ORDER = 30

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
      console.error('[dsh-study-less] panel registration failed:', error)
    }
    return () => {
      for (const dispose of disposers.splice(0)) dispose()
    }
  }, 'study-desk: surfaces')
}
