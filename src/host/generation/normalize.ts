/**
 * Shape checks and normalizers for model answers.
 *
 * Pure functions: they read a parsed model answer and either return typed data or
 * throw with the shape issues. They touch no files and no service.
 */
import { validateInsight } from '../../core/insights.ts'
import { bookId as makeBookId } from '../../core/books.ts'
import { assertConceptId, splitUnitKey } from '../../core/ids.ts'
import type { BlockInput, BookChapterMeta, BookRecord, BookSourceRef, InsightKind, InsightSource, MaterialManifest, PlanStepKind, PromptKind, QuizItem, QuizItemType } from '../../core/types.ts'
import { validateBlocks } from '../../core/blocks.ts'
import { StudyError } from '../service.ts'

export function issuesOf(error: unknown): string[] {
  if (error instanceof StudyError && typeof error.details === 'object' && error.details !== null) {
    const issues = (error.details as { issues?: unknown }).issues
    if (Array.isArray(issues)) return issues.map(String)
  }
  return [error instanceof Error ? error.message : String(error)]
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new StudyError('invalid', `${label} 必须是非空字符串`)
  return value.trim()
}

export function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new StudyError('invalid', `${label} 必须是数组`)
  return value
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export const PLAN_KINDS: PlanStepKind[] = ['unit', 'paper-pass', 'drill', 'compare']
export const QUIZ_TYPES: QuizItemType[] = ['recall', 'choice', 'cloze', 'apply', 'evidence']
export const INSIGHT_KINDS: InsightKind[] = ['principle', 'formula', 'contrast', 'pitfall', 'analogy', 'method']
/** Drop steps that point at units/concepts/materials the library does not have. */
export function sanitizePlanSteps(
  steps: ReadonlyArray<{
    kind: PlanStepKind
    target?: string
    concepts?: string[]
    materials?: string[]
    coverage?: 'read' | 'skim' | 'skip'
    why: string
  }>,
  validUnits: ReadonlySet<string>,
  validConcepts: ReadonlySet<string>,
  validMaterials: ReadonlySet<string>,
): {
  steps: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; coverage?: 'read' | 'skim' | 'skip'; why: string }>
  issues: string[]
} {
  const kept: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; coverage?: 'read' | 'skim' | 'skip'; why: string }> = []
  const issues: string[] = []
  steps.forEach((step, index) => {
    const label = `第 ${index + 1} 步`
    if (step.why.trim().length === 0) {
      issues.push(`${label} 缺少理由`)
      return
    }
    if (step.kind === 'unit' || step.kind === 'paper-pass') {
      if (step.target === undefined || !validUnits.has(step.target)) {
        issues.push(`${label} 指向不存在的单元：${step.target ?? '—'}`)
        return
      }
    }
    if (step.kind === 'drill') {
      const concepts = (step.concepts ?? []).filter(id => validConcepts.has(id))
      if (concepts.length === 0) {
        issues.push(`${label} 没有可用的已登记概念`)
        return
      }
      kept.push({ ...step, concepts })
      return
    }
    if (step.kind === 'compare') {
      const materials = (step.materials ?? []).filter(id => validMaterials.has(id))
      if (materials.length < 2) {
        issues.push(`${label} 没有两份有效资料`)
        return
      }
      kept.push({ ...step, materials })
      return
    }
    kept.push(step)
  })
  return { steps: kept, issues }
}

/** Normalize the plan's mastery map; throws with all shape issues. */
export function normalizePlanMastery(parsed: unknown): Array<{
  title: string
  standard: string
  target?: string
  concepts?: string[]
  level?: 1 | 2 | 3 | 4
}> {
  const body = asRecord(parsed)
  if (!Array.isArray(body.mastery)) throw new StudyError('invalid', '计划缺少掌握点（mastery）', { issues: ['mastery 必须是数组'] })
  const issues: string[] = []
  const points: Array<{ title: string; standard: string; target?: string; concepts?: string[]; level?: 1 | 2 | 3 | 4 }> = []
  body.mastery.forEach((entry, index) => {
    const row = asRecord(entry)
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const standard = typeof row.standard === 'string' ? row.standard.trim() : ''
    if (title.length === 0) issues.push(`第 ${index + 1} 个掌握点缺少 title`)
    if (standard.length === 0) issues.push(`第 ${index + 1} 个掌握点缺少 standard`)
    const point: { title: string; standard: string; target?: string; concepts?: string[]; level?: 1 | 2 | 3 | 4 } = { title, standard }
    if (typeof row.target === 'string' && row.target.includes(':')) point.target = row.target.trim()
    if (Array.isArray(row.concepts)) point.concepts = row.concepts.map(String)
    if (row.level === 1 || row.level === 2 || row.level === 3 || row.level === 4) point.level = row.level
    points.push(point)
  })
  if (points.length === 0) issues.push('mastery 为空')
  if (issues.length > 0) throw new StudyError('invalid', '掌握点结构不合法', { issues })
  return points
}

