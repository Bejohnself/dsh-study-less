/**
 * pdf.js plumbing shared by the reader and the shelf covers.
 *
 * The browser renders the original file itself: the Host only serves bytes, so
 * there is no server-side image cache to invalidate and no thumbnail files on
 * disk. Keeping the loader and the document cache in one module means a cover
 * drawn on the shelf is exactly the document the reader opens a moment later —
 * the same loading task, not a second download.
 */

/** The pdf.js surface used by the in-panel viewer. */
export interface PdfViewport {
  width: number
  height: number
  /** PDF user space → CSS pixels, in pdf.js matrix order [a, b, c, d, e, f]. */
  transform: number[]
  /** CSS pixels per PDF point. */
  scale: number
}

/** One positioned run of text, as pdf.js reports it. */
export interface PdfTextItem {
  str: string
  transform: number[]
  /** Run width in PDF points, before scaling. */
  width: number
  height: number
  fontName: string
  hasEOL?: boolean
}

/** Font metrics pdf.js extracted for one font name. */
export interface PdfTextStyle {
  fontFamily?: string
  /** Cap height as a fraction of the font size, when the PDF carries it. */
  ascent?: number
  descent?: number
  vertical?: boolean
}

export interface PdfTextContent {
  items: Array<PdfTextItem | { type: string }>
  styles?: Record<string, PdfTextStyle>
}

export interface PdfRenderTask {
  promise: Promise<void>
  cancel(): void
}

export interface PdfPageProxy {
  getViewport(options: { scale: number }): PdfViewport
  getTextContent(): Promise<PdfTextContent>
  render(params: {
    canvasContext: CanvasRenderingContext2D
    canvas: HTMLCanvasElement
    viewport: PdfViewport
  }): PdfRenderTask
}

export interface PdfDocumentProxy {
  numPages: number
  getPage(page: number): Promise<PdfPageProxy>
}

export interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument(options: {
    url: string
    wasmUrl?: string
    cMapUrl?: string
    cMapPacked?: boolean
    standardFontDataUrl?: string
  }): { promise: Promise<PdfDocumentProxy> }
}

declare global {
  interface Window {
    __studyPdfjs?: PdfJsModule
    __studyPdfjsPromise?: Promise<PdfJsModule>
  }
}

/** Open documents keyed by material: scrolling never refetches the file. */
export const pdfDocuments = new Map<string, Promise<PdfDocumentProxy>>()

/** Page aspect ratios keyed by `mid:page`; measured once, reused on scroll. */
export const pageRatios = new Map<string, number>()

/** Text runs keyed by `mid:page`; zooming re-lays them out, never refetches. */
const pdfTexts = new Map<string, Promise<PdfTextContent>>()

/**
 * Load the vendored pdf.js module once.
 *
 * The plugin serves the module and its worker itself, so the panel never depends
 * on the browser shipping a built-in PDF viewer.
 */
export function loadPdfjs(): Promise<PdfJsModule> {
  if (window.__studyPdfjs !== undefined) return Promise.resolve(window.__studyPdfjs)
  if (window.__studyPdfjsPromise !== undefined) return window.__studyPdfjsPromise
  window.__studyPdfjsPromise = new Promise<PdfJsModule>((resolve, reject) => {
    const ready = (): void => {
      cleanup()
      const library = window.__studyPdfjs
      if (library === undefined) reject(new Error('PDF 渲染引擎加载失败'))
      else resolve(library)
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('PDF 渲染引擎加载超时'))
    }, 30000)
    const cleanup = (): void => {
      window.clearTimeout(timer)
      window.removeEventListener('study-pdfjs-ready', ready)
    }
    window.addEventListener('study-pdfjs-ready', ready)
    const script = document.createElement('script')
    script.type = 'module'
    script.src = '/study-api/pdfjs/loader.mjs'
    script.onerror = () => {
      cleanup()
      reject(new Error('PDF 渲染引擎脚本加载失败'))
    }
    document.head.append(script)
  })
  return window.__studyPdfjsPromise
}

/** Open one material's document, reusing the cached loading task. */
export function openPdfDocument(library: PdfJsModule, mid: string): Promise<PdfDocumentProxy> {
  const cached = pdfDocuments.get(mid)
  if (cached !== undefined) return cached
  const loading = library.getDocument({
    url: `/study-api/pdf?mid=${encodeURIComponent(mid)}`,
    wasmUrl: '/study-api/pdfjs/wasm/',
    cMapUrl: '/study-api/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/study-api/pdfjs/standard_fonts/',
  }).promise
  pdfDocuments.set(mid, loading)
  loading.catch(() => pdfDocuments.delete(mid))
  return loading
}

/** Height/width of one page; falls back to A4 until measured. */
export function ratioOf(mid: string, page: number): number {
  return pageRatios.get(`${mid}:${page}`) ?? 1.414
}
/**
 * One page's text runs, cached per material+page.
 *
 * The reader turns these into transparent spans over the canvas so the browser
 * can do native selection. Only text is fetched; the canvas render is separate.
 */
export function openPdfText(mid: string, page: number): Promise<PdfTextContent> {
  const key = `${mid}:${page}`
  const cached = pdfTexts.get(key)
  if (cached !== undefined) return cached
  const loading = loadPdfjs().then(async library => {
    const file = await openPdfDocument(library, mid)
    const proxy = await file.getPage(page)
    return proxy.getTextContent()
  })
  pdfTexts.set(key, loading)
  loading.catch(() => pdfTexts.delete(key))
  return loading
}
