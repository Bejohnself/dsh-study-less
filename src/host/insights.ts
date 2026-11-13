/**
 * Insight operations: the single service both the panel and the agent tools use.
 *
 * Every source page is validated against the real unit range before an insight
 * is stored, so a distilled card can always jump back to its evidence.
 */
import { INSIGHT_KINDS, deleteInsight, insightCard, insightId, listInsights, readInsight, validateInsight, writeInsight } from '../core/insights.ts'
import { listConcepts } from '../core/concepts.ts'
import { listManifests } from '../core/library.ts'
import type { LibraryPaths } from '../core/paths.ts'
import type { InsightKind, InsightRecord, InsightSource, MaterialManifest } from '../core/types.ts'
import type { InsightCard, InsightDetailView } from '../core/views.ts'
import { StudyError } from './service.ts'

/** Input accepted from a manual editor or a generator. */
export interface InsightInput {
  title: string
  oneLiner: string
  body: string
  formula?: string
  concepts: string[]
  sources: InsightSource[]
  tags?: string[]
  kind?: InsightKind
  origin?: 'manual' | 'generated'
  pinned?: boolean
  generatedBy?: InsightRecord['generatedBy']
}

function rangesOf(manifests: readonly MaterialManifest[]): Map<string, { pageStart: number; pageEnd: number }> {
  const ranges = new Map<string, { pageStart: number; pageEnd: number }>()
  for (const manifest of manifests) {
    for (const node of manifest.structure) {
      ranges.set(`${manifest.id}:${node.uid}`, { pageStart: node.pageStart, pageEnd: node.pageEnd })
    }
  }
  return ranges
}

/** Insight list/detail/CRUD. */
export class InsightService {
  readonly paths: LibraryPaths

  constructor(paths: LibraryPaths) {
    this.paths = paths
  }

  /** Every insight as a list card. */
  async cards(): Promise<InsightCard[]> {
    return (await listInsights(this.paths)).map(insightCard)
  }

  /** One insight with sources resolved to human labels. */
  async view(insightIdValue: string): Promise<InsightDetailView> {
    const insight = await readInsight(this.paths, insightIdValue)
    if (insight === null) throw new StudyError('not-found', `洞察不存在：${insightIdValue}`)
    const manifests = await listManifests(this.paths)
    const byId = new Map(manifests.map(manifest => [manifest.id, manifest]))
    const conceptNames = new Map((await listConcepts(this.paths)).map(record => [record.id, record.name]))
    const sources: InsightDetailView['sources'] = []
    for (const source of insight.sources) {
      const manifest = byId.get(source.material)
      const node = manifest?.structure.find(candidate => candidate.uid === source.unit)
      if (manifest === undefined || node === undefined) continue
      sources.push({
        materialId: manifest.id,
        materialTitle: manifest.title,
        unitId: node.uid,
        unitTitle: node.title,
        page: source.page,
        ...(source.quote === undefined ? {} : { quote: source.quote }),
      })
    }
    return {
      insight,
      sources,
      concepts: insight.concepts.map(id => ({ id, name: conceptNames.get(id) ?? id })),
    }
  }

  /** Create one insight after validation. */
  async create(input: InsightInput): Promise<InsightRecord> {
    const manifests = await listManifests(this.paths)
    const issues = validateInsight({
      title: input.title,
      oneLiner: input.oneLiner,
      body: input.body,
      ...(input.formula === undefined ? {} : { formula: input.formula }),
      sources: input.sources,
      concepts: input.concepts,
      ranges: rangesOf(manifests),
    })
    if (issues.length > 0) throw new StudyError('invalid', '洞察未通过校验', { issues })
    const records = await listInsights(this.paths)
    const taken = new Set(records.map(record => record.id))
    const now = new Date().toISOString()
    const record: InsightRecord = {
      version: 1,
      id: insightId(input.title, taken),
      title: input.title.trim(),
      oneLiner: input.oneLiner.trim(),
      body: input.body.trim(),
      ...(input.formula === undefined || input.formula.trim().length === 0 ? {} : { formula: input.formula.trim() }),
      concepts: [...new Set(input.concepts)],
      sources: input.sources.map(source => ({ ...source })),
      tags: [...new Set((input.tags ?? []).map(tag => tag.trim()).filter(tag => tag.length > 0))],
      kind: input.kind !== undefined && INSIGHT_KINDS.includes(input.kind) ? input.kind : 'principle',
      origin: input.origin ?? 'manual',
      pinned: input.pinned ?? false,
      ...(input.generatedBy === undefined ? {} : { generatedBy: input.generatedBy }),
      createdAt: now,
      updatedAt: now,
    }
    await writeInsight(this.paths, record)
    return record
  }

