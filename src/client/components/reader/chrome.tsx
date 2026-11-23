/**
 * Reader chrome: rail, ask panel, goal strip, zoom, selection bar.
 *
 * Split from reader.tsx; these are prop-driven and hold no reader state.
 */
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {ReactElement} from 'react'
import type {BlockRecord, QuickAction} from '../../../core/types.ts'
import type {PlanDetailView} from '../../../core/views.ts'

import {api, errorText, post} from '../../api.ts'

import {MASCOT, type MascotMood} from '../../mascot.ts'

import {InlineMarkdown, Markdown} from '../ui.tsx'
import {UsageNote} from '../usage.tsx'

export function Rail({
  block,
  index,
  onMerge,
  onAsk,
  busy,
}: {
  block: BlockRecord
  index: number
  onMerge: () => void
  onAsk: () => void
  busy: boolean
}): ReactElement {
  const prompt = block.prompt
  return (
    <div className="study-rail-card" key={block.id}>
      {prompt === undefined ? (
        <p className="study-rail-empty">这一块没配问题。</p>
      ) : (
        <>
          <p className="study-rail-transition">
            <InlineMarkdown source={prompt.transition} />
          </p>
          <p className="study-rail-question">
            <InlineMarkdown source={prompt.question} />
          </p>
        </>
      )}
      {/*
        Two actions, nothing else: the page span moved into the head's tooltip,
        because a row of small print under a question made the card look like a
        form. Labels stay short, and the tooltips carry the precise meaning —
        cute is the wording, not the contract.
      */}
      <div className="study-rail-actions">
        <button
          type="button"
          className="study-rail-ask"
          onClick={onAsk}
          disabled={busy}
          title="就这一段问一句（答完即走，不保留）"
        >
          emm，没太懂
        </button>
        {index > 0 ? (
          <button
            type="button"
            className="study-rail-merge"
            onClick={onMerge}
            title="这一块和前面那块本是一体？并进去（分块没分对时用）"
          >
            和前面那块是朋友吧
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- ask panel ------- */

/**
 * The small question window: answer, then leave.
 *
 * Never stored (DESIGN.md AI 的位置 B): closing it loses the exchange, which is what
 * keeps it from becoming a second conversation surface.
 */
export function AskPanel({
  mid,
  uid,
  page,
  seed,
  action,
  onClose,
}: {
  mid: string
  uid: string
  page: number
  /** The passage the reader selected; it travels with the question. */
  seed?: string
  /** A one-shot instruction from the selection bar; runs as soon as it opens. */
  action?: QuickAction
  onClose: () => void
}): ReactElement {
  const [question, setQuestion] = useState(action?.prompt ?? '')
  const [answer, setAnswer] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [usage, setUsage] = useState<{ inputTokens?: number; outputTokens?: number; cost?: number; currency?: string; priceSource?: 'api' | 'user' | 'mixed' | 'none' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /** Take the paragraph away: asking is not the only thing text is for. */
  const copySeed = async (): Promise<void> => {
    if (seed === undefined) return
    try {
      await navigator.clipboard.writeText(seed)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('这段复制不了（浏览器没给剪贴板权限）')
    }
  }

  const send = async (mode: 'manual' | 'auto' = 'manual'): Promise<void> => {
    const text = question.trim()
    if (mode === 'manual' && text.length === 0) return
    if (mode === 'auto' && action === undefined) return
    setBusy(true)
    setError(null)
    setUsage(null)
    setTruncated(false)
    try {
      const value = await post<{
        answer: string
        truncated?: boolean
        usage?: { inputTokens?: number; outputTokens?: number; cost?: number; currency?: string; priceSource?: 'api' | 'user' | 'mixed' | 'none' }
      }>('/ask', {
        mid,
        uid,
        page,
        ...(mode === 'auto' && action !== undefined ? { action: action.prompt } : { question: text }),
        ...(seed === undefined ? {} : { quote: seed }),
      })
      setAnswer(value.answer)
      setTruncated(value.truncated === true)
      setUsage(value.usage ?? null)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  // A quick action is one click: open the window and run the instruction right
  // away. The ref keeps React's double-mount in development from spending twice.
  const autoRan = useRef(false)
  useEffect(() => {
    if (action === undefined || autoRan.current) return
    autoRan.current = true
    void send('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="study-ask" role="dialog" aria-label="问一句">
      <div className="study-ask-head">
        <span title={action?.prompt}>
          {action === undefined ? `p${String(page)} 这一段，说给我听听` : `${action.label} · p${String(page)}`}
        </span>
        {seed === undefined ? null : (
          <button type="button" className="study-ask-copy" onClick={() => void copySeed()}>
            {copied ? '抄好了' : '复制这段'}
          </button>
        )}
        <button type="button" className="study-ask-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      {seed === undefined ? null : <p className="study-ask-seed">{seed}</p>}
      <textarea
        className="study-ask-input"
        value={question}
        autoFocus
        placeholder="哪儿绕住了？一句话就行"
        rows={3}
        onChange={event => setQuestion(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send()
        }}
      />
      <div className="study-ask-actions">
        <span className="study-ask-hint">说完就走，不留记录</span>
        <button type="button" className="study-primary study-primary-tight" onClick={() => void send()} disabled={busy}>
          {busy ? '唔…我想想' : '问问看'}
        </button>
      </div>
      {error === null ? null : <p className="study-form-error">{error}</p>}
      {answer === null ? null : (
        <>
          <Markdown source={answer} className="study-ask-answer" />
          {truncated ? (
            <p className="study-ask-cut">回答到输出上限了，可能没写完。再问一次，或把问题问窄一点。</p>
          ) : null}
          <UsageNote usage={usage} />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- goal strip --- */

/** The goal this range belongs to, shown above the reading surface. */
export function GoalStrip({
  planId,
  mid,
  uid,
  onBack,
}: {
  planId: string
  mid: string
  uid: string
  onBack: () => void
}): ReactElement | null {
  const [plan, setPlan] = useState<PlanDetailView | null>(null)

  useEffect(() => {
    let alive = true
    api<PlanDetailView>(`/plan?pid=${encodeURIComponent(planId)}`)
      .then(value => {
        if (alive) setPlan(value)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [planId])

  if (plan === null) return null
  const key = `${mid}:${uid}`
  const step = plan.steps.find(item => item.target !== undefined && `${item.target.materialId}:${item.target.unitId}` === key)
  return (
    <div className="study-goal-strip">
      <span className="study-goal-strip-label">目标</span>
      <span className="study-goal-strip-goal">
        <InlineMarkdown source={plan.plan.goal} />
      </span>
      <span className="study-item-meta">
        知识点 {plan.goalProgress.passed}/{plan.goalProgress.total} · {plan.done}/{plan.total} 步
      </span>
      {step === undefined ? null : (
        <span className="study-item-meta">
          这一步：<InlineMarkdown source={step.why} />
          {step.coverage === 'skim' ? '（略读）' : ''}
        </span>
      )}
      <span className="study-today-spacer" />
      <button type="button" className="study-link" onClick={onBack}>
        ← 回到目标
      </button>
    </div>
  )
}

/* ------------------------------------------------------------- the reader --- */

/** Tints so consecutive blocks are told apart at a glance. */
export const BLOCK_TINTS = ['#3f5c6b', '#4e6449', '#7a6140', '#5f5570', '#416a68', '#7a4a44', '#5a6240']

/** The reader remembers whether the paragraph tint is shown. */
export const TINT_PREF = 'dsh-study:hide-tint'

export function tintVisible(): boolean {
  try {
    return window.localStorage.getItem(TINT_PREF) !== '1'
  } catch {
    return true
  }
}

/** Stable tint for one block id. */
export function tintOf(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) % 100000
  return BLOCK_TINTS[hash % BLOCK_TINTS.length]!
}

/**
 * The desk's mascot: the reference art, six moods.
 *
 * Cropped out of the circular avatars in `figure/` by scripts/build-mascot.mjs
 * and inlined as data URLs, so the plugin still ships no asset files. Which face
 * is showing is decided by `mood` at the call site — cute when idle, puzzled
 * while thinking, happy when it has a question, ack while a job runs, bored when
 * there is nothing to ask yet, worried when something failed.
 */
export function Mascot({ mood, thinking }: { mood: MascotMood; thinking?: boolean }): ReactElement {
  return (
    <img
      className={thinking === true ? 'study-mascot is-think' : 'study-mascot'}
      src={MASCOT[mood]}
      alt=""
      draggable={false}
    />
  )
}

/** Three dots while the mascot thinks. */
export function Thinking(): ReactElement {
  return (
    <span className="study-think" aria-label="正在想">
      <i />
      <i />
      <i />
    </span>
  )
}

/* --------------------------------------------------------------- zoom ----- */

/**
 * Zoom ladder for the page column. 1 is "fit the column", which is the default;
 * the rest are fixed stops so the percentage readout stays a round number and
 * stepping up and down lands on the same values.
 */
export const ZOOM_STEPS: readonly number[] = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3]
export const ZOOM_MIN = ZOOM_STEPS[0] ?? 1
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 1

/**
 * Page zoom for the toolbar.
 *
 * The readout is a button too: clicking it snaps back to fit-width, which is the
 * gesture people already know from every PDF viewer. The separate fit-width button
 * keeps the action visible even while the page is at 100%.
 */
export function ZoomBar({
  zoom,
  tone,
  onOut,
  onIn,
  onFit,
}: {
  zoom: number
  /** `float` sits in the fullscreen bar; `head` in the normal reader header. */
  tone: 'float' | 'head'
  onOut: () => void
  onIn: () => void
  onFit: () => void
}): ReactElement {
  const base = tone === 'float' ? 'study-floatbar-btn' : 'study-ghost'
  const percent = `${String(Math.round(zoom * 100))}%`
  return (
    <div className="study-zoom" role="group" aria-label="页面缩放">
      <button
        type="button"
        className={`${base} study-zoom-step`}
        onClick={onOut}
        disabled={zoom <= ZOOM_MIN}
        title="缩小一档（Ctrl/⌘ -）"
        aria-label="缩小"
      >
        −
      </button>
      <button
        type="button"
        className={`${base} study-zoom-value`}
        onClick={onFit}
        title="回到适应屏宽（Ctrl/⌘ 0）"
        aria-label={`当前 ${percent}，点一下适应屏宽`}
      >
        {percent}
      </button>
      <button
        type="button"
        className={`${base} study-zoom-step`}
        onClick={onIn}
        disabled={zoom >= ZOOM_MAX}
        title="放大一档（Ctrl/⌘ +）"
        aria-label="放大"
      >
        +
      </button>
      <button
        type="button"
        className={`${base} study-zoom-fit`}
        onClick={onFit}
        aria-pressed={zoom === 1}
        title="适应屏宽（Ctrl/⌘ 0）"
      >
        适应屏宽
      </button>
    </div>
  )
}

/**
 * The bar that floats over a selection.
 *
 * It measures itself and then sits on whole pixels: a `translate(-50%)` layer
 * (or a backdrop filter) is composited separately and loses subpixel text
 * antialiasing, which is what made the labels look soft. No transform, opaque
 * background, integer coordinates.
 */
export function SelectionBar({
  selection,
  actions,
  onAsk,
  onAction,
}: {
  selection: { text: string; x: number; y: number; below: boolean; page: number | null }
  actions: readonly QuickAction[]
  onAsk: () => void
  onAction: (action: QuickAction) => void
}): ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (box === null) return
    const width = box.offsetWidth
    const height = box.offsetHeight
    const centered = Math.round(selection.x - width / 2)
    const top = Math.round(selection.below ? selection.y : selection.y - height)
    setAt({
      left: Math.max(8, Math.min(window.innerWidth - width - 8, centered)),
      top: Math.max(8, Math.min(window.innerHeight - height - 8, top)),
    })
  }, [selection, actions])

  return (
    <div
      ref={boxRef}
      className="study-select-bar"
      style={{
        left: `${String(at?.left ?? selection.x)}px`,
        top: `${String(at?.top ?? selection.y)}px`,
        visibility: at === null ? 'hidden' : 'visible',
      }}
    >
      {actions.map((action, index) => (
        <button
          key={`${String(index)}:${action.label}`}
          type="button"
          className="study-select-action"
          title={action.prompt}
          onMouseDown={event => event.preventDefault()}
          onClick={() => onAction(action)}
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        className="study-select-ask"
        onMouseDown={event => event.preventDefault()}
        onClick={onAsk}
      >
        问一问
      </button>
    </div>
  )
}

/** The reader for one unit. */