/**
 * Drop mastery points whose unit or concepts do not exist.
 *
 * A point without a real target cannot be practiced, so it is dropped rather
 * than kept as a dangling link. Unknown concept ids are filtered out; the point
 * itself survives if its target is valid.
 */
export function sanitizeMastery(
  points: ReadonlyArray<{ title: string; standard: string; target?: string; concepts?: string[]; level?: 1 | 2 | 3 | 4 }>,
  validUnits: ReadonlySet<string>,
  validConcepts: ReadonlySet<string>,
): {
  points: Array<{ title: string; standard: string; target?: string; concepts?: string[]; level?: 1 | 2 | 3 | 4 }>
  issues: string[]
} {
  const kept: Array<{ title: string; standard: string; target?: string; concepts?: string[]; level?: 1 | 2 | 3 | 4 }> = []
  const issues: string[] = []
  for (const [index, point] of points.entries()) {
    const label = `第 ${index + 1} 个掌握点`
    let target: string | undefined
    if (point.target !== undefined) {
      try {
        splitUnitKey(point.target)
      } catch {
        issues.push(`${label} 的 target 不是 <material>:<unit>：${point.target}`)
        continue
      }
      if (!validUnits.has(point.target)) {
        issues.push(`${label} 指向不存在的单元：${point.target}`)
        continue
      }
      target = point.target
    }
    const concepts = (point.concepts ?? []).filter(concept => {
      const known = validConcepts.has(concept)
      if (!known) issues.push(`${label} 指向不存在的概念：${concept}`)
      return known
    })
    if (concepts.length > 8) concepts.length = 8
    const title = point.title.trim()
    const standard = point.standard.trim()
    if (title.length === 0 || standard.length === 0) continue
    kept.push({
      title: title.slice(0, 120),
      standard: standard.slice(0, 500),
      ...(target === undefined ? {} : { target }),
      ...(concepts.length === 0 ? {} : { concepts }),
      ...(point.level === undefined ? {} : { level: point.level }),
    })
  }
  if (kept.length === 0) issues.push('没有可用的掌握点')
  return { points: kept.slice(0, 12), issues }
}

/** Normalize the plan-scoped question answer for one unit's open points. */
export function normalizeMasteryQuizItems(
  parsed: unknown,
  input: {
    points: ReadonlyArray<{ id: string; title: string; concepts: readonly string[] }>
    range: { pageStart: number; pageEnd: number }
  },
): QuizItem[] {
  const body = asRecord(parsed)
  const raw = asArray(body.items, 'items')
  const byId = new Map(input.points.map(point => [point.id, point]))
  const seen = new Set<string>()
  const items: QuizItem[] = []
  for (const entry of raw) {
    const row = asRecord(entry)
    const pointId = typeof row.point === 'string' ? row.point.trim() : ''
    const point = byId.get(pointId)
    if (point === undefined || seen.has(pointId)) continue
    const type = row.type === 'apply' || row.type === 'evidence' ? row.type : 'recall'
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    if (question.length < 6) continue
    const rubric = Array.isArray(row.rubric)
      ? row.rubric.filter((line): line is string => typeof line === 'string' && line.trim().length > 0).slice(0, 5)
      : []
    if (rubric.length === 0) continue
    const allowed = new Set(point.concepts)
    const concepts = Array.isArray(row.concepts)
      ? row.concepts.map(String).filter(concept => allowed.has(concept))
      : []
    const page = asNumber(row.page)
    const inside = page !== undefined && page >= input.range.pageStart && page <= input.range.pageEnd
    const difficulty = asNumber(row.difficulty)
    seen.add(pointId)
    items.push({
      id: `mp-${pointId}-${String(items.length + 1)}`,
      type,
      question: question.slice(0, 800),
      rubric,
      concepts: concepts.length === 0 ? [...point.concepts] : concepts,
      origin: 'generated',
      masteryPoint: pointId,
      ...(inside ? { page } : {}),
      difficulty: difficulty === 1 || difficulty === 3 ? difficulty : 2,
    })
    if (items.length >= input.points.length) break
  }
  if (items.length === 0) throw new StudyError('invalid', '模型没有给出可用的过关题，稍后重试')
  return items
}

