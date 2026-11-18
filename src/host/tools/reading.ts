/**
 * Reading tools: today, due queue and review ratings.
 */
import { objectSchema, refusal, renderJson, type StudyToolDefinition, type ToolContext } from './shared.ts'
import { StudyError } from '../service/error.ts'

export function readingTools({ service, extras }: ToolContext): StudyToolDefinition[] {
  const tools: StudyToolDefinition[] = []

  tools.push({
    name: 'study_today',
    description:
      '今日学习面板：到期复习、当前计划的下一步、最弱概念、今日已完成数。开始一次学习/复习会话前先调这个，然后只做三件事：复习到期、推进下一步、练一个弱概念。',
    parameters: objectSchema({}),
    output: { schema: {}, render: renderJson },
    async execute() {
      try {
        return { ok: true, ...(await service.todayView()) }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_due',
    description: '列出今天到期的复习单元（跨全部资料），按逾期程度排序。复习会话开始时先调它，再逐项复习并用 study_review 记录评级。',
    parameters: objectSchema({}),
    output: { schema: {}, render: renderJson },
    async execute() {
      try {
        return { ok: true, due: await service.due() }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_review',
    description:
      '记录一个单元本次复习的评级（1 重来 / 2 困难 / 3 良好 / 4 简单），可附客观题得分（0-1）。Host 会据此更新 FSRS 状态与下次到期日。',
    parameters: objectSchema({
      material: { type: 'string' },
      unit: { type: 'string' },
      rating: { type: 'number', enum: [1, 2, 3, 4] },
      quizScore: { type: 'number', description: '0-1，可选' },
    }, ['material', 'unit', 'rating']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as { material: string; unit: string; rating: Rating; quizScore?: number }
      try {
        return { ok: true, ...(await service.review(input.material, input.unit, input)) }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  return tools
}
