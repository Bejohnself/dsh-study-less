/**
 * Page layout: turn positioned text into paragraphs.
 *
 * The reader needs paragraph boundaries for two things the page number cannot
 * give: a semantic block that starts in the middle of a page, and a highlight
 * that covers exactly the sentences a block talks about. Both must be identical
 * on the Host (which writes the block) and in the browser (which draws it), so
 * the geometry is computed once on the Host and stored.
 *
 * This module is pure: it takes positioned boxes in page units and returns
 * paragraphs in 0..1 page units. The heuristics are deliberately conservative —
 * a wrong merge only makes a card slightly coarser, and the reader can always
 * fold a block into the previous one.
 */

/** One positioned run of text, in page units (y grows downwards). */
export interface TextBox {
  str: string
  x: number
  y: number
  w: number
  h: number
}

/** One paragraph in 0..1 page units. */
export interface LayoutParagraph {
  x: number
  y: number
  w: number
  h: number
  text: string
}

/** One detected line inside a page. */
interface Line {
  x: number
  right: number
  y: number
  bottom: number
  h: number
  text: string
}

/** CJK ranges: no space is inserted between two of them. */
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/u

/** Join two line bodies without inventing spaces inside Chinese text. */
function joinText(left: string, right: string): string {
  if (left.length === 0) return right
  if (right.length === 0) return left
  const a = left.slice(-1)
  const b = right.slice(0, 1)
  const glue = CJK.test(a) || CJK.test(b) ? '' : ' '
  return `${left}${glue}${right}`
}

/** Value at a quantile of a numeric list; 0 for an empty one. */
function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[at]!
}

/** Median of a numeric list; 0 for an empty one. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Group boxes that share a baseline into lines, then order each line by x. */
function toLines(boxes: readonly TextBox[], lineHeight: number): Line[] {
  const tolerance = Math.max(2, lineHeight * 0.55)
  const ordered = [...boxes].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
  const lines: Line[] = []
  let current: TextBox[] = []
  let baseline = Number.NaN
  const flush = (): void => {
    if (current.length === 0) return
    const sorted = [...current].sort((a, b) => a.x - b.x)
    let text = ''
    let right = -Infinity
    let left = Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const box of sorted) {
      text = joinText(text, box.str.trim())
      left = Math.min(left, box.x)
      right = Math.max(right, box.x + box.w)
      top = Math.min(top, box.y)
      bottom = Math.max(bottom, box.y + box.h)
    }
    lines.push({ x: left, right, y: top, bottom, h: bottom - top, text })
    current = []
  }
  for (const box of ordered) {
    if (Number.isNaN(baseline) || Math.abs(box.y - baseline) <= tolerance) {
      if (Number.isNaN(baseline)) baseline = box.y
      current.push(box)
    } else {
      flush()
      baseline = box.y
      current.push(box)
    }
  }
  flush()
  return lines
}

/**
 * Find the empty vertical band that separates two columns, if there is one.
 *
 * Detection runs on boxes, not on lines: a line grouping that happens before
 * the split would glue the two columns together at the same baseline and hide
 * the gutter entirely. A page with a full-width heading therefore stays
 * single-column, which is the safe answer.
 */
function findGutter(boxes: readonly TextBox[], width: number): number | null {
  if (boxes.length < 12) return null
  const spans = boxes.map(box => ({ left: box.x, right: box.x + box.w })).sort((a, b) => a.left - b.left)
  const merged: Array<{ left: number; right: number }> = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last !== undefined && span.left <= last.right) last.right = Math.max(last.right, span.right)
    else merged.push({ ...span })
  }
  let best: { at: number; size: number } | null = null
  for (let index = 1; index < merged.length; index += 1) {
    const gapStart = merged[index - 1]!.right
    const gapEnd = merged[index]!.left
    const size = gapEnd - gapStart
    const centre = gapStart + size / 2
    if (size < width * 0.04) continue
    if (centre < width * 0.3 || centre > width * 0.7) continue
    if (best === null || size > best.size) best = { at: centre, size }
  }
  if (best === null) return null
  const leftShare = boxes.filter(box => box.x + box.w / 2 < best.at).length
  const share = leftShare / boxes.length
  return share >= 0.25 && share <= 0.75 ? best.at : null
}

