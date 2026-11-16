/**
 * Shelf covers: the first page of the material's own file.
 *
 * The page is the card face — no frame, no generated thumbnail, no extra file on
 * disk. It is drawn by pdf.js from the same PDF the reader streams, so a cover
 * can never drift from the document it represents. Three rules keep a shelf of
 * large books quiet:
 *
 *  1. a cover is rasterised only when its card comes near the viewport;
 *  2. at most two covers rasterise at a time, so the shelf never blocks typing
 *     or scrolling on its own file parsing;
 *  3. a missing or broken file is a designed state, not an error: the card keeps
 *     its paper and shows the type and title instead.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { MaterialCard } from '../../core/views.ts'
import { typeLabel } from '../labels.ts'
import { loadPdfjs, openPdfDocument, pageRatios } from '../pdf.ts'

/** How many covers may rasterise at once. */
const CONCURRENCY = 2

let running = 0
const waiting: Array<() => void> = []

/** Run one rasterise task, waiting for a free slot first. */
function limited<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = (): void => {
      running += 1
      task()
        .then(resolve, reject)
        .finally(() => {
          running -= 1
          waiting.shift()?.()
        })
    }
    if (running < CONCURRENCY) start()
    else waiting.push(start)
  })
}

/** Draw page 1 of one material into a canvas sized for the card face. */
async function paintFirstPage(
  mid: string,
  canvas: HTMLCanvasElement,
  boxWidth: number,
  boxHeight: number,
): Promise<void> {
  const library = await loadPdfjs()
  const file = await openPdfDocument(library, mid)
  const proxy = await file.getPage(1)
  const base = proxy.getViewport({ scale: 1 })
  if (!(base.width > 0) || !(base.height > 0)) throw new Error('这一页没有可渲染的尺寸')
  pageRatios.set(`${mid}:1`, base.height / base.width)
  // Contain the whole page in the face. The card is paper-coloured, so the
  // margin a letter page or a slide leaves is invisible: nothing is cropped,
  // nothing is stretched, and a wide figure still reads.
  const scale = Math.min(boxWidth / base.width, boxHeight / base.height)
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('这一页没有可渲染的尺寸')
  const device = Math.min(2, window.devicePixelRatio > 0 ? window.devicePixelRatio : 1)
  const viewport = proxy.getViewport({ scale: scale * device })
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  canvas.style.width = `${String(Math.round(base.width * scale))}px`
  canvas.style.height = `${String(Math.round(base.height * scale))}px`
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('浏览器无法创建画布')
  await proxy.render({ canvasContext: context, canvas, viewport }).promise
}

/** First-page cover of one material, or a paper stand-in when it has no file. */
export function BookCover({
  mid,
  title,
  type,
}: {
  mid: string
  title: string
  type: MaterialCard['type']
}): ReactElement {
  const tileRef = useRef<HTMLSpanElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [state, setState] = useState<'waiting' | 'ready' | 'missing'>('waiting')

  useEffect(() => {
    const tile = tileRef.current
    if (tile === null) return
    let alive = true
    let painted = false
    let pending = false
    let usedWidth = 0
    const draw = (fresh: boolean): void => {
      const canvas = canvasRef.current
      if (canvas === null || pending) return
      const width = tile.clientWidth
      if (width <= 0) return
      const height = tile.clientHeight > 0 ? tile.clientHeight : width * 1.4
      pending = true
      usedWidth = width
      if (fresh) setState('waiting')
      void limited(async () => {
        if (!alive) return
        await paintFirstPage(mid, canvas, width, height)
      })
        .then(
          () => {
            if (!alive) return
            painted = true
            setState('ready')
          },
          () => {
            if (alive) setState('missing')
          },
        )
        .finally(() => {
          pending = false
        })
    }
    // A cover is worth waiting for only when the eye can reach it.
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        observer.disconnect()
        draw(true)
      },
      { rootMargin: '320px 0px' },
    )
    observer.observe(tile)
    // A resized card keeps its page sharp instead of stretching one bitmap.
    const resizer = new ResizeObserver(() => {
      if (!painted || Math.abs(tile.clientWidth - usedWidth) <= 24) return
      draw(false)
    })
    resizer.observe(tile)
    return () => {
      alive = false
      observer.disconnect()
      resizer.disconnect()
    }
  }, [mid])

  return (
    <span className="study-cover" ref={tileRef} aria-hidden="true">
      <canvas
        ref={canvasRef}
        className="study-cover-canvas"
        style={state === 'ready' ? undefined : { display: 'none' }}
      />
      {state === 'waiting' ? <span className="study-cover-ghost" /> : null}
      {state === 'missing' ? (
        <span className="study-cover-standin">
          <span className="study-cover-standin-kind">{typeLabel(type)}</span>
          <span className="study-cover-standin-title">{title}</span>
        </span>
      ) : null}
    </span>
  )
}