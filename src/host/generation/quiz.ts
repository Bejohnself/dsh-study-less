/**
 * Quiz generation for one unit.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import type { QuizBank } from '../../core/types.ts'
import { type JobContext } from '../jobs.ts'
import { quizPrompt } from '../generate/prompts.ts'
import { StudyError } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import { normalizeQuizItems } from './normalize.ts'

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
  if (unit.notes === null) throw new StudyError('invalid', '这一节还没有导读（实验），先写导读再出题')
  const node = unit.unit
  const prompt = quizPrompt({
    materialTitle: unit.material.title,
    unitTitle: node.title,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    notes: unit.notes,
    concepts: node.concepts,
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