/** Group one column's lines into paragraphs by vertical gap and indent. */
function toParagraphs(lines: readonly Line[], lineHeight: number): Array<{ x: number; y: number; w: number; h: number; text: string }> {
  if (lines.length === 0) return []
  const ordered = [...lines].sort((a, b) => a.y - b.y)
  const left = Math.min(...ordered.map(line => line.x))
  const right = Math.max(...ordered.map(line => line.right))
  const columnWidth = Math.max(1, right - left)

  // Line spacing is measured, not assumed: leading varies by typesetter, and a
  // font-height threshold splits every line on documents with generous leading.
  const leading = ordered.slice(1).map((line, index) => line.y - ordered[index]!.bottom).filter(gap => gap >= 0)
  // The low quantile, not the mean: a page with one big section gap would
  // otherwise inflate "typical" leading and merge the very paragraphs apart.
  const typicalGap = quantile(leading, 0.3) || lineHeight * 0.25
  const breakGap = Math.max(lineHeight * 0.35, typicalGap * 1.9)
  const softGap = Math.max(lineHeight * 0.25, typicalGap * 1.2)

  const groups: Line[][] = []
  let current: Line[] = []
  for (const line of ordered) {
    const previous = current[current.length - 1]
    const gap = previous === undefined ? 0 : line.y - previous.bottom
    const shortPrevious = previous === undefined ? false : previous.right - previous.x < columnWidth * 0.72
    // An indented first line is the classic paragraph start; a vertical gap is
    // the fallback when the typesetting has no indent.
    const indented = line.x - left > lineHeight * 0.9
    const startsParagraph =
      previous !== undefined && (gap > breakGap || (shortPrevious && gap > softGap) || indented)
    if (startsParagraph) {
      groups.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) groups.push(current)

  return groups.map(group => {
    let text = ''
    for (const line of group) text = joinText(text, line.text)
    const x = Math.min(...group.map(line => line.x))
    const y = Math.min(...group.map(line => line.y))
    const bottom = Math.max(...group.map(line => line.bottom))
    const rightEdge = Math.max(...group.map(line => line.right))
    return { x, y, w: rightEdge - x, h: bottom - y, text }
  })
}

/**
 * Layout one page.
 *
 * @param boxes - positioned text runs in page units.
 * @param size - page size in the same units.
 */
export function layoutPage(boxes: readonly TextBox[], size: { width: number; height: number }): LayoutParagraph[] {
  const width = size.width > 0 ? size.width : 1
  const height = size.height > 0 ? size.height : 1
  const usable = boxes.filter(box => box.str.trim().length > 0 && box.w > 0 && box.h > 0)
  if (usable.length === 0) return []

  const lineHeight = median(usable.map(box => box.h)) || 10
  const gutter = findGutter(usable, width)
  const columns =
    gutter === null
      ? [usable]
      : [usable.filter(box => box.x + box.w / 2 < gutter), usable.filter(box => box.x + box.w / 2 >= gutter)]

  const paragraphs: LayoutParagraph[] = []
  for (const columnBoxes of columns) {
    const column = toLines(columnBoxes, lineHeight)
    for (const paragraph of toParagraphs(column, lineHeight)) {
      if (paragraph.text.trim().length === 0) continue
      // Figure labels and table rules do come through as short stubs. They are
      // kept: dropping them needs a width threshold that also swallows short
      // headings, and a stray fragment costs one repair round at most.
      paragraphs.push({
        x: Math.round((paragraph.x / width) * 100000) / 100000,
        y: Math.round((paragraph.y / height) * 100000) / 100000,
        w: Math.round((paragraph.w / width) * 100000) / 100000,
        h: Math.round((paragraph.h / height) * 100000) / 100000,
        text: paragraph.text.replace(/\s+/gu, ' ').trim(),
      })
    }
  }
  return paragraphs
}

/** Whether a normalized point falls inside a paragraph box. */
export function paragraphAt(paragraphs: readonly LayoutParagraph[], y: number): number {
  if (paragraphs.length === 0) return -1
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]!
    if (y >= paragraph.y && y <= paragraph.y + paragraph.h) return index
  }
  // Between two paragraphs: pick the nearest one that starts below the point,
  // so a gap in the middle of a page never leaves the rail blank.
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (paragraphs[index]!.y > y) return index
  }
  return paragraphs.length - 1
}