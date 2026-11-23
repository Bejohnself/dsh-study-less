/**
 * Type surface for the vendored pdf.js legacy build.
 *
 * `types/` is copied verbatim from pdfjs-dist@6.3.289, so the API is typed by
 * upstream instead of by hand. Only the names this repo uses are re-exported
 * under its own vocabulary; nothing here restates a libshape.
 */
export { getDocument, Util } from './types/src/pdf.js'

export type {
  PDFDocumentProxy as PdfDocumentProxy,
  PDFPageProxy as PdfPageProxy,
  PDFDocumentLoadingTask as PdfLoadingTask,
  TextContent as PdfTextContent,
  TextItem as PdfTextItem,
} from './types/src/display/api.js'

/** One outline entry, exactly as `getOutline()` returns it. */
export type PdfOutlineItem = NonNullable<
  Awaited<ReturnType<import('./types/src/pdf.js').PDFDocumentProxy['getOutline']>>
>[number]