/**
 * Knowledge-point extraction for one unit.
 *
 * This is the floor of the knowledge space: without concepts a section can
 * only produce a quiz bank, not progress. It runs inline when the practice page
 * waits for it, and through the plan job when a goal is created.
 */
import { conceptsPrompt, parseJsonObject } from '../generate/prompts.ts'
import { textProviderFrom } from '../providers/index.ts'
import { StudyError } from '../service.ts'
import type { JobContext } from '../jobs.ts'
import type { GenerationService } from '../generation.ts'
import { normalizeConcepts } from './normalize.ts'
import { CONCEPT_TIMEOUT_MS, completeStructured } from './shared.ts'

/** One extracted knowledge point. */
export interface ExtractedConcept {
  id: string
  name: string
  definition?: string
  page?: number
}

/** Extract 3–8 knowledge points from one unit's text. */
export async function extractConcepts(
  svc: GenerationService,
  input: { material: string; unit: string },
  context?: JobContext,
): Promise<ExtractedConcept[]> {
  if (!(await svc.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
  const unit = await svc.deps.service.unit(input.material, input.unit)
  const node = unit.unit
  const material = await svc.deps.service.unitMaterial(input.material, input.unit, 12_000)
  if (material.text.trim().length === 0) {
    throw new StudyError('invalid', '这一节抽取不到文字，先把原文导入或重切一次')
  }
  const settings = await svc.requireSettings()
  const provider = textProviderFrom(settings, svc.deps)
  const existing = (await svc.deps.service.concepts()).map(concept => concept.id)
  const prompt = conceptsPrompt({
    context: `《${unit.material.title}》·「${node.title}」`,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    source: material.text,
    existing,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONCEPT_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  context?.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await completeStructured(provider, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      maxTokens: 2_048,
      signal: controller.signal,
    })
    context?.addUsage(await svc.deps.usage.record(result.usage))
    return normalizeConcepts(parseJsonObject(result.text), {
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
    })
  } catch (error) {
    if (controller.signal.aborted) throw new StudyError('unsupported', '抽知识点超时：稍后重试')
    throw error
  } finally {
    clearTimeout(timer)
    context?.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Extract a unit's knowledge points and write them onto the section.
 *
 * Idempotent: a section that already carries points is left alone. This is the
 * only entry point the plan job, the plan page's "补知识点" and the practice
 * page share, so all three write the same list.
 */
export async function extractUnitConcepts(
  svc: GenerationService,
  input: { material: string; unit: string },
  context?: JobContext,
): Promise<{ ids: string[]; extracted: number }> {
  const unit = await svc.deps.service.unit(input.material, input.unit)
  const existing = unit.unit.concepts ?? []
  if (existing.length > 0) return { ids: existing, extracted: 0 }
  const concepts = await extractConcepts(svc, input, context)
  const ids = await svc.deps.service.writeConcepts(input.material, input.unit, concepts)
  return { ids, extracted: concepts.length }
}
