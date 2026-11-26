/**
 * 阅读位置：落在哪一页、页内多深。
 *
 * 进出全屏会换掉滚动容器——普通模式滚整个阅读面，全屏时滚 PDF 栏自己——浏览器
 * 随即丢掉旧偏移，画面就跳回本节第一页。位置因此记成「阅读线压在哪一页、页内
 * 比例」，页面宽度变化（换容器、缩放）后仍能落回同一处，而裸 scrollTop 不能。
 */

/** 屏幕上量到的一个页框。 */
export interface PageBox {
  page: number
  top: number
  height: number
}

export interface ReadingAnchor {
  page: number
  /** 阅读线落在这一页的哪个比例处，0..1。 */
  fraction: number
}

/** 一条页框要越过它才算「正在读」的线。与测量滚动位置的线同源。 */
export function readingLine(viewportHeight: number): number {
  return Math.min(viewportHeight * 0.32, 280)
}

/** 阅读线所在的那一页；线在全部页框之下时取最后一页。 */
export function anchorAt(boxes: readonly PageBox[], line: number): ReadingAnchor | null {
  const hit = boxes.find(box => box.top + box.height > line) ?? boxes[boxes.length - 1]
  if (hit === undefined) return null
  const fraction = hit.height > 0 ? Math.min(1, Math.max(0, (line - hit.top) / hit.height)) : 0
  return {page: hit.page, fraction}
}

/** 把锚点塞回阅读线上，scrollTop 需要加多少。 */
export function anchorDelta(anchor: ReadingAnchor, box: PageBox, line: number): number {
  return box.top - (line - anchor.fraction * box.height)
}