/** Normalize a plan answer; throws with all shape issues. */
export function normalizePlanSteps(parsed: unknown): Array<{
  kind: PlanStepKind
  target?: string
  concepts?: string[]
  materials?: string[]
  coverage?: 'read' | 'skim' | 'skip'
  why: string
}> {
  const body = asRecord(parsed)
  const raw = asArray(body.steps, 'steps')
  const issues: string[] = []
  const steps: Array<{ kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; coverage?: 'read' | 'skim' | 'skip'; why: string }> = []
  raw.forEach((entry, index) => {
    const row = asRecord(entry)
    const kind = row.kind
    if (typeof kind !== 'string' || !PLAN_KINDS.includes(kind as PlanStepKind)) {
      issues.push(`第 ${index + 1} 步 kind 非法`)
      return
    }
    const why = typeof row.why === 'string' ? row.why.trim() : ''
    if (why.length === 0) issues.push(`第 ${index + 1} 步缺少 why`)
    const step: { kind: PlanStepKind; target?: string; concepts?: string[]; materials?: string[]; coverage?: 'read' | 'skim' | 'skip'; why: string } = {
      kind: kind as PlanStepKind,
      why,
    }
    if (row.coverage === 'read' || row.coverage === 'skim' || row.coverage === 'skip') step.coverage = row.coverage
    if (kind === 'unit' || kind === 'paper-pass') {
      if (typeof row.target !== 'string' || !row.target.includes(':')) issues.push(`第 ${index + 1} 步缺少 target`)
      else step.target = row.target.trim()
    } else if (kind === 'drill') {
      if (!Array.isArray(row.concepts) || row.concepts.length === 0) issues.push(`第 ${index + 1} 步缺少 concepts`)
      else step.concepts = row.concepts.map(String)
    } else if (kind === 'compare') {
      if (!Array.isArray(row.materials) || row.materials.length < 2) issues.push(`第 ${index + 1} 步 compare 至少需要两份资料`)
      else step.materials = row.materials.map(String)
    }
    steps.push(step)
  })
  if (steps.length === 0) issues.push('steps 为空')
  if (issues.length > 0) throw new StudyError('invalid', '计划结构不合法', { issues })
  return steps
}

/** Normalize the unit-notes answer. */
export function normalizeUnitOutput(parsed: unknown): {
  notes: string
  pageRefs: number[]
  concepts: Array<{ id: string; name?: string; definition?: string }>
} {
  const body = asRecord(parsed)
  const notes = asString(body.notes, 'notes')
  const pageRefs = asArray(body.pageRefs, 'pageRefs')
    .map(value => asNumber(value))
    .filter((value): value is number => value !== undefined)
  const concepts = asArray(body.concepts, 'concepts').map(entry => {
    const row = asRecord(entry)
    const id = asString(row.id, 'concept.id')
    return {
      id,
      ...(typeof row.name === 'string' && row.name.trim().length > 0 ? { name: row.name.trim() } : {}),
      ...(typeof row.definition === 'string' && row.definition.trim().length > 0 ? { definition: row.definition.trim() } : {}),
    }
  })
  return { notes, pageRefs, concepts }
}

/** Normalize the quiz answer into typed items. */
/**
 * Coerce one model answer into blocks.
 *
 * Missing ids are filled from the position so a small omission does not cost a
 * repair round; everything the reading surface depends on (coverage, lengths,
 * one question mark) is still enforced by `validateBlocks` when they are written.
 */
export function normalizeBlocksOutput(parsed: unknown, paragraphs: number): BlockInput[] {
  const root = asRecord(parsed)
  const list = asArray(root.blocks, 'blocks')
  const blocks: BlockInput[] = []
  list.forEach((entry, index) => {
    const label = `blocks[${String(index + 1)}]`
    const item = asRecord(entry)
    const startPara = Math.round(asNumber(item.startPara) ?? 0)
    const endPara = Math.round(asNumber(item.endPara) ?? startPara)
    const kind = asString(item.kind, `${label}.kind`) as PromptKind
    blocks.push({
      id: typeof item.id === 'string' && item.id.trim().length > 0 ? item.id.trim() : `b${String(index + 1)}`,
      startPara: Math.max(0, Math.min(paragraphs - 1, startPara)),
      endPara: Math.max(0, Math.min(paragraphs - 1, Math.max(startPara, endPara))),
      title: asString(item.title, `${label}.title`),
      prompt: {
        kind,
        transition: asString(item.transition, `${label}.transition`),
        question: asString(item.question, `${label}.question`),
      },
    })
  })
  return blocks
}

