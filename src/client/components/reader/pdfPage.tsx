/**
 * PDF page rendering: canvas, text layer and geometry helpers.
 *
 * Split from reader.tsx; UnitReader only mounts these.
 */
import {useEffect, useRef, useState} from 'react'
import type {ReactElement} from 'react'

import {api} from '../../api.ts'
import {loadPdfjs, openPdfDocument, openPdfText, pageRatios, ratioOf, type PdfRenderTask, type PdfTextContent, type PdfViewport} from '../../pdf.ts'

const MAX_CANVAS_PIXELS = 24_000_000

/** Multiply two pdf.js matrices, in the same order as `Util.transform`. */
function multiplyMatrix(m1: readonly number[], m2: readonly number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ]
}

/** One throwaway 2D context for matching span widths to the canvas. */
let measureContext: CanvasRenderingContext2D | null | undefined
function measureCtx(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d')
  return measureContext ?? null
}
function measureTextWidth(text: string, font: string): number {
  const ctx = measureCtx()
  if (ctx === null) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

/**
 * Stretch each span to the width the PDF gave its run.
 *
 * The canvas measurement is only a guess: inherited CSS (weight, letter spacing)
 * can change how the DOM lays the string out. Reading the real widths first and
 * writing the transforms afterwards keeps both passes to one layout each, and
 * makes the span under the cursor exactly as wide as the glyphs on the canvas.
 */
function fitTextLayer(container: HTMLDivElement): void {
  const spans = [...container.querySelectorAll<HTMLElement>('.study-text-item')]
  // Read pass: one layout for the whole page.
  const widths = spans.map(span => {
    const angle = Number(span.dataset.angle ?? '0')
    return angle === 0 ? span.getBoundingClientRect().width : 0
  })
  // Write pass: no layout queries here.
  spans.forEach((span, index) => {
    const target = Number(span.dataset.target ?? '0')
    const measured = widths[index] ?? 0
    const angle = Number(span.dataset.angle ?? '0')
    const stretch =
      measured > 0 && target > 0
        ? target / measured
        : Number(span.dataset.stretch ?? '1')
    span.style.transform = `${angle === 0 ? '' : `rotate(${String(angle)}rad) `}scaleX(${stretch.toFixed(4)})`
  })
}

/** How much of the font size sits above the baseline, per browser font. */
const ascentRatios = new Map<string, number>()
function ascentRatio(fontFamily: string, fallback: number): number {
  const cached = ascentRatios.get(fontFamily)
  if (cached !== undefined) return cached
  const ctx = measureCtx()
  let ratio = fallback
  if (ctx !== null) {
    ctx.font = `100px ${fontFamily}`
    const metrics = ctx.measureText('')
    const up = metrics.fontBoundingBoxAscent ?? 0
    const down = Math.abs(metrics.fontBoundingBoxDescent ?? 0)
    if (up > 0 && up + down > 0) ratio = up / (up + down)
  }
  ascentRatios.set(fontFamily, ratio)
  return ratio
}

/**
 * Turn one page's text runs into transparent spans that sit exactly over the
 * canvas. The browser then does the hard part: drag selection, double-click for
 * a word, Ctrl+C. Everything here is positioned in CSS pixels at the current
 * zoom, so the layer is rebuilt when the page width changes.
 */
function textLayerFragment(content: PdfTextContent, viewport: PdfViewport, scale: number): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const styles = content.styles ?? {}
  for (const raw of content.items) {
    if (!('str' in raw)) continue
    if (raw.str.length > 0) {
      const style = styles[raw.fontName]
      // Vertical writing would need a different placement model; leaving it out
      // only means those runs cannot be selected, never that the page breaks.
      if (style?.vertical !== true) {
        const tx = Array.isArray(raw.transform)
          ? multiplyMatrix(viewport.transform, raw.transform)
          : null
        const fontSize = tx === null ? 0 : Math.hypot(tx[2]!, tx[3]!)
        if (tx !== null && fontSize > 0) {
          const angle = Math.atan2(tx[1]!, tx[0]!)
          const fallbackAscent =
            style?.ascent !== undefined && style.ascent > 0 && style.ascent < 2 ? style.ascent : 0.8
          const fontFamily = style?.fontFamily ?? 'sans-serif'
          // The browser's own font metrics decide where the baseline sits inside
          // the span; the PDF's ascent is only the fallback (same order as pdf.js).
          const rise = fontSize * ascentRatio(fontFamily, fallbackAscent)
          const left = angle === 0 ? tx[4]! : tx[4]! + rise * Math.sin(angle)
          const top = angle === 0 ? tx[5]! - rise : tx[5]! - rise * Math.cos(angle)
          // The PDF font is almost never installed in the browser, so the span
          // is stretched to the width the file says the run occupies: selection
          // rectangles then land on the glyphs the canvas drew.
          const target = raw.width * scale
          const measured = measureTextWidth(raw.str, `${String(fontSize)}px ${fontFamily}`)
          const fallbackStretch = measured > 0 && target > 0 ? target / measured : 1
          const span = document.createElement('span')
          span.className = 'study-text-item'
          span.textContent = raw.str
          span.style.left = `${left.toFixed(2)}px`
          span.style.top = `${top.toFixed(2)}px`
          span.style.fontSize = `${fontSize.toFixed(2)}px`
          span.style.fontFamily = fontFamily
          // The real stretch is filled in after the span is in the document: the
          // DOM's own layout width is what the browser will hit-test against, and
          // it can differ from a canvas measurement when other CSS leaks in.
          span.dataset.target = target.toFixed(2)
          span.dataset.angle = angle.toFixed(5)
          span.dataset.stretch = fallbackStretch.toFixed(4)
          fragment.append(span)
        }
      }
    }
    if (raw.hasEOL === true) fragment.append(document.createElement('br'))
  }
  return fragment
}

