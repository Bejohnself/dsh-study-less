/**
 * Unit notes generation.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import { readPlan } from '../../core/plans.ts'
import { type JobContext } from '../jobs.ts'
import { unitPrompt } from '../generate/prompts.ts'
import { StudyError, type WriteUnitResult } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import { normalizeUnitOutput } from './normalize.ts'

export async function generateUnit(svc: GenerationService, input: GenerateUnitInput): Promise<{ jobId: string }> {
  if (!(await svc.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
  await svc.deps.service.manifest(input.material)
  const job = await svc.deps.jobs.create('unit', { material: input.material, unit: input.unit }, context =>
    svc.runUnit(input, context),
  )
  return { jobId: job.id }
}

export async function runUnit(svc: GenerationService, input: GenerateUnitInput, context: JobContext): Promise<Record<string, unknown>> {
  const material = await svc.deps.service.unitMaterial(input.material, input.unit, input.maxChars ?? 24_000)
  let goal: string | undefined
  let why: string | undefined
  if (input.planId !== undefined) {
    const plan = await readPlan(svc.paths, input.planId)
    const target = `${input.material}:${input.unit}`
    const step = plan?.steps.find(candidate => candidate.target === target)
    goal = plan?.goal
    why = step?.why
  }
  const prompt = unitPrompt({
    material: material.material,
    unit: {
      uid: material.node.uid,
      title: material.node.title,
      pageStart: material.node.pageStart,
      pageEnd: material.node.pageEnd,
      kind: material.node.kind,
      ...(material.node.pass === undefined ? {} : { pass: material.node.pass }),
    },
    pageText: material.text,
    existingConcepts: material.concepts,
    ...(goal === undefined ? {} : { goal }),
    ...(why === undefined ? {} : { why }),
  })
  let written: WriteUnitResult | undefined
  await svc.completeJson(context, prompt, async parsed => {
    const data = normalizeUnitOutput(parsed)
    written = await svc.deps.service.writeUnit(input.material, input.unit, data)
  })
  if (written === undefined) throw new StudyError('invalid', '精读稿没有写入')
  const settings = await svc.deps.settings.current()
  const warnings = [...written.warnings]
  let quizItems = 0
  let insightIds: string[] = []
  if (settings.study.autoQuiz) {
    try {
      const bank = await svc.runQuizInternal(input.material, input.unit, context, 0.9)
      quizItems = bank.items.length
    } catch (error) {
      warnings.push(`练习题生成失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (settings.study.autoInsight) {
    try {
      insightIds = await svc.runUnitInsightsInternal(input.material, input.unit, context, 0.94)
    } catch (error) {
      warnings.push(`洞察提炼失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  context.report(1, '完成')
  return {
    material: input.material,
    unit: input.unit,
    words: written.words,
    concepts: written.concepts,
    quizItems,
    insightIds,
    warnings,
  }
}