export function normalizeQuizItems(parsed: unknown): QuizItem[] {
  const body = asRecord(parsed)
  const raw = asArray(body.items, 'items')
  const issues: string[] = []
  const items: QuizItem[] = []
  raw.forEach((entry, index) => {
    const row = asRecord(entry)
    const typeValue = typeof row.type === 'string' ? row.type : ''
    if (!QUIZ_TYPES.includes(typeValue as QuizItemType)) {
      issues.push(`第 ${index + 1} 题 type 非法`)
      return
    }
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    if (question.length === 0) issues.push(`第 ${index + 1} 题缺少题干`)
    const concepts = Array.isArray(row.concepts) ? row.concepts.map(String) : []
    if (concepts.length === 0) issues.push(`第 ${index + 1} 题没有挂概念`)
    const item: QuizItem = {
      id: `q${index + 1}`,
      type: typeValue as QuizItemType,
      question,
      concepts,
      origin: 'generated',
      ...(asNumber(row.page) === undefined ? {} : { page: asNumber(row.page)! }),
      ...(Array.isArray(row.choices) ? { choices: row.choices.map(String) } : {}),
      ...(asNumber(row.answerIndex) === undefined ? {} : { answerIndex: asNumber(row.answerIndex)! }),
      ...(typeof row.answer === 'string' ? { answer: row.answer } : {}),
      ...(Array.isArray(row.rubric) ? { rubric: row.rubric.map(String) } : {}),
      ...(asNumber(row.difficulty) === 1 || asNumber(row.difficulty) === 2 || asNumber(row.difficulty) === 3
        ? { difficulty: asNumber(row.difficulty) as 1 | 2 | 3 }
        : {}),
      ...(typeof row.explanation === 'string' && row.explanation.trim().length > 0 ? { explanation: row.explanation.trim() } : {}),
    }
    items.push(item)
  })
  if (items.length === 0) issues.push('items 为空')
  if (issues.length > 0) throw new StudyError('invalid', '练习题结构不合法', { issues })
  return items
}

/** Normalize one or more generated insight cards. */
export function normalizeInsightBatch(
  parsed: unknown,
  unitContext?: { material: string; unit: string; range: { pageStart: number; pageEnd: number } },
  ranges?: ReadonlyMap<string, { pageStart: number; pageEnd: number }>,
): Array<{
  title: string
  oneLiner: string
  body: string
  formula?: string
  concepts: string[]
  sources: InsightSource[]
  tags: string[]
  kind: InsightKind
}> {
  const body = asRecord(parsed)
  const raw = asArray(body.insights, 'insights')
  const issues: string[] = []
  const records: Array<{
    title: string
    oneLiner: string
    body: string
    formula?: string
    concepts: string[]
    sources: InsightSource[]
    tags: string[]
    kind: InsightKind
  }> = []
  raw.forEach((entry, index) => {
    const row = asRecord(entry)
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const oneLiner = typeof row.oneLiner === 'string' ? row.oneLiner.trim() : ''
    const text = typeof row.body === 'string' ? row.body.trim() : ''
    const conceptIds = Array.isArray(row.concepts) ? row.concepts.map(String) : []
    const rawSources = Array.isArray(row.sources) ? row.sources : []
    const sources: InsightSource[] = []
    for (const source of rawSources) {
      const sourceRow = asRecord(source)
      const page = asNumber(sourceRow.page)
      if (page === undefined) continue
      const material = typeof sourceRow.material === 'string' ? sourceRow.material : unitContext?.material
      const unit = typeof sourceRow.unit === 'string' ? sourceRow.unit : unitContext?.unit
      if (material === undefined || unit === undefined) continue
      sources.push({
        material,
        unit,
        page,
        ...(typeof sourceRow.quote === 'string' && sourceRow.quote.trim().length > 0 ? { quote: sourceRow.quote.trim() } : {}),
      })
    }
    const kind = typeof row.kind === 'string' && INSIGHT_KINDS.includes(row.kind as InsightKind) ? (row.kind as InsightKind) : 'principle'
    const record = {
      title,
      oneLiner,
      body: text,
      ...(typeof row.formula === 'string' && row.formula.trim().length > 0 ? { formula: row.formula.trim() } : {}),
      concepts: conceptIds,
      sources,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      kind,
    }
    const mappedRanges = ranges ?? new Map(
      unitContext === undefined
        ? []
        : [[`${unitContext.material}:${unitContext.unit}`, unitContext.range] as const],
    )
    const validation = validateInsight({ ...record, ranges: mappedRanges })
    if (validation.length > 0) issues.push(...validation.map(issue => `第 ${index + 1} 条：${issue}`))
    records.push(record)
  })
  if (records.length === 0) issues.push('insights 为空')
  if (issues.length > 0) throw new StudyError('invalid', '洞察结构不合法', { issues })
  return records
}


