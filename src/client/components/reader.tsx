/**
 * The reading surface.
 *
 * One screen, two columns: the original PDF on the left, the guiding rail on the
 * right. There are no tabs — the rail follows the pages and asks one question per
 * semantic block, and it never explains.
 *
 * Nothing on this screen is a progress record: no page counter, no "read" mark,
 * no time spent. That is a rule, not an omission (docs/POSITIONING.md §3 阅读面,
 * §8.10). The closure gate is the only place that judges anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import type { BlockRecord, ParagraphRecord } from '../../core/types.ts'
import type { JobView, PlanDetailView, TocRow, UnitView } from '../../core/views.ts'
import { blockAtPage, blockForParagraph } from '../../core/blocks.ts'
import { paragraphAt } from '../../core/layout.ts'
import { api, errorText, post, waitForJob } from '../api.ts'
import { loadPdfjs, openPdfDocument, pageRatios, ratioOf, type PdfRenderTask } from '../pdf.ts'
import { MASCOT, type MascotMood } from '../mascot.ts'
import { promptKindLabel } from '../labels.ts'
import { EmptyState, JobBanner, Markdown, Toast } from './ui.tsx'

/* ------------------------------------------------------------- one page ----- */

/**
 * One page of the original file.
 *
 * Two rules keep scrolling smooth:
 *  1. the visible canvas is never cleared — a new bitmap is drawn off-screen
 *     and blitted in one step, so resizing or scrolling never blanks a page;
 *  2. the container width only re-renders on a real layout change (≥24px), so a
 *     scrollbar appearing cannot feed a resize back into the render loop.
 */
