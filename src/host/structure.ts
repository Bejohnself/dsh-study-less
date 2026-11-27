/**
 * Structure detection: turn an extracted PDF into learnable units.
 *
 * Books and papers both become section units from the PDF outline, or from
 * heading patterns when there is no outline. Papers keep their paper-specific
 * heading pattern, but no longer get synthetic reading-pass units.
 */
import { slugify, uniqueSlug } from '../core/ids.ts'
import type { MaterialType, StructureNode } from '../core/types.ts'
import type { ExtractedPage, OutlineEntry } from './pdf.ts'

/** Input for structure building. */
export interface StructureInput {
  type: MaterialType
  numPages: number
  outline: OutlineEntry[]
  pages: ExtractedPage[]
}

/** Longest heading line accepted by the text heuristics. */
const MAX_HEADING_LINE = 90

/** Book heading: 第X章/节, Chapter N, or a numbered section. */
const BOOK_HEADING =
  /^\s*(第[一二三四五六七八九十百零〇0-9]+[章节篇部]|Chapter\s+\d+|\d{1,2}(?:\.\d{1,3}){1,3}\.?)\s*(.*)$/

/** Paper heading: "1 Introduction", "3.2 Model Architecture". */
const PAPER_HEADING = /^\s*(\d{1,2}(?:\.\d{1,2})?)\s+([A-Z][^\n]{2,60})$/

/** A table-of-contents line with dot leaders or a trailing page number. */
const TOC_LINE = /(\.{3,}|…{2,})\s*\d+\s*$|\s\d{1,3}\s*$/

/** Cut one long text into numbered page offsets per heading found. */
function headingLines(pages: readonly ExtractedPage[], pattern: RegExp): Array<{ title: string; page: number }> {
  const hits: Array<{ title: string; page: number }> = []
  const seen = new Set<string>()
  for (const page of pages) {
    for (const raw of page.text.split('\n')) {
      const line = raw.trim()
      if (line.length === 0 || line.length > MAX_HEADING_LINE) continue
      if (TOC_LINE.test(line)) continue
      const match = pattern.exec(line)
      if (match === null) continue
      const title = line.replace(/\s+/g, ' ').trim()
      if (seen.has(title)) continue
      seen.add(title)
      hits.push({ title, page: page.page })
      if (hits.length >= 400) return hits
    }
  }
  return hits
}

/** Build structure nodes from outline entries. */
function fromOutline(input: StructureInput): StructureNode[] {
  const nodes: StructureNode[] = []
  const taken = new Set<string>()
  for (const entry of input.outline) {
    if (entry.title.length === 0) continue
    const uid = uniqueSlug(slugify(entry.title, `s${entry.page}`), taken)
    taken.add(uid)
    nodes.push({
      uid,
      kind: 'section',
      title: entry.title,
      level: entry.level,
      pageStart: entry.page,
      pageEnd: input.numPages,
    })
  }
  return nodes
}

/** Fallback: fixed-size page chunks, for PDFs with no usable headings. */
function chunked(input: StructureInput): StructureNode[] {
  const size = 12
  const nodes: StructureNode[] = []
  for (let start = 1, index = 1; start <= input.numPages; start += size, index += 1) {
    const end = Math.min(input.numPages, start + size - 1)
    nodes.push({
      uid: `chunk-${String(index).padStart(2, '0')}`,
      kind: 'section',
      title: `第 ${start}–${end} 页`,
      pageStart: start,
      pageEnd: end,
    })
  }
  return nodes
}