/** Normalize a book outline answer into a BookRecord. */
export function normalizeBookOutline(
  parsed: unknown,
  input: {
    planId: string
    goal: string
    brief?: string
    manifests: readonly MaterialManifest[]
    taken: ReadonlySet<string>
  },
): BookRecord {
  const body = asRecord(parsed)
  const validUnits = new Set<string>()
  for (const manifest of input.manifests) {
    for (const node of manifest.structure) validUnits.add(`${manifest.id}:${node.uid}`)
  }
  const issues: string[] = []
  const title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : input.goal
  const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim() : ''
  const audience = typeof body.audience === 'string' ? body.audience.trim() : ''
  const partsRaw = Array.isArray(body.parts) ? body.parts : []
  const chapters: BookChapterMeta[] = []
  const parts: BookRecord['parts'] = []
  let order = 0
  partsRaw.forEach((partEntry, partIndex) => {
    const part = asRecord(partEntry)
    const partTitle = typeof part.title === 'string' && part.title.trim().length > 0 ? part.title.trim() : `第 ${partIndex + 1} 部分`
    const rawChapters = Array.isArray(part.chapters) ? part.chapters : []
    const chapterIds: string[] = []
    rawChapters.forEach(entry => {
      const row = asRecord(entry)
      const chapterTitle = typeof row.title === 'string' ? row.title.trim() : ''
      const sourceUnits = Array.isArray(row.sourceUnits) ? row.sourceUnits.map(String).filter(unit => validUnits.has(unit)) : []
      if (chapterTitle.length === 0) {
        issues.push(`第 ${order + 1} 章缺少标题`)
        return
      }
      if (sourceUnits.length === 0) {
        issues.push(`第 ${order + 1} 章没有有效的来源单元`)
        return
      }
      order += 1
      const id = `ch-${order}`
      chapterIds.push(id)
      chapters.push({
        id,
        order,
        title: chapterTitle,
        summary: typeof row.summary === 'string' && row.summary.trim().length > 0 ? row.summary.trim() : chapterTitle,
        objectives: Array.isArray(row.objectives) ? row.objectives.map(String).filter(Boolean) : [],
        prerequisites: Array.isArray(row.prerequisites) ? row.prerequisites.map(String).filter(Boolean) : [],
        narrativeRole: typeof row.narrativeRole === 'string' ? row.narrativeRole.trim() : '',
        sourceRefs: sourceUnits.map(unit => {
          try {
            const { materialId, unitId } = splitUnitKey(unit)
            const manifest = input.manifests.find(candidate => candidate.id === materialId)
            const node = manifest?.structure.find(candidate => candidate.uid === unitId)
            return { material: materialId, unit: unitId, pageStart: node?.pageStart ?? 1, pageEnd: node?.pageEnd ?? node?.pageStart ?? 1 }
          } catch {
            return { material: '', unit: '', pageStart: 1, pageEnd: 1 }
          }
        }).filter(ref => ref.material.length > 0),
        concepts: [],
        status: 'outline' as const,
      })
    })
    if (chapterIds.length > 0) parts.push({ id: `part-${parts.length + 1}`, title: partTitle, chapterIds })
  })
  if (chapters.length === 0) issues.push('没有任何可用章节')
  if (issues.length > 0) throw new StudyError('invalid', '自编书大纲不合法', { issues })
  const now = new Date().toISOString()
  return {
    version: 1,
    id: makeBookId(title, input.taken),
    planId: input.planId,
    title,
    ...(subtitle.length === 0 ? {} : { subtitle }),
    goal: input.goal,
    ...(audience.length === 0 ? {} : { audience }),
    status: 'outline',
    sourceMaterials: input.manifests.map(manifest => manifest.id),
    parts,
    chapters,
    createdAt: now,
    updatedAt: now,
  }
}