  /**
   * Create or refresh a generated insight.
   *
   * Dedupe key is the title plus the first source; repeated generation of the
   * same unit updates the card instead of piling up duplicates, while a manual
   * pin survives.
   */
  async upsertGenerated(input: InsightInput & { sourceKey: string }): Promise<InsightRecord> {
    const records = await listInsights(this.paths)
    const existing = records.find(record => {
      const first = record.sources[0]
      return (
        first !== undefined &&
        `${first.material}:${first.unit}` === input.sourceKey &&
        record.title.trim() === input.title.trim()
      )
    })
    if (existing === undefined) return this.create({ ...input, origin: 'generated' })
    const now = new Date().toISOString()
    const next: InsightRecord = {
      ...existing,
      oneLiner: input.oneLiner.trim(),
      body: input.body.trim(),
      ...(input.formula === undefined || input.formula.trim().length === 0 ? { formula: undefined } : { formula: input.formula.trim() }),
      concepts: [...new Set(input.concepts)],
      sources: input.sources.map(source => ({ ...source })),
      tags: [...new Set([...existing.tags, ...(input.tags ?? [])])],
      kind: input.kind ?? existing.kind,
      updatedAt: now,
      ...(input.generatedBy === undefined ? {} : { generatedBy: input.generatedBy }),
    }
    await writeInsight(this.paths, next)
    return next
  }

  /** Patch a manually edited insight. */
  async update(insightIdValue: string, patch: Partial<InsightInput> & { pinned?: boolean }): Promise<InsightRecord> {
    const existing = await readInsight(this.paths, insightIdValue)
    if (existing === null) throw new StudyError('not-found', `洞察不存在：${insightIdValue}`)
    const merged: InsightRecord = {
      ...existing,
      title: patch.title?.trim() || existing.title,
      oneLiner: patch.oneLiner?.trim() || existing.oneLiner,
      body: patch.body?.trim() || existing.body,
      ...(patch.formula === undefined ? {} : { formula: patch.formula.trim() || undefined }),
      concepts: patch.concepts === undefined ? existing.concepts : [...new Set(patch.concepts)],
      sources: patch.sources === undefined ? existing.sources : patch.sources.map(source => ({ ...source })),
      tags: patch.tags === undefined ? existing.tags : [...new Set(patch.tags)],
      kind: patch.kind ?? existing.kind,
      pinned: patch.pinned ?? existing.pinned,
      updatedAt: new Date().toISOString(),
    }
    if (patch.title !== undefined || patch.oneLiner !== undefined || patch.body !== undefined || patch.sources !== undefined || patch.concepts !== undefined) {
      const manifests = await listManifests(this.paths)
      const issues = validateInsight({
        title: merged.title,
        oneLiner: merged.oneLiner,
        body: merged.body,
        ...(merged.formula === undefined ? {} : { formula: merged.formula }),
        sources: merged.sources,
        concepts: merged.concepts,
        ranges: rangesOf(manifests),
      })
      if (issues.length > 0) throw new StudyError('invalid', '洞察未通过校验', { issues })
    }
    await writeInsight(this.paths, merged)
    return merged
  }

  /** Delete one insight. */
  async remove(insightIdValue: string): Promise<{ deleted: boolean }> {
    return { deleted: await deleteInsight(this.paths, insightIdValue) }
  }

  /** Pin or unpin one insight. */
  async pin(insightIdValue: string, pinned: boolean): Promise<InsightRecord> {
    const existing = await readInsight(this.paths, insightIdValue)
    if (existing === null) throw new StudyError('not-found', `洞察不存在：${insightIdValue}`)
    existing.pinned = pinned
    await writeInsight(this.paths, existing)
    return existing
  }

  /** One pinned insight for the Today page. */
  async pinned(): Promise<InsightCard | undefined> {
    return (await listInsights(this.paths)).find(record => record.pinned) === undefined
      ? undefined
      : insightCard((await listInsights(this.paths)).find(record => record.pinned)!)
  }
}
