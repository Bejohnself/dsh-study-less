/**
 * Section paging for the reader: the two neighbouring units, the ←/→ keys, and
 * where the edge arrows sit inside the host panel.
 *
 * Split out of useUnitReader so the reading screen's state hook stays within
 * the file budget; everything here is paging, nothing else reads it.
 */
import { useEffect, useRef } from 'react'
import type { TocRow } from '../../../core/views.ts'
import { neighbourLeaf } from '../../labels.ts'

/** What paging needs from the reader. */
export interface PagingInput {
  toc: TocRow[]
  uid: string
  onSelectUnit: (uid: string) => void
  /** The question card owns the keyboard while it is open. */
  ask: boolean
  /** The table of contents is a dialog; paging behind it would be invisible. */
  tocOpen: boolean
  /** Fullscreen moves the reader out of the panel scroll, so measure again. */
  full: boolean
  /** The reader root exists once the unit has loaded. */
  ready: boolean
}

/** Neighbours, keys and arrow placement for one unit. */
export function usePaging(input: PagingInput) {
  const { toc, uid, onSelectUnit, ask, tocOpen, full, ready } = input
  const rootRef = useRef<HTMLDivElement | null>(null)
  // A parent row is an index, so paging only ever lands on a readable unit.
  const previous = neighbourLeaf(toc, uid, -1)
  const next = neighbourLeaf(toc, uid, 1)

  // ←/→ page between sections, the keys a reader reaches for without thinking.
  // Typing keeps its own keys, and the card and the contents dialog keep theirs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (ask || tocOpen) return
      const target = event.target as HTMLElement | null
      if (target !== null) {
        if (target.isContentEditable) return
        if (/^(input|textarea|select)$/i.test(target.tagName)) return
      }
      const row = event.key === 'ArrowLeft' ? previous : next
      if (row === undefined) return
      event.preventDefault()
      onSelectUnit(row.uid)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [ask, tocOpen, previous, next, onSelectUnit])

  // Paging should land on the first page of the section, not wherever the last
  // one was read to. `full` is read when this runs, not tracked, so toggling
  // fullscreen keeps the scroll anchor the reader captured around the toggle.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const column = root.querySelector<HTMLElement>('.study-pdf-col')
    const scroller = full ? column : root.closest<HTMLElement>('[data-dsh-study]')
    if (scroller !== null) scroller.scrollTop = 0
  }, [uid])  // eslint-disable-line react-hooks/exhaustive-deps

  // The arrows are fixed to the viewport, so they hug the edge of whatever box
  // they belong to: the host panel in normal mode, the viewport in fullscreen.
  // Measuring the reader root itself left a gutter — it sits inside the panel's
  // padding — so the panel is measured and the arrows stop 2px short of it.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const place = (): void => {
      const hug = full ? root : (root.closest('[data-dsh-study]') ?? root)
      const box = hug.getBoundingClientRect()
      root.style.setProperty('--study-turn-left', `${String(Math.max(0, Math.round(box.left + 2)))}px`)
      root.style.setProperty('--study-turn-right', `${String(Math.max(0, Math.round(window.innerWidth - box.right + 2)))}px`)
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(root)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [full, ready])

  return { rootRef, previous, next }
}