/**
 * One page of the original file.
 *
 * Two rules keep scrolling smooth:
 *  1. the visible canvas is never cleared — a new bitmap is drawn off-screen
 *     and blitted in one step, so resizing or scrolling never blanks a page;
 *  2. the container width only re-renders on a real layout change (≥24px), so a
 *     scrollbar appearing cannot feed a resize back into the render loop.
 */
/** Hex to rgba, for the translucent tints the highlight layer needs. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha)})`
}

export function PdfPage({
  mid,
  page,
  width,
  marks,
  tint,
  showTint,
  onMount,
}: {
  mid: string
  page: number
  width: number
  /**
   * Every paragraph on this page. `active` marks the ones inside the current
   * block; those are the only ones painted, and only as a tint.
   */
  marks: ReadonlyArray<{ index: number; x: number; y: number; w: number; h: number; text: string; active: boolean }>
  /** Block tint, so the highlight changes colour with the block. */
  tint: string
  /** Whether the tint overlay is painted on the page. */
  showTint: boolean
  onMount: (page: number, element: HTMLDivElement | null) => void
}): ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
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
      let device = Math.min(2, window.devicePixelRatio > 0 ? window.devicePixelRatio : 1)
      // Zoom multiplies the CSS width, and the bitmap multiplies it again by the
      // device ratio: 3× on a 4K screen would be a 100 MB canvas per page. Cap the
      // total pixels instead of the ratio so zoomed pages stay sharp but bounded.
      const cssHeight = width * (base.height / base.width)
      if (width * cssHeight * device * device > MAX_CANVAS_PIXELS) {
        device = Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / (width * cssHeight)))
      }
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

  // Selectable text over the bitmap. Rebuilt only when the page width changes;
  // the run data itself is cached per page in pdf.ts.
  useEffect(() => {
    if (!visible || width <= 0) return
    let alive = true
    const build = async (): Promise<void> => {
      const container = textRef.current
      if (container === null) return
      const [content, library] = await Promise.all([openPdfText(mid, page), loadPdfjs()])
      if (!alive) return
      const file = await openPdfDocument(library, mid)
      const proxy = await file.getPage(page)
      const base = proxy.getViewport({ scale: 1 })
      if (base.width <= 0) return
      const scale = width / base.width
      const viewport = proxy.getViewport({ scale })
      if (!alive) return
      container.replaceChildren(textLayerFragment(content, viewport, scale))
      fitTextLayer(container)
    }
    build().catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mid, page, width, visible])

  const height = Math.max(120, Math.round(width * ratio))
  return (
    <div
      className="study-pdf-page"
      ref={boxRef}
      data-page={page}
      style={{ width: `${String(Math.max(1, width))}px`, height: `${String(height)}px` }}
    >
      <canvas ref={canvasRef} className="study-pdf-canvas" aria-label={`第 ${String(page)} 页`} />
      {marks.map(mark =>
        mark.active ? (
          <span
            key={mark.index}
            className="study-mark is-active"
            style={{
              left: `${String(mark.x * 100)}%`,
              top: `${String(mark.y * 100)}%`,
              width: `${String(mark.w * 100)}%`,
              height: `${String(mark.h * 100)}%`,
              background: showTint ? withAlpha(tint, 0.2) : 'transparent',
            }}
          />
        ) : null,
      )}
      {/* Transparent, selectable text over the bitmap. Kept out of the
          accessibility tree: the canvas already names the page. */}
      <div className="study-text" ref={textRef} aria-hidden="true" />
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