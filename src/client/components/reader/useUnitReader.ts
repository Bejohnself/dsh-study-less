/**
 * Reader state and effects for one unit.
 *
 * Split from reader.tsx so the screen itself is only props in, markup out. Every
 * hook here was taken verbatim from the component; the order is unchanged, which
 * is what keeps effects and refs behaving the same.
 */
import type {MascotMood} from '../../mascot.ts'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {PointerEvent as ReactPointerEvent} from 'react'
import type {ParagraphRecord, QuickAction} from '../../../core/types.ts'
import type {JobView, SettingsView, TocRow, UnitView} from '../../../core/views.ts'
import {blockAtPage, blockForParagraph} from '../../../core/blocks.ts'
import {paragraphAt} from '../../../core/layout.ts'
import {api, errorText, post, waitForJob} from '../../api.ts'
import {promptKindLabel} from '../../labels.ts'
import {TINT_PREF, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, tintOf, tintVisible} from './chrome.tsx'

/** Everything the reading screen receives from its page. */
export interface UnitReaderProps {
  mid: string
  uid: string
  toc: TocRow[]
  onSelectUnit: (uid: string) => void
  planId?: string
  onBack: () => void
  /** Leave the reader for this unit's practice page. */
  onOpenQuiz?: (unit: TocRow) => void
  onChanged?: () => void
}

