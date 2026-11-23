/**
 * Import pipeline: local PDF -> material directory + manifest.
 *
 * The source is copied into the library so the material survives the original
 * file moving; pages are sliced so the reader can show the original text and
 * jump by page without the PDF viewer.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { slugify, uniqueSlug } from '../core/ids.ts'
import { listManifests, writeManifest } from '../core/library.ts'
import type { LibraryPaths } from '../core/paths.ts'
import { ensureDir } from '../core/store.ts'
import type { MaterialManifest, MaterialType, StructureNode } from '../core/types.ts'
import { MAX_SOURCE_BYTES } from '../core/views.ts'
import { extractPdf } from './pdf.ts'
import { buildStructure } from './structure.ts'

/** One import request. */
export interface ImportRequest {
  /** Absolute or relative path of the source PDF. */
  filePath: string
  /** Explicit type; inferred when omitted. */
  type?: MaterialType
  /** Display title; derived from the file name when omitted. */
  title?: string
  /** Explicit material id; derived from the title when omitted. */
  id?: string
  /** Where the file came from (URL, DOI, arXiv id). */
  origin?: string
  signal?: AbortSignal
}

/** Import outcome. */
export interface ImportResult {
  manifest: MaterialManifest
  warnings: string[]
  extraction: { numPages: number; outlineEntries: number; units: number }
}

/** Turn an uploaded file name into a display title. */
export function titleFromName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled'
}

/** Infer the display title from a file name. */
function titleFromPath(filePath: string): string {
  return basename(filePath, extname(filePath)).replace(/[_]+/g, ' ').trim() || 'Untitled'
}

/** Guess whether a PDF is a paper by shape rather than by user input. */
export function inferType(
  outlineTitles: readonly string[],
  firstPageText: string,
): MaterialType {
  const lowered = outlineTitles.map(title => title.toLowerCase())
  const hasPaperShape =
    lowered.some(title => title.includes('abstract') || title.includes('introduction')) ||
    /arxiv|abstract|\bdoi\b/i.test(firstPageText.slice(0, 4000))
  return hasPaperShape ? 'paper' : 'book'
}

/**
 * Import one PDF into the library.
 * @param paths - library layout.
 * @param request - source path plus optional metadata.
 */
export async function importMaterial(paths: LibraryPaths, request: ImportRequest): Promise<ImportResult> {
  if (extname(request.filePath).toLowerCase() !== '.pdf') {
    throw new Error('目前只支持 PDF；其他格式请先转换为 PDF')
  }
  const bytes = await readFile(request.filePath)
  if (bytes.byteLength === 0) throw new Error('源文件为空')
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('源文件超过 512 MiB')

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const extraction = await extractPdf(new Uint8Array(bytes), request.signal)
  if (extraction.numPages === 0) throw new Error('PDF 没有可读页面')

  const existing = await listManifests(paths)
  const taken = new Set(existing.map(manifest => manifest.id))
  const title = (request.title ?? titleFromPath(request.filePath)).trim() || 'Untitled'
  const id = request.id ?? uniqueSlug(slugify(title, 'book'), taken)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error(`无效的资料 id：${id}`)
  if (taken.has(id)) throw new Error(`资料 id 已存在：${id}`)

  const warnings: string[] = []
  const type =
    request.type ??
    inferType(
      extraction.outline.map(entry => entry.title),
      extraction.pages[0]?.text ?? '',
    )

  const structure: StructureNode[] = buildStructure({
    type,
    numPages: extraction.numPages,
    outline: extraction.outline,
    pages: extraction.pages,
  })
  if (extraction.outline.length < 2) {
    warnings.push('PDF 没有可用目录，已按正文标题/页块生成单元；可用 study_structure_set 修正。')
  }
  if (structure.length === 0) throw new Error('无法生成任何学习单元')

  // Source copy.
  const sourceDir = paths.sourceDir(id)
  await ensureDir(sourceDir)
  const sourceName = `source${extname(request.filePath).toLowerCase()}`
  await writeFile(join(sourceDir, sourceName), bytes)

  // Page slices.
  const pagesDir = paths.pagesDir(id)
  await ensureDir(pagesDir)
  for (const page of extraction.pages) {
    await writeFile(
      paths.pageFile(id, page.page),
      `<!-- page ${page.page} -->\n${page.text}\n`,
      'utf8',
    )
  }

  const now = new Date().toISOString()
  const manifest: MaterialManifest = {
    version: 1,
    id,
    type,
    title,
    authors: [],
    tags: [],
    identifiers: {},
    source: {
      path: join('source', sourceName),
      sha256,
      pages: extraction.numPages,
      importedAt: now,
      origin: request.origin ?? request.filePath,
    },
    structure,
    units: structure.map(node => ({ uid: node.uid, status: 'new' as const, concepts: [] })),
    ...(type === 'paper' ? { claims: [] } : {}),
    createdAt: now,
    updatedAt: now,
  }
  await writeManifest(paths, manifest)

  return {
    manifest,
    warnings,
    extraction: {
      numPages: extraction.numPages,
      outlineEntries: extraction.outline.length,
      units: structure.length,
    },
  }
}
