/**
 * Knowledge-point extraction for one unit.
 *
 * This is the floor of the knowledge space: without concepts a section can
 * only produce a quiz bank, not progress. It runs inline (the practice page
 * waits for it) and writes through the same concept registry the reader uses.
 */
import { conceptsPrompt, parseJsonObject } from '../generate/prompts.ts'
import { textProviderFrom } from '../providers/index.ts'
import { StudyError } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import { normalizeConcepts } from './normalize.ts'

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
  const result = await provider.complete({
    system: prompt.system,
    user: prompt.user,
    temperature: 0.2,
    maxTokens: 2000,
  })
  return normalizeConcepts(parseJsonObject(result.text), {
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
  })
}