/** Normalize a heading line for comparison (drop numbering, punctuation). */
function normalizedLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\.?\s*/, '')
    .replace(/[^a-z0-9\u4e00-\u9fff ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Refine outline page starts from real heading lines.
 *
 * PDF outlines often carry stale or coarse destinations (several chapters on
 * one page); the text itself is the better witness. Only a line that matches
 * the title as a whole counts: a prefix/suffix match also fires on the running
 * head that repeats the chapter title and on the contents line a chapter title
 * page prints, either of which moves the start one or two pages off.
 * A heading that cannot be found keeps its outline page.
 */
function refinePages(nodes: StructureNode[], pages: readonly ExtractedPage[]): StructureNode[] {
  const pageLines = new Map(
    pages.map(page => [page.page, page.text.split('\n').map(normalizedLine).filter(line => line.length > 0)]),
  )
  const refined = nodes.map(node => ({ ...node }))
  for (const node of refined) {
    const target = normalizedLine(node.title)
    if (target.length < 3) continue
    const searchStart = Math.max(1, node.pageStart - 2)
    const searchEnd = Math.min(pages.length, node.pageStart + 4)
    for (let page = searchStart; page <= searchEnd; page += 1) {
      const lines = pageLines.get(page) ?? []
      if (lines.includes(target)) {
        node.pageStart = page
        break
      }
    }
  }
  // Keep the document order monotonic after refinement.
  for (let index = 1; index < refined.length; index += 1) {
    const previous = refined[index - 1]
    const current = refined[index]
    if (previous !== undefined && current !== undefined && current.pageStart < previous.pageStart) {
      current.pageStart = previous.pageStart
    }
  }
  return refined
}

/** Most lines a heading may wrap over before the opening test gives up. */
const MAX_TITLE_LINES = 4

/** Pages a line has to repeat on before it counts as a running head. */
const RUNNING_HEAD_PAGES = 3

/** Shortest line that reads as prose rather than a contents entry. */
const PROSE_MIN_LINE = 24

/** Compare headings ignoring numbering, punctuation and CJK line breaking. */
function looseLine(line: string): string {
  return normalizedLine(line).replace(/\s+/g, '')
}

/** Heading depth; nodes without one behave like sections. */
function levelOf(node: StructureNode): number {
  return node.level ?? 2
}

/**
 * Whether a line is page furniture rather than body text.
 *
 * The repeat is the reliable half: a running head carries the chapter title and
 * a page number, so it can read exactly like a heading, while a page number on
 * its own is a line of digits. Both are decided here so the opening test does
 * not have to guess from the words.
 */
function isFurniture(line: string, pagesWithLine: ReadonlyMap<string, number>): boolean {
  const normalized = normalizedLine(line)
  if (normalized.length === 0) return true
  if (/^[\d\s.·•—–_()-]+$/.test(line)) return true
  return (pagesWithLine.get(normalized) ?? 0) >= RUNNING_HEAD_PAGES
}

/**
 * Whether a heading opens its page: nothing but page furniture above it.
 *
 * A heading may wrap over several lines, and a chapter number may sit on a line
 * of its own above it. Any other text above the heading means the page still
 * carries the unit before it, so the page stays shared. A heading the text does
 * not confirm (OCR-mangled title, missing line) also leaves the page shared.
 */
function opensPage(
  node: StructureNode,
  lines: readonly string[],
  pagesWithLine: ReadonlyMap<string, number>,
): boolean {
  const target = looseLine(node.title)
  if (target.length < 2) return false
  const body = lines.filter(line => !isFurniture(line, pagesWithLine)).slice(0, MAX_TITLE_LINES)
  let joined = ''
  for (const line of body) {
    joined += looseLine(line)
    if (joined === target) return true
    if (!target.startsWith(joined)) return false
  }
  return false
}

/** Index just past a node's heading in one page's content lines, or -1. */
function headingEnd(node: StructureNode, content: readonly string[]): number {
  const target = normalizedLine(node.title)
  if (target.length < 2) return -1
  const exact = content.findIndex(line => normalizedLine(line) === target)
  if (exact >= 0) return exact + 1
  // A wrapped title has no single line to match, and then the only page it can
  // open is the one whose opening text spells it.
  const loose = looseLine(node.title)
  let joined = ''
  for (const [index, line] of content.slice(0, MAX_TITLE_LINES).entries()) {
    joined += looseLine(line)
    if (joined === loose) return index + 1
    if (!loose.startsWith(joined)) return -1
  }
  return -1
}

/** Whether a line reads as prose rather than a contents entry. */
function isProseLine(line: string): boolean {
  return line.length >= PROSE_MIN_LINE && !TOC_LINE.test(line)
}

/**
 * Whether a parent has prose of its own before its first child.
 *
 * Those pages are the parent's introduction; a parent is only an index row, so
 * the text needs a unit of its own or nobody can read it. A title page that
 * only lists its sections has none.
 */
function hasPreamble(
  node: StructureNode,
  firstChildStart: number,
  linesOf: ReadonlyMap<number, string[]>,
  pagesWithLine: ReadonlyMap<string, number>,
): boolean {
  for (let page = node.pageStart; page < firstChildStart; page += 1) {
    const content = (linesOf.get(page) ?? []).filter(line => !isFurniture(line, pagesWithLine))
    const start = page === node.pageStart ? headingEnd(node, content) : 0
    if (start < 0) continue
    if (content.slice(start).some(isProseLine)) return true
  }
  return false
}

/** Title of the unit that carries a parent's own introduction. */
function introTitle(parent: StructureNode): string {
  const suffix = /[\u4e00-\u9fff]/.test(parent.title) ? '序言' : 'Intro'
  return `${parent.title} · ${suffix}`
}

/**
 * Give a parent's introduction a leaf of its own.
 *
 * The prose between a parent heading and its first child sits on pages no leaf
 * covers, and opening a parent jumps into its first section — without this unit
 * the text would be unreachable. The unit is one level under its parent, comes
 * first among the children, and is flagged `intro` so callers can tell it from
 * an outline heading.
 */
function withIntros(
  nodes: readonly StructureNode[],
  linesOf: ReadonlyMap<number, string[]>,
  pagesWithLine: ReadonlyMap<string, number>,
): StructureNode[] {
  const out: StructureNode[] = []
  for (const [index, node] of nodes.entries()) {
    out.push(node)
    const child = nodes[index + 1]
    if (child === undefined || levelOf(child) <= levelOf(node) || child.pageStart <= node.pageStart) continue
    if (!hasPreamble(node, child.pageStart, linesOf, pagesWithLine)) continue
    out.push({
      uid: `${node.uid}-intro`,
      kind: 'section',
      title: introTitle(node),
      level: levelOf(node) + 1,
      pageStart: node.pageStart,
      pageEnd: node.pageStart,
      intro: true,
    })
  }
  return out
}

/** Per-page lines plus how many pages each line repeats on, shared by both passes. */
function pageIndex(pages: readonly ExtractedPage[]): {
  linesOf: Map<number, string[]>
  pagesWithLine: Map<string, number>
} {
  const linesOf = new Map<number, string[]>()
  const pagesWithLine = new Map<string, number>()
  for (const page of pages) {
    const lines = page.text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
    linesOf.set(page.page, lines)
    for (const normalized of new Set(lines.map(normalizedLine))) {
      if (normalized.length === 0) continue
      pagesWithLine.set(normalized, (pagesWithLine.get(normalized) ?? 0) + 1)
    }
  }
  return { linesOf, pagesWithLine }
}

/**
 * Assign page ends from the structure itself.
 *
 * A unit spans its own subtree: it ends where the next node at the same or a
 * shallower level starts, so a chapter or a section with subsections covers all
 * of them, and its 序言/Intro unit covers the pages before the first child.
 * A PDF page cannot be split, so a boundary page is shared — the page still
 * carries the tail of the unit before it — unless the boundary heading opens
 * its page, in which case nothing above it belongs to that unit.
 *
 * Exported so a library imported before this rule can be re-closed in place:
 * only the page ranges change, never the unit ids or the progress.
 */
export function closeRanges(
  nodes: StructureNode[],
  pages: readonly ExtractedPage[],
  numPages: number,
): StructureNode[] {
  const { linesOf, pagesWithLine } = pageIndex(pages)
  const ordered = [...nodes].sort((a, b) => a.pageStart - b.pageStart || levelOf(a) - levelOf(b))
  for (const [index, node] of ordered.entries()) {
    const level = levelOf(node)
    const boundary = ordered.slice(index + 1).find(other => levelOf(other) <= level)
    const end =
      boundary === undefined
        ? numPages
        : opensPage(boundary, linesOf.get(boundary.pageStart) ?? [], pagesWithLine)
          ? boundary.pageStart - 1
          : boundary.pageStart
    node.pageEnd = Math.max(node.pageStart, Math.min(end, numPages))
  }
  return nodes
}

/**
 * Build the unit structure of one material.
 * @param input - type, page count, outline and page text.
 * @returns ordered structure nodes ready for the manifest.
 */
export function buildStructure(input: StructureInput): StructureNode[] {
  const hasOutline = input.outline.length >= 2
  const sections = hasOutline
    ? fromOutline(input)
    : headingLines(input.pages, input.type === 'paper' ? PAPER_HEADING : BOOK_HEADING).map((hit, index) => {
        const uid = slugify(hit.title, `s${index + 1}`)
        return {
          uid,
          kind: 'section' as const,
          title: hit.title,
          level: 2,
          pageStart: hit.page,
          pageEnd: input.numPages,
        }
      })

  const refinedSections = refinePages(sections, input.pages)

  let nodes: StructureNode[]
  // Chunked fallbacks already tile the document page by page; the "share the
  // page the next section starts on" rule only applies to real headings.
  let closed = false
  if (refinedSections.length >= 2) {
    const { linesOf, pagesWithLine } = pageIndex(input.pages)
    nodes = withIntros(refinedSections, linesOf, pagesWithLine)
  } else {
    nodes = chunked(input)
    closed = true
  }

  // Unique uids across passes and sections.
  const taken = new Set<string>()
  for (const node of nodes) {
    let uid = node.uid
    let suffix = 2
    while (taken.has(uid)) {
      uid = `${node.uid}-${suffix}`
      suffix += 1
    }
    taken.add(uid)
    node.uid = uid
  }

  // Sections close against their neighbours; a chunked fallback already tiles
  // the document and needs no closing pass.
  if (closed) return nodes
  return closeRanges(nodes, input.pages, input.numPages)
}