function PdfPage({
  mid,
  page,
  width,
  marks,
  tint,
  onPick,
  onMount,
}: {
  mid: string
  page: number
  width: number
  /**
   * Every paragraph on this page. `active` marks the ones inside the current
   * block: those keep their tint, the rest only show a hint on hover — any
   * paragraph can be asked about, but the page stays quiet while reading.
   */
  marks: ReadonlyArray<{ index: number; x: number; y: number; w: number; h: number; text: string; active: boolean }>
  /** Block tint, so the highlight changes colour with the block. */
  tint: string
  onPick: (paragraph: { index: number; text: string }) => void
  onMount: (page: number, element: HTMLDivElement | null) => void
}): ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [ratio, setRatio] = useState(() => ratioOf(mid, page))
  const [visible, setVisible] = useState(false)
  const [painted, setPainted] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    onMount(page, boxRef.current)
    return () => {
      onMount(page, null)
    }
  }, [page, onMount])

  // Measure the page once; a paper's pages rarely differ, but a mixed PDF can.
  useEffect(() => {
    const key = `${mid}:${page}`
    if (pageRatios.has(key)) return
    let alive = true
    void loadPdfjs()
      .then(async library => {
        const file = await openPdfDocument(library, mid)
        const proxy = await file.getPage(page)
        const viewport = proxy.getViewport({ scale: 1 })
        if (viewport.width <= 0) return
        pageRatios.set(key, viewport.height / viewport.width)
        if (alive) setRatio(viewport.height / viewport.width)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mid, page])

  // Only pages near the viewport rasterise; a 30-page unit still opens at once.
  useEffect(() => {
    const element = boxRef.current
    if (element === null) return
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) setVisible(entry.isIntersecting)
      },
      { rootMargin: '900px 0px' },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!visible || width <= 0) return
    let alive = true
    let task: PdfRenderTask | undefined
    const draw = async (): Promise<void> => {
      const library = await loadPdfjs()
      const file = await openPdfDocument(library, mid)
      const proxy = await file.getPage(page)
      if (!alive) return
      const base = proxy.getViewport({ scale: 1 })
      if (base.width <= 0) return
      const device = Math.min(2, window.devicePixelRatio > 0 ? window.devicePixelRatio : 1)
      const viewport = proxy.getViewport({ scale: (width / base.width) * device })
      const offscreen = document.createElement('canvas')
      offscreen.width = Math.max(1, Math.floor(viewport.width))
      offscreen.height = Math.max(1, Math.floor(viewport.height))
      const context = offscreen.getContext('2d')
      if (context === null) throw new Error('浏览器无法创建画布')
      task = proxy.render({ canvasContext: context, canvas: offscreen, viewport })
      await task.promise
      if (!alive) return
      const canvas = canvasRef.current
      if (canvas === null) return
      canvas.width = offscreen.width
      canvas.height = offscreen.height
      canvas.style.width = `${String(Math.floor(width))}px`
      canvas.style.height = `${String(Math.floor(offscreen.height / device))}px`
      canvas.getContext('2d')?.drawImage(offscreen, 0, 0)
      setPainted(true)
      setFailure(current => (current === null ? current : null))
    }
    draw().catch((reason: unknown) => {
      if (alive) setFailure(reason instanceof Error ? reason.message : String(reason))
    })
    return () => {
      alive = false
      try {
        task?.cancel()
      } catch {
        // A finished task has nothing to cancel.
      }
    }
  }, [mid, page, width, visible])

  const height = Math.max(120, Math.round(width * ratio))
  return (
    <div className="study-pdf-page" ref={boxRef} style={{ width: `${String(Math.max(1, width))}px`, height: `${String(height)}px` }}>
      <canvas ref={canvasRef} className="study-pdf-canvas" aria-label={`第 ${String(page)} 页`} />
      {marks.map(mark => (
        <button
          key={mark.index}
          type="button"
          className={mark.active ? 'study-mark is-active' : 'study-mark'}
          tabIndex={mark.active ? 0 : -1}
          style={
            mark.active
              ? {
                  left: `${String(mark.x * 100)}%`,
                  top: `${String(mark.y * 100)}%`,
                  width: `${String(mark.w * 100)}%`,
                  height: `${String(mark.h * 100)}%`,
                  background: withAlpha(tint, 0.13),
                  boxShadow: `inset 2px 0 0 ${tint}`,
                }
              : {
                  left: `${String(mark.x * 100)}%`,
                  top: `${String(mark.y * 100)}%`,
                  width: `${String(mark.w * 100)}%`,
                  height: `${String(mark.h * 100)}%`,
                }
          }
          title="点一下，就这一段提问"
          aria-label="就这一段提问"
          onClick={() => onPick({ index: mark.index, text: mark.text })}
        />
      ))}
      {painted ? null : <span className="study-pdf-page-no">p{page}</span>}
      {failure === null ? null : (
        <p className="study-pdf-fail">
          p{page} 这一页渲染失败。可以
          <a className="study-link" href={`/study-api/pdf?mid=${encodeURIComponent(mid)}#page=${page}`} target="_blank" rel="noreferrer">
            在新窗口打开
          </a>
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- the rail ---- */

/**
 * The guiding rail.
 *
 * One block, one card: a heading, a line that points back at what was read, and
 * one question. No answer, no progress, no "read 3 of 5".
 */
function Rail({
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
          <p className="study-rail-transition">{prompt.transition}</p>
          <p className="study-rail-question">{prompt.question}</p>
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
 * Never stored (POSITIONING §6 B): closing it loses the exchange, which is what
 * keeps it from becoming a second conversation surface.
 */
function AskPanel({
  mid,
  uid,
  page,
  seed,
  onClose,
}: {
  mid: string
  uid: string
  page: number
  /** The paragraph the reader clicked; it travels with the question. */
  seed?: string
  onClose: () => void
}): ReactElement {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
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

  const send = async (): Promise<void> => {
    const text = question.trim()
    if (text.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const value = await post<{ answer: string }>('/ask', {
        mid,
        uid,
        page,
        question: seed === undefined ? text : `${text}\n\n（我问的是这一段：${seed}）`,
      })
      setAnswer(value.answer)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="study-ask" role="dialog" aria-label="问一句">
      <div className="study-ask-head">
        <span>p{page} 这一段，说给我听听</span>
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
      {answer === null ? null : <p className="study-ask-answer">{answer}</p>}
    </div>
  )
}

/* ------------------------------------------------------------- goal strip --- */

/** The goal this range belongs to, shown above the reading surface. */
function GoalStrip({
  planId,
  mid,
  uid,
  onBack,
  onOpenPlan,
}: {
  planId: string
  mid: string
  uid: string
  onBack: () => void
  onOpenPlan?: (pid: string) => void
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
      <span className="study-goal-strip-goal">{plan.plan.goal}</span>
      {plan.plan.meta.deliverable === undefined ? null : (
        <span className="study-item-meta">要交出：{plan.plan.meta.deliverable}</span>
      )}
      {step === undefined ? null : (
        <span className="study-item-meta">
          这一步：{step.why}
          {step.coverage === 'skim' ? '（略读）' : ''}
        </span>
      )}
      <span className="study-today-spacer" />
      {onOpenPlan === undefined ? null : (
        <button type="button" className="study-link" onClick={() => onOpenPlan(planId)}>
          目标面板
        </button>
      )}
      <button type="button" className="study-link" onClick={onBack}>
        ← 回到目标
      </button>
    </div>
  )
}

/* ------------------------------------------------------------- the reader --- */

/** Tints so consecutive blocks are told apart at a glance. */
const BLOCK_TINTS = ['#3f5c6b', '#4e6449', '#7a6140', '#5f5570', '#416a68', '#7a4a44', '#5a6240']

/** Stable tint for one block id. */
function tintOf(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) % 100000
  return BLOCK_TINTS[hash % BLOCK_TINTS.length]!
}

/** Hex to rgba, for the translucent tints the highlight layer needs. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha)})`
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
function Mascot({ mood, thinking }: { mood: MascotMood; thinking?: boolean }): ReactElement {
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
function Thinking(): ReactElement {
  return (
    <span className="study-think" aria-label="正在想">
      <i />
      <i />
      <i />
    </span>
  )
}

/** The reader for one unit. */
export function UnitReader({
  mid,
  uid,
  planId,
  toc,
  onSelectUnit,
  onBack,
  onOpenConcept,
  onOpenInsight,
  onOpenPlan,
  onOpenQuiz,
  onChanged,
}: {
  mid: string
  uid: string
  toc: TocRow[]
  onSelectUnit: (uid: string) => void
  planId?: string
  onBack: () => void
  onOpenConcept?: (cid: string) => void
  onOpenInsight?: (iid: string) => void
  onOpenPlan?: (pid: string) => void
  /** Leave the reader for this unit's practice page. */
  onOpenQuiz?: (unit: TocRow) => void
  onChanged?: () => void
}): ReactElement {
  const [unit, setUnit] = useState<UnitView | null>(null)
  const [layout, setLayout] = useState<ParagraphRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [menu, setMenu] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [ask, setAsk] = useState(false)
  const [askSeed, setAskSeed] = useState<string | undefined>(undefined)
  const [activePage, setActivePage] = useState<number | null>(null)
  const [activeParaIndex, setActiveParaIndex] = useState<number | null>(null)
  const [full, setFull] = useState(false)
  // The guide is a sprite in the corner: closed it is one round button, open it
  // is a card. Its position is a point, not a width.
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null)
  const [open, setOpen] = useState(false)
  // Set when a generation or a merge fails: the mascot is the only thing on
  // screen that can show "something went wrong" without a dialog.
  const [trouble, setTrouble] = useState(false)
  // Which side of the anchor the card opens on. Frozen while open: recomputing
  // it on every drag frame makes the card flip sides under the cursor.
  const [side, setSide] = useState<{ vertical: 'above' | 'below'; align: 'start' | 'end' }>({
    vertical: 'above',
    align: 'end',
  })
  const [thinking, setThinking] = useState(false)
  const thinkTimer = useRef(0)
  const lastBlockId = useRef<string | null>(null)
  const suppressClick = useRef(false)

  const columnRef = useRef<HTMLDivElement | null>(null)
  const pageElements = useRef(new Map<number, HTMLDivElement>())
  const layoutRef = useRef<ParagraphRecord[] | null>(null)
  const [columnWidth, setColumnWidth] = useState(0)

  const loadLayout = useCallback(
    async (view: UnitView) => {
      if (view.blocks === null) {
        setLayout(null)
        return
      }
      try {
        const value = await api<{ paragraphs: ParagraphRecord[] }>(
          `/layout?mid=${encodeURIComponent(mid)}&from=${String(view.unit.pageStart)}&to=${String(view.unit.pageEnd)}`,
        )
        setLayout(value.paragraphs)
      } catch {
        setLayout(null)
      }
    },
    [mid],
  )

  const load = useCallback(async () => {
    const value = await api<UnitView>(`/unit?mid=${encodeURIComponent(mid)}&uid=${encodeURIComponent(uid)}`)
    setUnit(value)
    setActivePage(current => current ?? value.unit.pageStart)
    void loadLayout(value)
    return value
  }, [loadLayout, mid, uid])

  useEffect(() => {
    let alive = true
    setUnit(null)
    setLayout(null)
    setError(null)
    setJob(null)
    setActivePage(null)
    pageElements.current.clear()
    load().catch(reason => {
      if (alive) setError(errorText(reason))
    })
    return () => {
      alive = false
    }
  }, [load])

  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [full])

  // Column width, measured on the column itself and only rewritten on a real
  // change. Scoping the observer to this element is what breaks the old
  // "scrollbar appears → width changes → re-render → scrollbar disappears" loop.
  useEffect(() => {
    const element = columnRef.current
    if (element === null) return
    const read = (): void => {
      const next = element.clientWidth
      setColumnWidth(previous => (previous === 0 || Math.abs(previous - next) >= 24 ? next : previous))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [unit === null, full])

  const registerPage = useCallback((page: number, element: HTMLDivElement | null) => {
    if (element === null) pageElements.current.delete(page)
    else pageElements.current.set(page, element)
  }, [])

  // Which page — and which paragraph on it — sits at the reading line decides
  // what the rail shows. Only a paragraph change updates state: a per-frame
  // scroll value would re-render every page box on every wheel tick.
  useEffect(() => {
    if (unit === null) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const line = Math.min(window.innerHeight * 0.32, 280)
      const entries = [...pageElements.current.entries()].sort((a, b) => a[0] - b[0])
      for (const [page, element] of entries) {
        const rect = element.getBoundingClientRect()
        if (rect.bottom <= line) continue
        setActivePage(previous => (previous === page ? previous : page))
        const paragraphs = layoutRef.current
        if (paragraphs !== null) {
          const onPage = paragraphs.filter(paragraph => paragraph.page === page)
          if (onPage.length > 0) {
            const relative = rect.height > 0 ? (line - rect.top) / rect.height : 0
            const local = paragraphAt(onPage, Math.max(0, Math.min(1, relative)))
            const next = local >= 0 ? (onPage[local]?.index ?? null) : null
            setActiveParaIndex(previous => (previous === next ? previous : next))
          }
        }
        return
      }
      if (entries.length > 0) setActivePage(entries[entries.length - 1]![0])
    }
    const schedule = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(measure)
    }
    schedule()
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [unit, layout])

  const runJob = useCallback(
    async (path: string, body: Record<string, unknown>, started: string) => {
      setBusy(started)
      setJob(null)
      setTrouble(false)
      try {
        const { jobId } = await post<{ jobId: string }>(path, body)
        const finished = await waitForJob(jobId, setJob)
        if (finished.status === 'done') {
          setTrouble(false)
          await load()
          onChanged?.()
          setToast({ message: '生成完成', tone: 'ok' })
        } else if (finished.status === 'failed') {
          setTrouble(true)
          setToast({ message: finished.error ?? '生成失败', tone: 'error' })
        }
      } catch (reason) {
        setTrouble(true)
        setToast({ message: errorText(reason), tone: 'error' })
      } finally {
        setBusy(null)
        setJob(null)
      }
    },
    [load, onChanged],
  )

  const generateBlocks = (): void => {
    if (unit === null) return
    if (unit.blocks !== null && !window.confirm('这一节已有引导，重新生成会覆盖它。继续？')) return
    void runJob('/generate/blocks', { mid, uid }, '正在分块…')
  }

  const mergeBlock = async (blockId: string): Promise<void> => {
    if (unit === null) return
    try {
      await post('/blocks/merge', { mid, uid, blockId })
      await load()
    } catch (reason) {
      setTrouble(true)
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  const generateQuiz = (): void => {
    if (
      unit !== null &&
      unit.quiz !== null &&
      !window.confirm('这一节已有练习题，重新生成会覆盖；正在答的那一组也会结束。继续？')
    ) {
      return
    }
    void runJob('/generate/quiz', { mid, uid }, '正在出题…')
  }

  /** Keep the sprite fully on screen; the card anchors itself to it. */
  const clampPos = (x: number, y: number): { x: number; y: number } => ({
    x: Math.max(8, Math.min(window.innerWidth - 74, x)),
    y: Math.max(8, Math.min(window.innerHeight - 74, y)),
  })

  /**
   * Drag from any hand-hold.
   *
   * One routine serves the closed sprite and the open card, so both move the
   * same anchor. On the sprite a small movement threshold keeps a plain click
   * a click; on the card there is nothing to click, so it drags immediately.
   */
  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    box: DOMRect,
    onDone?: (moved: boolean) => void,
  ): void => {
    const dx = event.clientX - box.left
    const dy = event.clientY - box.top
    const startX = event.clientX
    const startY = event.clientY
    let moved = false
    const move = (moveEvent: PointerEvent): void => {
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return
      moved = true
      setCardPos(clampPos(moveEvent.clientX - dx, moveEvent.clientY - dy))
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.style.userSelect = ''
      onDone?.(moved)
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const startCardDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Measure the anchor, not the card: the card floats 68px above the anchor,
    // so dragging by the card's own box would apply that offset as a jump.
    const anchor = event.currentTarget.closest('.study-guide')
    if (anchor === null) return
    event.preventDefault()
    beginDrag(event, anchor.getBoundingClientRect())
  }

  const startSpriteDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    beginDrag(event, event.currentTarget.getBoundingClientRect(), moved => {
      // A drag must not also open the card: the click arrives right after.
      suppressClick.current = moved
      if (moved) window.setTimeout(() => { suppressClick.current = false }, 0)
    })
  }

  const openAsk = (paragraph?: { text: string }): void => {
    setAskSeed(paragraph?.text)
    setAsk(true)
  }

  const pages = useMemo(() => {
    if (unit === null) return []
    const list: number[] = []
    for (let page = unit.unit.pageStart; page <= unit.unit.pageEnd; page += 1) list.push(page)
    return list
  }, [unit])

  const page = activePage ?? unit?.unit.pageStart ?? 1
  const blocks = unit?.blocks ?? null

  const activePara = activeParaIndex === null ? null : (layout?.[activeParaIndex] ?? null)

  const activeBlock =
    blocks === null
      ? null
      : activePara !== null
        ? blockForParagraph(blocks, activePara.index)
        : blockAtPage(blocks, page)
  const activeIndex = activeBlock === null || blocks === null ? 0 : blocks.findIndex(block => block.id === activeBlock.id)
  // One tint per block, shared by the highlight and the card, so a change of
  // block is visible even out of the corner of your eye.
  const tint = tintOf(activeBlock?.id ?? 'guide')
  /**
   * Which face the mascot pulls. Each mood has a reason:
   *  - 担心 something failed, 收到 a job is running,
   *  - 疑惑 it is still thinking, 开心 it has a question for you,
   *  - 无聊 there is nothing to ask yet.
   */
  const mood: MascotMood = trouble
    ? 'worried'
    : job !== null
      ? 'ack'
      : thinking
        ? 'puzzled'
        : blocks === null
          ? 'bored'
          : 'happy'

  /**
   * Show the fish thinking for a moment before the card speaks.
   *
   * Opening the sprite is the "someone is here" beat, so it waits a beat and a
   * half; a block change while reading is not, so it stays short. The delay is
   * cosmetic only — the block is already in memory — and it is bounded so a
   * slow moment can never look like a hung request.
   */
  useEffect(() => {
    if (!open) {
      lastBlockId.current = activeBlock?.id ?? null
      window.clearTimeout(thinkTimer.current)
      setThinking(false)
      return
    }
    const id = activeBlock?.id ?? null
    const changed = lastBlockId.current !== null && lastBlockId.current !== id
    lastBlockId.current = id
    window.clearTimeout(thinkTimer.current)
    setThinking(true)
    const delay = changed ? 220 + Math.random() * 200 : 1000 + Math.random() * 1000
    thinkTimer.current = window.setTimeout(() => setThinking(false), delay)
    return () => {
      window.clearTimeout(thinkTimer.current)
    }
  }, [open, activeBlock?.id])


  /**
   * Every paragraph on a page, flagged with whether it belongs to the block the
   * rail is talking about.
   *
   * Asking about the paragraph under the cursor must not require scrolling it
   * into the current block first; the tint still says which block is active.
   */
  const marksOf = (pageNumber: number): Array<ParagraphRecord & { active: boolean }> => {
    if (layout === null) return []
    return layout
      .filter(paragraph => paragraph.page === pageNumber)
      .map(paragraph => ({
        ...paragraph,
        active:
          activeBlock !== null &&
          paragraph.index >= activeBlock.startPara &&
          paragraph.index <= activeBlock.endPara,
      }))
  }

  if (error !== null) return <div className="study-empty">无法打开这一节：{error}</div>
  if (unit === null) return <div className="study-empty">正在载入…</div>

  return (
    <div className={full ? 'study-reader2 is-full' : 'study-reader2'}>
      {/* Fullscreen keeps only what reading needs: the page, and three actions. */}
      {full ? (
        <div className="study-floatbar">
          <span className="study-floatbar-title">{unit.unit.title}</span>
          <button type="button" className="study-floatbar-btn" onClick={() => setTocOpen(true)}>
            目录
          </button>
          <button type="button" className="study-floatbar-btn" onClick={() => onOpenQuiz?.(unit.unit)}>
            过关测试
          </button>
          <button type="button" className="study-floatbar-btn is-primary" onClick={() => setFull(false)}>
            退出全屏
          </button>
        </div>
      ) : null}
      <div className="study-reader2-top">
        {planId === undefined ? null : (
          <GoalStrip
            planId={planId}
            mid={mid}
            uid={uid}
            onBack={onBack}
            {...(onOpenPlan === undefined ? {} : { onOpenPlan })}
          />
        )}
        <div className="study-reader2-head">
          <button type="button" className="study-back" onClick={onBack} aria-label="返回">
            ←
          </button>
          <div className="study-reader2-title">
            <h2>{unit.unit.title}</h2>
            <span className="study-reader-sub">
              {unit.material.title} · p{unit.unit.pageStart}–p{unit.unit.pageEnd} · 全书 {unit.material.pages} 页
            </span>
          </div>
          <div className="study-reader2-actions">
            <button type="button" className="study-ghost" onClick={() => setFull(value => !value)}>
              {full ? '退出全屏' : '全屏'}
            </button>
            <button type="button" className="study-ghost" onClick={() => setTocOpen(true)}>
              目录
            </button>
            <div className="study-menu-wrap">
              <button type="button" className="study-ghost" onClick={() => setMenu(value => !value)} aria-label="更多">
                ⋯
              </button>
              {menu ? (
                <div className="study-menu" onMouseLeave={() => setMenu(false)}>
                  <button type="button" onClick={() => { setMenu(false); generateBlocks() }} disabled={busy !== null}>
                    重新分块并生成引导
                  </button>
                  <button type="button" onClick={() => { setMenu(false); setNotesOpen(true) }} disabled={unit.notes === null}>
                    导读（实验）
                  </button>
                  <button type="button" onClick={() => { setMenu(false); generateQuiz() }} disabled={busy !== null}>
                    {unit.quiz === null ? '生成练习题' : '重新生成练习题'}
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" className="study-primary study-primary-tight" onClick={() => onOpenQuiz?.(unit.unit)}>
              过关测试
            </button>
          </div>
        </div>
      </div>

      <div className="study-reader2-body">
        <div className="study-pdf-col" ref={columnRef}>
          {unit.pdfAvailable ? (
            <div className="study-pdf-stack">
              {pages.map(pageNumber => (
                <PdfPage
                  key={pageNumber}
                  mid={mid}
                  page={pageNumber}
                  width={Math.max(0, Math.min(columnWidth - 32, full ? 1600 : 1280))}
                  marks={marksOf(pageNumber)}
                  tint={tint}
                  onPick={openAsk}
                  onMount={registerPage}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="原文件不在库里。"
              hint="这一节的 PDF 已经不在磁盘上了：重新导入这份资料，或在「⋯」里看导读（实验）。"
            />
          )}
        </div>
      </div>

      {/* One anchor, two states: the whale in the corner, or the card it opens
          into. Keeping the anchor mounted is what stops the button from jumping
          when the card closes — both live at the same point. */}
      {ask ? null : (
        <div
          className={open ? 'study-guide is-open' : 'study-guide'}
          style={cardPos === null ? undefined : { left: `${String(cardPos.x)}px`, top: `${String(cardPos.y)}px`, right: 'auto', bottom: 'auto' }}
        >
          {open ? (
            <section
              className="study-companion"
              aria-label="引导"
              data-vertical={side.vertical}
              data-align={side.align}
              style={{ '--s-tint': tint } as React.CSSProperties}
            >
              <div
                className="study-companion-head"
                onPointerDown={startCardDrag}
                title={
                  activeBlock === null
                    ? '引导'
                    : activeBlock.startPage === activeBlock.endPage
                      ? `第 ${String(activeBlock.startPage)} 页 · 不记进度`
                      : `第 ${String(activeBlock.startPage)}–${String(activeBlock.endPage)} 页 · 不记进度`
                }
              >
                <span className="study-companion-avatar">
                  <Mascot mood={mood} thinking={thinking} />
                </span>
                <span className="study-companion-title">{activeBlock === null ? '引导' : activeBlock.title}</span>
                {activeBlock?.prompt === undefined ? null : (
                  <span className="study-rail-kind">{promptKindLabel(activeBlock.prompt.kind)}</span>
                )}
                <button
                  type="button"
                  className="study-companion-toggle"
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => setOpen(false)}
                  aria-label="收起小鲸鱼"
                >
                  ↓
                </button>
              </div>

              <div className="study-companion-body">
                {job === null ? null : <JobBanner job={job} />}
                {busy !== null && job === null ? <p className="study-rail-empty">{busy}</p> : null}

                {thinking ? (
                  <div className="study-companion-think">
                    <Thinking />
                    <span>唔…我想想</span>
                  </div>
                ) : blocks === null ? (
                  <div className="study-rail-card">
                    <p className="study-rail-empty">我还没读这一节呢。要我按意思分几段吗？</p>
                    <button
                      type="button"
                      className="study-primary study-primary-tight"
                      onClick={generateBlocks}
                      disabled={busy !== null}
                    >
                      {busy === null ? '帮我分块' : '正在翻书…'}
                    </button>
                  </div>
                ) : activeBlock === null ? (
                  <p className="study-rail-empty">诶，这段好像没分到块里。</p>
                ) : (
                  <Rail
                    block={activeBlock}
                    index={activeIndex}
                    busy={busy !== null}
                    onAsk={() => openAsk(activePara ?? undefined)}
                    onMerge={() => void mergeBlock(activeBlock.id)}
                  />
                )}

              </div>
            </section>
          ) : (
            <button
              type="button"
              className="study-sprite"
              onPointerDown={startSpriteDrag}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                setSide({
                  vertical: cardPos !== null && cardPos.y < window.innerHeight * 0.45 ? 'below' : 'above',
                  align: cardPos !== null && cardPos.x < window.innerWidth * 0.5 ? 'start' : 'end',
                })
                setOpen(true)
              }}
              title="叫醒大肥鱼（它不记你读了多少）"
              aria-label="打开引导"
            >
              <Mascot mood={trouble ? 'worried' : 'cute'} />
            </button>
          )}
        </div>
      )}

      {ask ? (
        <AskPanel
          mid={mid}
          uid={uid}
          page={page}
          {...(askSeed === undefined ? {} : { seed: askSeed })}
          onClose={() => {
            setAsk(false)
            setAskSeed(undefined)
          }}
        />
      ) : null}

      {tocOpen ? (
        <div className="study-overlay" onClick={() => setTocOpen(false)}>
          <div className="study-drawer" onClick={event => event.stopPropagation()}>
            <div className="study-drawer-head">
              <h3>目录</h3>
              <button type="button" className="study-ghost" onClick={() => setTocOpen(false)}>
                关闭
              </button>
            </div>
            <nav className="study-drawer-list">
              {toc.map(row => (
                <button
                  key={row.uid}
                  type="button"
                  className={row.uid === uid ? 'study-drawer-row is-on' : 'study-drawer-row'}
                  onClick={() => {
                    setTocOpen(false)
                    onSelectUnit(row.uid)
                  }}
                >
                  <span className="study-drawer-title">{row.title}</span>
                  <span className="study-drawer-meta">
                    p{row.pageStart}–p{row.pageEnd}
                  </span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      ) : null}

      {notesOpen && unit.notes !== null ? (
        <div className="study-overlay" onClick={() => setNotesOpen(false)}>
          <div className="study-drawer study-drawer-wide" onClick={event => event.stopPropagation()}>
            <div className="study-drawer-head">
              <h3>导读（实验）</h3>
              <button type="button" className="study-ghost" onClick={() => setNotesOpen(false)}>
                关闭
              </button>
            </div>
            <p className="study-rail-foot">这是「替你读」的那一层，默认不进主回路。</p>
            <Markdown source={unit.notes} />
          </div>
        </div>
      ) : null}

      {toast === null ? null : <Toast message={toast.message} tone={toast.tone} />}
    </div>
  )
}
