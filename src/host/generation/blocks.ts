/**
 * Reading-block generation.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import type { BlockFile } from '../../core/types.ts'
import { type JobContext } from '../jobs.ts'
import { blocksPrompt } from '../generate/prompts.ts'
import { StudyError } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import type { GenerateBlocksInput } from './shared.ts'
import { normalizeBlocksOutput } from './normalize.ts'

export async function generateBlocks(svc: GenerationService, input: GenerateBlocksInput): Promise<{ jobId: string }> {
  if (!(await svc.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
  await svc.deps.service.manifest(input.material)
  const job = await svc.deps.jobs.create('blocks', { material: input.material, unit: input.unit }, context =>
    svc.runBlocks(input, context),
  )
  return { jobId: job.id }
}

export async function runBlocks(svc: GenerationService, input: GenerateBlocksInput, context: JobContext): Promise<Record<string, unknown>> {
  const view = await svc.deps.service.unit(input.material, input.unit)
  const paragraphs = await svc.deps.service.layout(input.material, view.unit.pageStart, view.unit.pageEnd)
  if (paragraphs.length === 0) {
    throw new StudyError('invalid', '这一节抽取不到文字层，不能按段落分块')
  }
  const prompt = blocksPrompt({
    materialTitle: view.material.title,
    unitTitle: view.unit.title,
    pageStart: view.unit.pageStart,
    pageEnd: view.unit.pageEnd,
    paragraphs,
  })
  context.report(0.1, `正在分块（${String(paragraphs.length)} 段）…`)
  let file: BlockFile | undefined
  await svc.completeJson(context, prompt, async parsed => {
    const blocks = normalizeBlocksOutput(parsed, paragraphs.length)
    file = await svc.deps.service.writeBlocks(input.material, input.unit, blocks)
  })
  if (file === undefined) throw new StudyError('invalid', '引导卡没有写入')
  context.report(1, `已生成 ${String(file.blocks.length)} 块`)
  return { material: input.material, unit: input.unit, blocks: file.blocks.length, paragraphs: paragraphs.length }
}
