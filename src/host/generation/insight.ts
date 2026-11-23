/**
 * Insight cards, from one unit or one cross-material concept.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import { type JobContext } from '../jobs.ts'
import { conceptInsightPrompt, insightPrompt, PROMPT_VERSION } from '../generate/prompts.ts'
import { StudyError } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import type { GenerateInsightInput } from './shared.ts'
import { normalizeInsightBatch } from './normalize.ts'

export async function generateInsights(svc: GenerationService, input: GenerateInsightInput): Promise<{ jobId: string }> {
  if (!(await svc.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
  if (input.unit !== undefined && input.material !== undefined) {
    const job = await svc.deps.jobs.create('insight', { material: input.material, unit: input.unit }, context =>
      svc.runUnitInsights(input.material!, input.unit!, context),
    )
    return { jobId: job.id }
  }
  if (input.concept !== undefined) {
    const job = await svc.deps.jobs.create('insight', { concept: input.concept }, context =>
      svc.runConceptInsights(input.concept!, context),
    )
    return { jobId: job.id }
  }
  throw new StudyError('invalid', '需要指定 unit 或 concept')
}

export async function runUnitInsights(svc: GenerationService, material: string, unit: string, context: JobContext): Promise<{ ids: string[] }> {
  const ids = await svc.runUnitInsightsInternal(material, unit, context, 0.1)
  context.report(1, `已提炼 ${ids.length} 条`)
  return { ids }
}

export async function runUnitInsightsInternal(svc: GenerationService, materialId: string, unitId: string, context: JobContext, base: number): Promise<string[]> {
  const unit = await svc.deps.service.unit(materialId, unitId)
  if (unit.notes === null) throw new StudyError('invalid', '这一节还没有导读（实验），先写导读再提炼')
  const node = unit.unit
  const prompt = insightPrompt({
    materialTitle: unit.material.title,
    unitTitle: node.title,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    notes: unit.notes,
    concepts: node.concepts,
    count: 3,
  })
  context.report(base, '正在提炼洞察…')
  let ids: string[] = []
  await svc.completeJson(context, prompt, async parsed => {
    const records = normalizeInsightBatch(parsed, {
      material: materialId,
      unit: unitId,
      range: { pageStart: node.pageStart, pageEnd: node.pageEnd },
    })
    const written: string[] = []
    for (const record of records) {
      const saved = await svc.deps.insights.upsertGenerated({
        ...record,
        sourceKey: `${materialId}:${unitId}`,
        origin: 'generated',
        generatedBy: { engine: (await svc.deps.settings.current()).text.kind, promptVersion: PROMPT_VERSION, at: new Date().toISOString() },
      })
      written.push(saved.id)
    }
    ids = written
    await svc.deps.service.attachInsights(materialId, unitId, written)
  })
  return ids
}

export async function runConceptInsights(svc: GenerationService, conceptId: string, context: JobContext): Promise<{ ids: string[] }> {
  const view = await svc.deps.service.conceptView(conceptId)
  if (view.occurrences.length === 0) throw new StudyError('invalid', '这个概念还没有任何出现位置')
  const occurrences: Array<{
    materialId: string
    materialTitle: string
    unitId: string
    unitTitle: string
    page: number
    range: { pageStart: number; pageEnd: number }
    notes: string
  }> = []
  for (const occurrence of view.occurrences.slice(0, 6)) {
    const material = await svc.deps.service.unitMaterial(occurrence.materialId, occurrence.unitId, 8_000)
    const unit = await svc.deps.service.unit(occurrence.materialId, occurrence.unitId)
    occurrences.push({
      materialId: occurrence.materialId,
      materialTitle: occurrence.materialTitle,
      unitId: occurrence.unitId,
      unitTitle: occurrence.unitTitle,
      page: occurrence.page,
      range: { pageStart: material.node.pageStart, pageEnd: material.node.pageEnd },
      notes: unit.notes ?? material.text,
    })
  }
  const prompt = conceptInsightPrompt({
    concept: { id: view.concept.id, name: view.concept.name, definition: view.concept.definition },
    occurrences,
  })
  const ranges = new Map<string, { pageStart: number; pageEnd: number }>()
  for (const occurrence of occurrences) {
    ranges.set(`${occurrence.materialId}:${occurrence.unitId}`, occurrence.range)
  }
  let ids: string[] = []
  await svc.completeJson(context, prompt, async parsed => {
    const records = normalizeInsightBatch(parsed, undefined, ranges)
    const written: string[] = []
    for (const record of records) {
      const saved = await svc.deps.insights.create({
        ...record,
        origin: 'generated',
        generatedBy: { engine: (await svc.deps.settings.current()).text.kind, promptVersion: PROMPT_VERSION, at: new Date().toISOString() },
      })
      written.push(saved.id)
    }
    ids = written
  })
  context.report(1, `已合并 ${ids.length} 条`)
  return { ids }
}