/** Normalize one chapter answer and enforce the narrative contract. */
export function normalizeBookChapter(
  parsed: unknown,
  chapter: BookChapterMeta,
  sources: ReadonlyArray<{ materialTitle: string; unitTitle: string; pageStart: number; pageEnd: number; text: string }>,
): {
  body: string
  summary: string
  wordCount: number
  concepts: Array<{ id: string; name?: string; definition?: string }>
  exercises: QuizItem[]
} {
  const body = asRecord(parsed)
  const issues: string[] = []
  const markdown = typeof body.body === 'string' ? body.body.trim() : ''
  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  const transition = typeof body.transition === 'string' ? body.transition.trim() : ''
  if (markdown.length < 800) issues.push(`正文过短：${markdown.length} < 800 字符`)
  if (!markdown.includes('本章小结')) issues.push('正文缺少「本章小结」')
  if (/<script\b/i.test(markdown)) issues.push('正文不能包含 <script>')
  if (summary.length === 0) issues.push('缺少章摘要')
  const conceptsRaw = Array.isArray(body.concepts) ? body.concepts : []
  const concepts: Array<{ id: string; name?: string; definition?: string }> = []
  for (const entry of conceptsRaw) {
    const row = asRecord(entry)
    const id = typeof row.id === 'string' ? row.id : ''
    try {
      assertConceptId(id)
    } catch {
      issues.push(`概念 id 非法：${id || '—'}`)
      continue
    }
    concepts.push({
      id,
      ...(typeof row.name === 'string' && row.name.trim().length > 0 ? { name: row.name.trim() } : {}),
      ...(typeof row.definition === 'string' && row.definition.trim().length > 0 ? { definition: row.definition.trim() } : {}),
    })
  }
  if (concepts.length === 0) {
    for (const id of chapter.concepts) {
      if (id.length > 0) concepts.push({ id })
    }
  }
  if (concepts.length === 0) issues.push('没有登记任何概念')
  const validSources = new Map(chapter.sourceRefs.map(ref => [`${ref.material}:${ref.unit}`, ref]))
  const sourceRefs: BookSourceRef[] = []
  const rawSources = Array.isArray(body.sourceRefs) ? body.sourceRefs : []
  for (const entry of rawSources) {
    const row = asRecord(entry)
    const material = typeof row.material === 'string' ? row.material : ''
    const unit = typeof row.unit === 'string' ? row.unit : ''
    const page = asNumber(row.page)
    const target = validSources.get(`${material}:${unit}`)
    if (target === undefined || page === undefined) continue
    if (page < target.pageStart || page > target.pageEnd) continue
    sourceRefs.push({ material, unit, pageStart: target.pageStart, pageEnd: target.pageEnd })
  }
  if (sourceRefs.length === 0) {
    for (const ref of chapter.sourceRefs) sourceRefs.push({ ...ref })
  }
  const exercises = Array.isArray(body.exercises) ? normalizeQuizItems({ items: body.exercises }) : []
  if (issues.length > 0) throw new StudyError('invalid', '章节未通过校验', { issues })
  const finalBody = transition.length === 0 ? markdown : `${markdown}\n\n${transition}\n`
  return { body: finalBody, summary, wordCount: finalBody.length, concepts, exercises }
}


/** Normalize extracted knowledge points for one unit. */
export function normalizeConcepts(
  parsed: unknown,
  range: { pageStart: number; pageEnd: number },
): Array<{ id: string; name: string; definition?: string; page?: number }> {
  const body = asRecord(parsed)
  const raw = asArray(body.concepts, 'concepts')
  const seen = new Set<string>()
  const out: Array<{ id: string; name: string; definition?: string; page?: number }> = []
  for (const entry of raw) {
    const row = asRecord(entry)
    const id = typeof row.id === 'string' ? row.id.trim().toLowerCase() : ''
    if (!/^[a-z0-9][a-z0-9/_-]*$/.test(id) || id.length > 80 || seen.has(id)) continue
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (name.length === 0 || name.length > 40) continue
    const definition =
      typeof row.definition === 'string' && row.definition.trim().length > 0
        ? row.definition.trim().slice(0, 200)
        : undefined
    const page = asNumber(row.page)
    const inside = page !== undefined && page >= range.pageStart && page <= range.pageEnd
    seen.add(id)
    out.push({
      id,
      name,
      ...(definition === undefined ? {} : { definition }),
      ...(inside ? { page: Math.round(page) } : {}),
    })
    if (out.length >= 8) break
  }
  if (out.length === 0) throw new StudyError('invalid', '模型没有抽出可用的知识点，稍后重试')
  return out
}
