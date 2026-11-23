/**
 * Quiz generation for one unit.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import type { QuizBank, QuizItem } from '../../core/types.ts'
import { type JobContext } from '../jobs.ts'
import { parseJsonObject, quizPrompt } from '../generate/prompts.ts'
import { textProviderFrom } from '../providers/index.ts'
import { StudyError } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import type { GenerateQuizInput } from './shared.ts'
import { normalizeQuizItems } from './normalize.ts'
import { QUIZ_WRITE_TIMEOUT_MS, completeStructured } from './shared.ts'

export async function generateQuiz(svc: GenerationService, input: GenerateQuizInput): Promise<{ jobId: string }> {
  if (!(await svc.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
  const job = await svc.deps.jobs.create('quiz', { material: input.material, unit: input.unit }, context =>
    svc.runQuiz(input.material, input.unit, context),
  )
  return { jobId: job.id }
}

export async function runQuiz(svc: GenerationService, material: string, unit: string, context: JobContext): Promise<{ items: number }> {
  const bank = await svc.runQuizInternal(material, unit, context, 0.1)
  context.report(1, `已生成 ${bank.items.length} 题`)
  return { items: bank.items.length }
}

export async function runQuizInternal(svc: GenerationService, materialId: string, unitId: string, context: JobContext, base: number): Promise<QuizBank> {
  const unit = await svc.deps.service.unit(materialId, unitId)
  const node = unit.unit
  // A quiz does not need a 导读: without one, the original pages are the basis.
  const material = await svc.deps.service.unitMaterial(materialId, unitId, 24_000)
  if ((unit.notes ?? '').trim().length === 0 && material.text.trim().length === 0) {
    throw new StudyError('invalid', '这一节抽取不到文字，暂时出不了题')
  }
  const prompt = quizPrompt({
    materialTitle: unit.material.title,
    unitTitle: node.title,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    ...(unit.notes === null ? {} : { notes: unit.notes }),
    source: material.text,
    concepts: [...new Set([...(node.concepts ?? []), ...material.concepts])],
    count: 5,
  })
  context.report(base, '正在出题…')
  let bank: QuizBank | undefined
  await svc.completeJson(context, prompt, async parsed => {
    const items = normalizeQuizItems(parsed)
    bank = await svc.deps.service.writeQuiz(materialId, unitId, items)
  })
  if (bank === undefined) throw new StudyError('invalid', '练习题没有写入')
  return bank
}

/** Input of an on-demand top-up for one active session. */
export interface MoreQuizItemsInput {
  material: string
  unit: string
  count: number
  /** Knowledge points still pending; the new items must cover them. */
  focus?: readonly string[]
  /** Questions already asked, so the top-up does not write them again. */
  avoid?: readonly string[]
}

/**
 * Write 1–3 extra questions for the points still pending in an active session.
 *
 * Not queued: the runner is waiting for the next item, and the round is short.
 * The caller appends these to the unit bank, so a later run can reuse them.
 */
export async function moreQuizItems(svc: GenerationService, input: MoreQuizItemsInput): Promise<QuizItem[]> {
  if (!(await svc.textReady())) return []
  const unit = await svc.deps.service.unit(input.material, input.unit)
  const node = unit.unit
  const material = await svc.deps.service.unitMaterial(input.material, input.unit, 24_000)
  if ((unit.notes ?? '').trim().length === 0 && material.text.trim().length === 0) return []
  const prompt = quizPrompt({
    materialTitle: unit.material.title,
    unitTitle: node.title,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    ...(unit.notes === null ? {} : { notes: unit.notes }),
    source: material.text,
    concepts: [...new Set([...(node.concepts ?? []), ...material.concepts])],
    count: input.count,
    ...(input.focus === undefined || input.focus.length === 0 ? {} : { focus: input.focus }),
    ...(input.avoid === undefined || input.avoid.length === 0 ? {} : { avoid: input.avoid }),
  })
  const settings = await svc.requireSettings()
  const provider = textProviderFrom(settings, svc.deps)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), QUIZ_WRITE_TIMEOUT_MS)
  try {
    const result = await completeStructured(provider, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.4,
      maxTokens: 4_096,
      signal: controller.signal,
    })
    await svc.deps.usage.record(result.usage)
    return normalizeQuizItems(parseJsonObject(result.text)).slice(0, input.count)
  } catch (error) {
    if (controller.signal.aborted) throw new StudyError('unsupported', '补题超时：稍后再试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
