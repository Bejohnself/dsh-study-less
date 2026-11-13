/**
 * PDF text extraction on the Host, using the vendored pdf.js legacy build.
 *
 * Only text and the PDF outline are needed: the reader shows page slices and
 * jumps by page, and MinerU stays an optional high-fidelity backend for formulas
 * and figures.
 */
import { getDocument, type PdfDocumentProxy, type PdfOutlineItem, type PdfTextContent } from '../../vendor/pdfjs/pdf.mjs'

/** One page of extracted text. */
export interface ExtractedPage {
  page: number
  text: string
}

/** One resolvable outline entry. */
export interface OutlineEntry {
  title: string
  level: number
  page: number
}

/** Everything the importer needs from one PDF. */
export interface PdfExtraction {
  numPages: number
  pages: ExtractedPage[]
  outline: OutlineEntry[]
  warnings: string[]
}

/** Join text items into readable lines, honouring the end-of-line flags. */
function joinItems(content: PdfTextContent): string {
  const parts: string[] = []
  for (const item of content.items) {
    if (!('str' in item)) continue
    const text = item.str
    if (text.length === 0) {
      if (item.hasEOL === true) parts.push('\n')
      continue
    }
    parts.push(text)
    if (item.hasEOL === true) parts.push('\n')
    else if (!/\s$/.test(text)) parts.push(' ')
  }
  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Resolve one outline destination to a 1-based page number. */
async function resolveDest(doc: PdfDocumentProxy, dest: PdfOutlineItem['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const index = await doc.getPageIndex(explicit[0])
    return index + 1
  } catch {
    return null
  }
}

/** Flatten the PDF outline into resolvable entries. */
async function readOutline(doc: PdfDocumentProxy): Promise<OutlineEntry[]> {
  const raw = await doc.getOutline().catch(() => null)
  if (raw === null || raw.length === 0) return []
  const entries: OutlineEntry[] = []
  const walk = async (items: PdfOutlineItem[], level: number): Promise<void> => {
    for (const item of items) {
      const page = await resolveDest(doc, item.dest)
      if (page !== null) entries.push({ title: item.title.trim(), level, page })
      if (item.items.length > 0) await walk(item.items, level + 1)
    }
  }
  await walk(raw, 1)
  entries.sort((a, b) => a.page - b.page)
  return entries
}

/**
 * Extract pages and outline from PDF bytes.
 * @param data - the whole PDF file.
 * @param signal - cancellation signal.
 */
export async function extractPdf(data: Uint8Array, signal?: AbortSignal): Promise<PdfExtraction> {
  if (signal?.aborted) throw new Error('import aborted')
  const task = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  })
  try {
    const doc = await task.promise
    const pages: ExtractedPage[] = []
    for (let page = 1; page <= doc.numPages; page += 1) {
      if (signal?.aborted) throw new Error('import aborted')
      const proxy = await doc.getPage(page)
      const content = await proxy.getTextContent()
      pages.push({ page, text: joinItems(content) })
      proxy.cleanup()
    }
    const outline = await readOutline(doc)
    return { numPages: doc.numPages, pages, outline, warnings: [] }
  } finally {
    await task.destroy().catch(() => undefined)
  }
}
