/**
 * The distilled layer: one insight per file under `insights/`.
 *
 * Insights are intentionally separate from concept records and from unit notes:
 * notes stay long and page-bound, concepts stay graph-shaped, insights are the
 * one-screen distillation a reader can pin.
 */
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSegment, slugify, uniqueSlug } from './ids.ts'
import type { LibraryPaths } from './paths.ts'
import { readJson, writeJsonAtomic } from './store.ts'
import type { InsightKind, InsightRecord, InsightSource } from './types.ts'
import type { InsightCard } from './views.ts'

/** The kinds the generator may produce. */
export const INSIGHT_KINDS: InsightKind[] = ['principle', 'formula', 'contrast', 'pitfall', 'analogy', 'method']

/** Read one insight, or null when missing. */
export async function readInsight(paths: LibraryPaths, insightId: string): Promise<InsightRecord | null> {
  return readJson<InsightRecord | null>(paths.insightFile(insightId), null)
}

/** Write one insight, refreshing `updatedAt`. */
export async function writeInsight(paths: LibraryPaths, insight: InsightRecord): Promise<void> {
  assertSegment(insight.id, 'insight id')
  insight.updatedAt = new Date().toISOString()
  await writeJsonAtomic(paths.insightFile(insight.id), insight)
}

/** Delete one insight; missing files are ignored. */
export async function deleteInsight(paths: LibraryPaths, insightId: string): Promise<boolean> {
  try {
    await unlink(paths.insightFile(insightId))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** List every insight, pinned first, then newest. */
export async function listInsights(paths: LibraryPaths): Promise<InsightRecord[]> {
  let entries: string[]
  try {
    entries = await readdir(paths.insightsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const records: InsightRecord[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const record = await readJson<InsightRecord | null>(join(paths.insightsDir, entry), null)
    if (record !== null) records.push(record)
  }
  records.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return a.updatedAt < b.updatedAt ? 1 : -1
  })
  return records
}

/** A fresh id derived from the title. */
export function insightId(title: string, taken: ReadonlySet<string>): string {
  return uniqueSlug(slugify(title, `i-${Date.now().toString(36)}`), taken)
}

/** The list card shape. */
export function insightCard(insight: InsightRecord): InsightCard {
  return {
    id: insight.id,
    title: insight.title,
    oneLiner: insight.oneLiner,
    kind: insight.kind,
    concepts: [...insight.concepts],
    tags: [...insight.tags],
    pinned: insight.pinned,
    origin: insight.origin,
    sourceCount: insight.sources.length,
    updatedAt: insight.updatedAt,
  }
}

/** Validation input for one generated insight. */
export interface InsightValidationInput {
  title: string
  oneLiner: string
  body: string
  formula?: string
  sources: readonly InsightSource[]
  concepts: readonly string[]
  /** Page ranges keyed by `<material>:<unit>`. */
  ranges: ReadonlyMap<string, { pageStart: number; pageEnd: number }>
}

/** Validate one insight; returns every issue so a repair call can fix all. */
export function validateInsight(input: InsightValidationInput): string[] {
  const issues: string[] = []
  const title = input.title.trim()
  const oneLiner = input.oneLiner.trim()
  const body = input.body.trim()
  if (title.length === 0) issues.push('缺少标题')
  if (oneLiner.length === 0) issues.push('缺少一句话本质（oneLiner）')
  if (oneLiner.length > 120) issues.push(`一句话本质过长：${oneLiner.length} > 120 字`)
  if (body.length < 20) issues.push('正文过短，至少 20 字')
  if (input.concepts.length === 0) issues.push('至少挂一个概念')
  if (input.sources.length === 0) issues.push('至少一个来源页码')
  for (const source of input.sources) {
    const range = input.ranges.get(`${source.material}:${source.unit}`)
    if (range === undefined) {
      issues.push(`来源单元不存在：${source.material}:${source.unit}`)
      continue
    }
    if (!Number.isInteger(source.page) || source.page < range.pageStart || source.page > range.pageEnd) {
      issues.push(`来源页码越界：p${source.page} 不在 ${range.pageStart}-${range.pageEnd} 之内`)
    }
  }
  if (/<script\b/i.test(`${input.body}\n${input.formula ?? ''}`)) issues.push('正文不能包含 <script>')
  return issues
}
