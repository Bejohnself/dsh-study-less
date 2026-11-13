/** Minimal type surface for the vendored pdf.js legacy build. */
export interface PdfTextItem {
  str: string
  hasEOL?: boolean
}

export interface PdfTextContent {
  items: Array<PdfTextItem | { type: string }>
}

export interface PdfPageProxy {
  getTextContent(): Promise<PdfTextContent>
  cleanup(): void
}

export interface PdfOutlineItem {
  title: string
  dest: string | unknown[] | null
  items: PdfOutlineItem[]
}

export interface PdfDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxy>
  getOutline(): Promise<PdfOutlineItem[] | null>
  getDestination(id: string): Promise<unknown[] | null>
  getPageIndex(ref: unknown): Promise<number>
}

export interface PdfLoadingTask {
  promise: Promise<PdfDocumentProxy>
  destroy(): Promise<void>
}

export function getDocument(options: Record<string, unknown>): PdfLoadingTask
