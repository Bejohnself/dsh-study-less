/**
 * Structure detection: turn an extracted PDF into learnable units.
 *
 * Books become section units from the PDF outline, or from heading patterns when
 * there is no outline. Papers always get the three reading passes, plus section
 * units from the outline or from paper heading patterns.
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

/** The three reading passes every paper starts with. */
function paperPasses(numPages: number): StructureNode[] {
  return [
    { uid: 'p1', kind: 'pass', pass: 1, title: '第一遍：5C 概览', pageStart: 1, pageEnd: numPages },
    { uid: 'p2', kind: 'pass', pass: 2, title: '第二遍：方法与假设', pageStart: 1, pageEnd: numPages },
    { uid: 'p3', kind: 'pass', pass: 3, title: '第三遍：可复现与批判', pageStart: 1, pageEnd: numPages },
  ]
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
 * one page); the text itself is the better witness. A heading that cannot be
 * found keeps its outline page.
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
      if (lines.some(line => line === target || line.startsWith(`${target} `) || line.endsWith(` ${target}`))) {
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

/** Opening lines that may sit above a chapter title without being body text. */
const PAGE_OPENING_LINES = 2

/** Compare headings ignoring numbering, punctuation and CJK line breaking. */
function looseLine(line: string): string {
  return normalizedLine(line).replace(/\s+/g, '')
}

/**
 * Whether a chapter opens its page.
 *
 * Only chapters get this test. A section heading cannot be told apart from the
 * running head that repeats the same words at the top of the page, and guessing
 * wrong there is what cut a section off mid-page; a section therefore always
 * shares the page its successor starts on.
 */
function chapterOpensPage(node: StructureNode, firstLines: ReadonlyMap<number, string[]>): boolean {
  if ((node.level ?? 2) > 1) return false
  const target = looseLine(node.title)
  if (target.length < 2) return false
  return (firstLines.get(node.pageStart) ?? []).some(line => looseLine(line) === target)
}

/**
 * Assign page ends from the next node's start.
 *
 * A PDF page cannot be split: when the next section starts below the top of its
 * page, that page still carries the tail of the current one, so both units read
 * it. Ending at `next.pageStart - 1` is what cut 1.1 off as soon as 1.2 appeared
 * halfway down the page; only a chapter that starts a fresh page may end its
 * predecessor before that page.
 *
 * Exported so a library imported before this rule can be re-closed in place:
 * only the page ends change, never the unit ids or the progress.
 */
export function closeRanges(
  nodes: StructureNode[],
  pages: readonly ExtractedPage[],
  numPages: number,
  options: { chapters?: boolean } = {},
): StructureNode[] {
  const firstLines = new Map<number, string[]>()
  for (const page of pages) {
    firstLines.set(
      page.page,
      page.text
        .split('\n')
        .map(normalizedLine)
        .filter(line => line.length > 0)
        .slice(0, PAGE_OPENING_LINES),
    )
  }
  const sorted = [...nodes].sort((a, b) => a.pageStart - b.pageStart)
  for (const [index, node] of sorted.entries()) {
    const next = sorted[index + 1]
    const end =
      next === undefined
        ? numPages
        : options.chapters === true && chapterOpensPage(next, firstLines)
          ? next.pageStart - 1
          : next.pageStart
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
  if (input.type === 'paper') {
    nodes = [...paperPasses(input.numPages), ...refinedSections]
  } else if (refinedSections.length >= 2) {
    nodes = refinedSections
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

  // Passes keep the whole document; sections close against their neighbours.
  const sectionNodes = closed
    ? nodes
    : closeRanges(nodes.filter(node => node.kind !== 'pass'), input.pages, input.numPages, {
        chapters: input.type === 'book',
      })
  const byUid = new Map(sectionNodes.map(node => [node.uid, node]))
  return nodes.map(node => (node.kind === 'pass' ? node : (byUid.get(node.uid) ?? node)))
}
