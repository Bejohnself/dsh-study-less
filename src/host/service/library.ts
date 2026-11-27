/**
 * Library operations: materials, units, PDF bytes, import, structure, layout and blocks.
 *
 * Free functions over StudyService. The class in ../service.ts keeps the signatures and
 * forwards here, so routes, tools and tests keep talking to the service object.
 */
import { createWriteStream } from 'node:fs'
import { readFile, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { assertSegment, unitKey } from '../../core/ids.ts'
import { deleteInsight, insightCard, listInsights, readInsight, writeInsight } from '../../core/insights.ts'
import { isLeafUnit, listManifests, readManifest, structureNodeOf, writeManifest } from '../../core/library.ts'
import { writeConcept } from '../../core/concepts.ts'
import { dueUnits, emptyProgress, markLearned, readProgress, unmarkLearned } from '../../core/progress.ts'
import { listConcepts } from '../../core/concepts.ts'
import { ensureDir, readJson, updateJson, writeJsonAtomic } from '../../core/store.ts'
import { addDays } from '../../core/time.ts'
import type { BlockFile, BlockInput, BlockRecord, PageLayoutFile, ParagraphRecord, MaterialManifest, ProgressFile, QuizBank, StructureNode, UnitMetaFile } from '../../core/types.ts'
import { type CompleteOptions, type CompleteResult, type MaterialCard, type MaterialStateView, type TocRow, type UnitView } from '../../core/views.ts'
import { extractLayouts } from '../pdf.ts'
import { importMaterial, titleFromName, type ImportRequest, type ImportResult } from '../import.ts'
import { cardOf, extrasOf, rowOf } from '../service/views.ts'
import { StudyError } from './error.ts'
import type { StudyService, UnitMaterial } from '../service.ts'

export async function library(svc: StudyService, includeArchived = false): Promise<MaterialCard[]> {
  const [manifests, progress] = await Promise.all([listManifests(svc.paths), readProgress(svc.paths)])
  return manifests
    .filter(manifest => includeArchived || manifest.archived !== true)
    .map(manifest => cardOf(manifest, progress, svc.today()))
}

export async function materialState(svc: StudyService, materialId: string): Promise<MaterialStateView> {
  const [manifest, progress] = await Promise.all([svc.manifest(materialId), readProgress(svc.paths)])
  const today = svc.today()
  const dueKeys = new Set(dueUnits(progress, today).map(entry => entry.key))
  const toc: TocRow[] = manifest.structure.map(node => {
    const key = unitKey(materialId, node.uid)
    return rowOf(materialId, node, manifest, progress, dueKeys.has(key))
  })
  // Only a leaf is a reading step; a chapter row is an index entry pointing at
  // the first section under it.
  const next = toc.find(row => row.state === 'new' && isLeafUnit(manifest.structure, row.uid))?.uid
  return {
    material: cardOf(manifest, progress, svc.today()),
    toc,
    due: toc.filter(row => dueKeys.has(unitKey(materialId, row.uid))).map(row => row.uid),
    next,
  }
}

export async function pdfSource(svc: StudyService, materialId: string): Promise<{ file: string; title: string; sha256?: string; pages: number }> {
  const manifest = await svc.manifest(materialId)
  const file = svc.paths.sourceFile(materialId, manifest.source.path)
  return {
    file,
    title: manifest.title,
    ...(manifest.source.sha256 === undefined ? {} : { sha256: manifest.source.sha256 }),
    pages: manifest.source.pages,
  }
}

export async function pdfAvailable(svc: StudyService, materialId: string): Promise<boolean> {
  try {
    const { file } = await svc.pdfSource(materialId)
    const info = await stat(file)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

export async function unit(svc: StudyService, materialId: string, unitId: string): Promise<UnitView> {
  const [manifest, progress, notes] = await Promise.all([
    svc.manifest(materialId),
    readProgress(svc.paths),
    svc.readNotes(materialId, unitId),
  ])
  const node = structureNodeOf(manifest, unitId)
  const row = rowOf(materialId, node, manifest, progress, false)
  const original = await svc.readPages(materialId, node.pageStart, node.pageEnd)
  const meta = await readJson<UnitMetaFile | null>(svc.paths.unitMetaFile(materialId, unitId), null)
  const quiz = await readJson<QuizBank | null>(svc.paths.quizFile(materialId, unitId), null)
  const blocks = await readJson<BlockFile | null>(svc.paths.blocksFile(materialId, unitId), null)
  const insights: UnitView['insights'] = []
  for (const insightIdValue of meta?.insights ?? []) {
    const record = await readInsight(svc.paths, insightIdValue)
    if (record !== null) insights.push(insightCard(record))
  }
  return {
    material: cardOf(manifest, progress, svc.today()),
    unit: { ...row, concepts: meta?.concepts ?? row.concepts },
    notes,
    pdfAvailable: await svc.pdfAvailable(materialId),
    original: original.pages,
    truncated: original.truncated,
    quiz,
    extras: extrasOf(materialId, unitId, meta),
    insights,
    // A page-based blocks file from an older version is not readable by the
    // paragraph rail: treat it as "not generated" so the rail offers a rebuild.
    blocks: blocks !== null && blocks.version === 2 ? blocks.blocks : null,
  }
}

export async function unitMaterial(svc: StudyService, materialId: string, unitId: string, maxChars = 12_000): Promise<UnitMaterial> {
  const manifest = await svc.manifest(materialId)
  const node = structureNodeOf(manifest, unitId)
  // A parent covers its whole subtree; reading material for a note only makes
  // sense on the deepest section.
  if (!isLeafUnit(manifest.structure, unitId)) {
    throw new StudyError('invalid', `父节只作目录索引，请选最末一级的节：${unitId}`)
  }
  const original = await svc.readPages(materialId, node.pageStart, node.pageEnd)
  const meta = await readJson<UnitMetaFile | null>(svc.paths.unitMetaFile(materialId, unitId), null)
  const joined = original.pages.map(page => `[p${page.page}]\n${page.text}`).join('\n\n')
  const clipped = joined.length > maxChars ? joined.slice(0, maxChars) : joined
  return {
    material: manifest,
    node,
    text: clipped,
    truncated: joined.length > clipped.length,
    concepts: meta?.concepts ?? [],
    existingNotes: await svc.readNotes(materialId, unitId),
  }
}

export async function complete(svc: StudyService, materialId: string, unitId: string, options: CompleteOptions = {}): Promise<CompleteResult> {
  const manifest = await svc.manifest(materialId)
  const node = structureNodeOf(manifest, unitId)
  await svc.assertRevision(options.revision)
  const key = unitKey(materialId, unitId)
  const before = await readProgress(svc.paths)
  if (before.units[key] !== undefined && before.units[key]!.state !== 'new') {
    const current = before.units[key]!
    return {
      unit: rowOf(materialId, node, manifest, before, false),
      due: current.due ?? addDays(svc.today(), 1),
      revision: before.revision,
      note: '这一节此前已经打过勾。',
    }
  }
  const { progress, unit } = await markLearned(svc.paths, key, {
    rating: options.rating,
    today: options.today ?? svc.today(),
  })
  return {
    unit: rowOf(materialId, node, manifest, progress, false),
    due: unit.due ?? addDays(svc.today(), 1),
    revision: progress.revision,
    note: `已记下首次学习，明天进入复习队列（${unit.due}）。`,
  }
}

export async function uncomplete(svc: StudyService, materialId: string, unitId: string): Promise<{ revision: number }> {
  const manifest = await svc.manifest(materialId)
  structureNodeOf(manifest, unitId)
  const progress = await unmarkLearned(svc.paths, unitKey(materialId, unitId))
  return { revision: progress.revision }
}

export async function importOp(svc: StudyService, request: ImportRequest): Promise<ImportResult> {
  return importMaterial(svc.paths, request)
}

export async function importUpload(svc: StudyService, stream: AsyncIterable<Uint8Array | Buffer>, fileName: string): Promise<ImportResult> {
  const dir = join(svc.paths.root, 'tmp')
  await ensureDir(dir)
  const temp = join(dir, `upload-${crypto.randomUUID()}.pdf`)
  try {
    await pipeline(Readable.from(stream), createWriteStream(temp))
    return await svc.import({ filePath: temp, origin: `upload:${fileName}`, title: titleFromName(fileName) })
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}

export async function importFromUrl(svc: StudyService, url: string): Promise<ImportResult> {
  const id = /(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(url.trim())?.[1]
  if (id === undefined) throw new StudyError('invalid', '目前只支持 arXiv 链接，例如 https://arxiv.org/abs/1706.03762')
  const response = await fetch(`https://arxiv.org/pdf/${id}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
    headers: { 'user-agent': 'dsh-study-less/0.1 (local study library)' },
  })
  if (!response.ok || response.body === null) {
    throw new StudyError('invalid', `arXiv 下载失败（HTTP ${response.status}）`)
  }
  const dir = join(svc.paths.root, 'tmp')
  await ensureDir(dir)
  const temp = join(dir, `arxiv-${id.replace('.', '-')}-${crypto.randomUUID()}.pdf`)
  try {
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(temp))
    return await svc.import({
      filePath: temp,
      origin: `https://arxiv.org/abs/${id}`,
      type: 'paper',
      title: `arXiv ${id}`,
    })
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}

export async function structureSet(svc: StudyService, materialId: string, nodes: readonly StructureNode[]): Promise<MaterialManifest> {
  const manifest = await svc.manifest(materialId)
  if (nodes.length === 0) throw new StudyError('invalid', '结构不能为空')
  const seen = new Set<string>()
  for (const node of nodes) {
    assertSegment(node.uid, 'unit id')
    if (seen.has(node.uid)) throw new StudyError('invalid', `重复的单元 id：${node.uid}`)
    seen.add(node.uid)
    if (node.pageStart < 1 || node.pageEnd < node.pageStart || node.pageEnd > manifest.source.pages) {
      throw new StudyError('invalid', `单元 ${node.uid} 的页码范围非法：${node.pageStart}-${node.pageEnd}`)
    }
  }
  const previous = new Map(manifest.units.map(unit => [unit.uid, unit]))
  manifest.structure = nodes.map(node => ({ ...node }))
  manifest.units = nodes.map(node => previous.get(node.uid) ?? { uid: node.uid, status: 'new' as const, concepts: [] })
  await writeManifest(svc.paths, manifest)
  return manifest
}

export async function layout(svc: StudyService, materialId: string, from: number, to: number): Promise<ParagraphRecord[]> {
  const manifest = await svc.manifest(materialId)
  const first = Math.max(1, Math.min(from, to))
  const last = Math.min(manifest.source.pages, Math.max(from, to))
  if (last < first) return []

  const pages: number[] = []
  for (let page = first; page <= last; page += 1) pages.push(page)

  const loaded = new Map<number, PageLayoutFile>()
  const missing: number[] = []
  for (const page of pages) {
    const file = await readJson<PageLayoutFile | null>(svc.paths.layoutFile(materialId, page), null)
    if (file === null || file.version !== 1) missing.push(page)
    else loaded.set(page, file)
  }
  if (missing.length > 0) {
    const bytes = await readFile(svc.paths.sourceFile(materialId, manifest.source.path))
    const extracted = await extractLayouts(new Uint8Array(bytes), missing)
    for (const page of extracted) {
      const file: PageLayoutFile = {
        version: 1,
        page: page.page,
        width: page.width,
        height: page.height,
        paragraphs: page.paragraphs,
      }
      await writeJsonAtomic(svc.paths.layoutFile(materialId, page.page), file)
      loaded.set(page.page, file)
    }
  }

  const out: ParagraphRecord[] = []
  for (const page of pages) {
    const file = loaded.get(page)
    if (file === undefined) continue
    for (const paragraph of file.paragraphs) {
      out.push({
        index: out.length,
        page,
        x: paragraph.x,
        y: paragraph.y,
        w: paragraph.w,
        h: paragraph.h,
        text: paragraph.text,
      })
    }
  }
  return out
}

export async function mergeBlock(svc: StudyService, materialId: string, unitId: string, blockId: string): Promise<BlockFile> {
  const file = await readJson<BlockFile | null>(svc.paths.blocksFile(materialId, unitId), null)
  if (file === null) throw new StudyError('not-found', '这一节还没有生成引导')
  const index = file.blocks.findIndex(block => block.id === blockId)
  if (index < 0) throw new StudyError('not-found', `找不到这一块：${blockId}`)
  if (index === 0) throw new StudyError('invalid', '第一块没有上一块可并')
  const asInput = (block: BlockRecord): BlockInput => ({
    id: block.id,
    startPara: block.startPara,
    endPara: block.endPara,
    title: block.title,
    ...(block.prompt === undefined ? {} : { prompt: block.prompt }),
  })
  const previous = file.blocks[index - 1]!
  const current = file.blocks[index]!
  const merged: BlockInput = {
    ...asInput(previous),
    endPara: current.endPara,
    ...(previous.prompt === undefined && current.prompt !== undefined ? { prompt: current.prompt } : {}),
  }
  return svc.writeBlocks(materialId, unitId, [
    ...file.blocks.slice(0, index - 1).map(asInput),
    merged,
    ...file.blocks.slice(index + 1).map(asInput),
  ])
}

export async function manifest(svc: StudyService, materialId: string): Promise<MaterialManifest> {
  try {
    assertSegment(materialId, 'material id')
    return await readManifest(svc.paths, materialId)
  } catch (error) {
    if (error instanceof StudyError) throw error
    if (error instanceof Error && error.message.startsWith('unknown material')) {
      throw new StudyError('not-found', `资料不存在：${materialId}`)
    }
    throw error
  }
}

export async function archiveMaterial(svc: StudyService, materialId: string, archived: boolean): Promise<MaterialManifest> {
  const manifest = await svc.manifest(materialId)
  manifest.archived = archived
  await writeManifest(svc.paths, manifest)
  return manifest
}

export async function deleteMaterial(svc: StudyService, materialId: string): Promise<{ deleted: boolean }> {
  await svc.manifest(materialId)
  await rm(svc.paths.materialDir(materialId), { recursive: true, force: true })

  const removedConcepts = new Set<string>()
  for (const concept of await listConcepts(svc.paths)) {
    const next = concept.occurrences.filter(occurrence => occurrence.material !== materialId)
    if (next.length === concept.occurrences.length) continue
    if (next.length === 0) {
      removedConcepts.add(concept.id)
      await unlink(svc.paths.conceptFile(concept.id)).catch(() => undefined)
    } else {
      concept.occurrences = next
      await writeConcept(svc.paths, concept)
    }
  }

  for (const insight of await listInsights(svc.paths)) {
    const next = insight.sources.filter(source => source.material !== materialId)
    if (next.length === insight.sources.length) continue
    if (next.length === 0) {
      await deleteInsight(svc.paths, insight.id)
    } else {
      insight.sources = next
      await writeInsight(svc.paths, insight)
    }
  }

  await updateJson<ProgressFile>(svc.paths.progressFile, emptyProgress(), current => {
    let changed = false
    for (const key of Object.keys(current.units)) {
      if (key.startsWith(`${materialId}:`)) {
        delete current.units[key]
        changed = true
      }
    }
    for (const conceptId of removedConcepts) {
      if (current.concepts[conceptId] !== undefined) {
        delete current.concepts[conceptId]
        changed = true
      }
    }
    if (!changed) return current
    current.revision += 1
    current.updatedAt = new Date().toISOString()
    return current
  })

  return { deleted: true }
}