/** One record of what the screen is showing and what it can do. */
export function useUnitReader(props: UnitReaderProps) {
  const {mid, uid, planId, toc, onSelectUnit, onBack, onOpenQuiz, onChanged} = props
  const [unit, setUnit] = useState<UnitView | null>(null)
  const [layout, setLayout] = useState<ParagraphRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [showTint, setShowTint] = useState(tintVisible)
  const [tocOpen, setTocOpen] = useState(false)
  const tocListRef = useRef<HTMLElement | null>(null)
  const currentTocRef = useRef<HTMLButtonElement | null>(null)
  const [ask, setAsk] = useState(false)
  const [askSeed, setAskSeed] = useState<string | undefined>(undefined)
  // Bumped on every open so a new passage starts a clean question window.
  const [askNonce, setAskNonce] = useState(0)
  // Which page the question is about: the selection's first page, not wherever
  // the reader happened to be scrolled.
  const [askPage, setAskPage] = useState<number | null>(null)
  // The instruction that opened the question window, if it came from a quick
  // action. Null means the reader asked a question themselves.
  const [askAction, setAskAction] = useState<QuickAction | null>(null)
  // Buttons the reader configured in settings.
  const [quickActions, setQuickActions] = useState<QuickAction[]>([])
  // The passage the reader dragged over, and where to put the "ask" button.
  const [selection, setSelection] = useState<{ text: string; x: number; y: number; below: boolean; page: number | null } | null>(null)
  const [activePage, setActivePage] = useState<number | null>(null)
  const [activeParaIndex, setActiveParaIndex] = useState<number | null>(null)
  const [full, setFull] = useState(false)
  // 1 = fit the column. Only the ladder values are reachable, so the readout and
  // the buttons never disagree about which stop comes next.
  const [zoom, setZoom] = useState(1)
  // The guide is a sprite in the corner: closed it is one round button, open it
  // is a card. Its position is a point, not a width.
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null)
  // 贴边：锚点交给 CSS，位置不再由拖拽决定；左右两边都支持。
  const [dock, setDock] = useState<'left' | 'right' | null>(null)
  // 贴边时保留原来的高度：拖到右上角就往右上角贴，不往回掉。
  const [dockY, setDockY] = useState<number | null>(null)
  // 全屏功能栏可以收成边缘页签，少挡一点正文。
  const [barOpen, setBarOpen] = useState(true)
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
    setSelection(null)
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
    setSelection(null)
    if (full) setBarOpen(true)
  }, [full])

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

  // Selecting text is the way in now: drag over the page, then ask about exactly
  // that passage. The button is transient — scrolling or clicking away drops it.
  useEffect(() => {
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (target !== null && target.closest('.study-select-bar') !== null) return
      const column = columnRef.current
      const active = window.getSelection()
      if (column === null || active === null || active.isCollapsed || active.rangeCount === 0) {
        setSelection(null)
        return
      }
      const range = active.getRangeAt(0)
      const node = range.commonAncestorContainer
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
      if (element === null || !column.contains(element)) {
        setSelection(null)
        return
      }
      const text = active
        .toString()
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      if (text.length === 0) {
        setSelection(null)
        return
      }
      const rects = range.getClientRects()
      const rect = rects[rects.length - 1] ?? range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setSelection(null)
        return
      }
      const startNode = range.startContainer
      const startElement =
        startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement
      const pageElement = startElement?.closest('[data-page]')
      const fromPage = pageElement instanceof HTMLElement ? Number(pageElement.dataset.page) : Number.NaN
      const x = Math.min(window.innerWidth - 56, Math.max(56, rect.left + rect.width / 2))
      const below = rect.top < 56
      setSelection({
        text,
        x,
        y: below ? rect.bottom + 10 : rect.top - 10,
        below,
        page: Number.isFinite(fromPage) ? fromPage : null,
      })
    }
    const onScroll = (): void => setSelection(null)
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target !== null && target.closest('.study-select-bar') !== null) return
      setSelection(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c')) {
        setSelection(null)
      }
    }
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const zoomIn = useCallback(() => {
    setZoom(current => ZOOM_STEPS.find(step => step > current) ?? ZOOM_MAX)
  }, [])
  const zoomOut = useCallback(() => {
    setZoom(current => [...ZOOM_STEPS].reverse().find(step => step < current) ?? ZOOM_MIN)
  }, [])
  const zoomFit = useCallback(() => setZoom(1), [])

  // Ctrl/⌘ + / − / 0, the shortcuts a PDF viewer is expected to answer. Text
  // fields keep the browser's own zoom: the reader never swallows typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      if (event.altKey) return
      const target = event.target as HTMLElement | null
      if (target !== null) {
        if (target.isContentEditable) return
        if (/^(input|textarea|select)$/i.test(target.tagName)) return
      }
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        zoomIn()
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        zoomOut()
      } else if (event.key === '0') {
        event.preventDefault()
        zoomFit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [zoomIn, zoomOut, zoomFit])

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

  const toggleTint = (): void => {
    setShowTint(current => {
      const next = !current
      try {
        window.localStorage.setItem(TINT_PREF, next ? '0' : '1')
      } catch {
        // A blocked localStorage only costs persistence, not the toggle.
      }
      return next
    })
  }

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
    let last: { x: number; y: number } | null = null
    const move = (moveEvent: PointerEvent): void => {
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return
      moved = true
      const next = clampPos(moveEvent.clientX - dx, moveEvent.clientY - dy)
      last = next
      setDock(null)
      setCardPos(next)
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.style.userSelect = ''
      // 松手时压在边上的，就贴上去：读的时候不用再管它挡不挡字。
      if (last !== null) {
        if (last.x <= 40) dockTo('left', last.y)
        else if (last.x + 58 >= window.innerWidth - 40) dockTo('right', last.y)
      }
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

  /** Park the sprite against one edge; the card then opens inward from it. */
  const dockTo = (edge: 'left' | 'right' | null, y: number | null = null): void => {
    // 书签有高度，贴边时按它留出余量，别让顶端把书签顶出屏幕。
    const stripHeight = Math.min(window.innerHeight * 0.42, 340)
    const kept = edge === null || y === null ? null : Math.max(8, Math.min(window.innerHeight - stripHeight - 16, y))
    setDock(edge)
    setDockY(kept)
    setCardPos(null)
    setSide({
      // 贴在上半屏时卡片朝下开，否则会顶出屏幕
      vertical: kept !== null && kept < window.innerHeight * 0.45 ? 'below' : 'above',
      align: edge === 'left' ? 'start' : 'end',
    })
  }

  const startSpriteDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    // 贴边时 sprite 有位移，量锚点才能让拖拽不跳。
    const anchor = event.currentTarget.closest('.study-guide') ?? event.currentTarget
    beginDrag(event, anchor.getBoundingClientRect(), moved => {
      // A drag must not also open the card: the click arrives right after.
      suppressClick.current = moved
      if (moved) window.setTimeout(() => { suppressClick.current = false }, 0)
    })
  }

  /** Open the card: docked ones open along the edge they are parked on. */
  const openGuide = (): void => {
    setSide(
      dock !== null
        ? {
            vertical: dockY !== null && dockY < window.innerHeight * 0.45 ? 'below' : 'above',
            align: dock === 'left' ? 'start' : 'end',
          }
        : {
            vertical: cardPos !== null && cardPos.y < window.innerHeight * 0.45 ? 'below' : 'above',
            align: cardPos !== null && cardPos.x < window.innerWidth * 0.5 ? 'start' : 'end',
          },
    )
    setOpen(true)
  }

  const openAsk = (seed?: string, at?: number, action?: QuickAction): void => {
    setAskSeed(seed)
    setAskPage(at ?? null)
    setAskAction(action ?? null)
    setAsk(true)
    setAskNonce(current => current + 1)
    setSelection(null)
  }

  useEffect(() => {
    let alive = true
    api<SettingsView>('/settings')
      .then(value => {
        if (alive) setQuickActions(value.study.quickActions ?? [])
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

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

  /**
   * Put the current unit in the middle of the TOC list. The drawer can hold a
   * whole book, so opening it at the top would make the reader hunt for the
   * section they are already in.
   */
  const centerCurrentToc = useCallback((behavior: ScrollBehavior): void => {
    const list = tocListRef.current
    const row = currentTocRef.current
    if (list === null || row === null) return
    const rowTop = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
    const top = rowTop - (list.clientHeight - row.offsetHeight) / 2
    list.scrollTo({ top: Math.max(0, top), behavior })
  }, [])

  useEffect(() => {
    if (!tocOpen) return
    const frame = window.requestAnimationFrame(() => centerCurrentToc('auto'))
    return () => window.cancelAnimationFrame(frame)
  }, [centerCurrentToc, tocOpen, uid])

  return {
    error,
    unit,
    tocListRef,
    currentTocRef,
    thinkTimer,
    lastBlockId,
    suppressClick,
    columnRef,
    pageElements,
    layoutRef,
    loadLayout,
    load,
    zoomIn,
    zoomOut,
    zoomFit,
    registerPage,
    runJob,
    toggleTint,
    generateBlocks,
    mergeBlock,
    clampPos,
    beginDrag,
    startCardDrag,
    dockTo,
    startSpriteDrag,
    openGuide,
    openAsk,
    pages,
    page,
    blocks,
    activePara,
    activeBlock,
    activeIndex,
    tint,
    mood,
    marksOf,
    centerCurrentToc,
    setUnit,
    layout,
    setLayout,
    setError,
    job,
    setJob,
    busy,
    setBusy,
    toast,
    setToast,
    showTint,
    setShowTint,
    tocOpen,
    setTocOpen,
    ask,
    setAsk,
    askSeed,
    setAskSeed,
    askNonce,
    setAskNonce,
    askPage,
    setAskPage,
    askAction,
    setAskAction,
    quickActions,
    setQuickActions,
    selection,
    setSelection,
    activePage,
    setActivePage,
    activeParaIndex,
    setActiveParaIndex,
    full,
    setFull,
    zoom,
    setZoom,
    cardPos,
    setCardPos,
    dock,
    setDock,
    dockY,
    setDockY,
    barOpen,
    setBarOpen,
    open,
    setOpen,
    trouble,
    setTrouble,
    side,
    setSide,
    thinking,
    setThinking,
    columnWidth,
    setColumnWidth,
    mid,
    uid,
    planId,
    toc,
    onSelectUnit,
    onBack,
    onOpenQuiz,
    onChanged,
  }
}
