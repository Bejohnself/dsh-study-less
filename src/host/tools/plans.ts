/**
 * Goal tools: list, create and update a learning path.
 */
import { objectSchema, refusal, renderJson, type StudyToolDefinition, type ToolContext } from './shared.ts'
import { StudyError } from '../service/error.ts'

export function plansTools({ service, extras }: ToolContext): StudyToolDefinition[] {
  const tools: StudyToolDefinition[] = []

  tools.push({
    name: 'study_plans',
    description: '列出所有学习路径及其进度、下一步。用户问“我的学习计划”“接下来按什么顺序学”时调用。',
    parameters: objectSchema({}),
    output: { schema: {}, render: renderJson },
    async execute() {
      try {
        return { ok: true, plans: await service.planList() }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_plan_create',
    description:
      '创建一条跨资料学习路径。步骤只能是：unit/paper-pass（target=<material>:<unit>）、drill（concepts=[概念 id]）、compare（materials=[资料 id]）。每个步骤必须写 why。Host 会校验目标是否存在，不存在会返回 issues。做“针对性学习”时：先 study_library + study_concept 看清家底，再排「前置→核心→论文证据→对比→练习」。',
    parameters: objectSchema({
      goal: { type: 'string', description: '要达成的学习目标' },
      hoursPerWeek: { type: 'number', description: '每周可用小时数，可选' },
      steps: {
        type: 'array',
        items: objectSchema({
          kind: { type: 'string', enum: ['unit', 'paper-pass', 'drill', 'compare'] },
          target: { type: 'string', description: '<material>:<unit>，unit/paper-pass 必填' },
          concepts: { type: 'array', items: { type: 'string' }, description: 'drill 步骤的概念 id' },
          materials: { type: 'array', items: { type: 'string' }, description: 'compare 步骤的资料 id' },
          why: { type: 'string', description: '为什么这一步排在这里' },
        }, ['kind', 'why']),
      },
    }, ['goal', 'steps']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as {
        goal: string
        hoursPerWeek?: number
        steps: Array<{ kind: 'unit' | 'paper-pass' | 'drill' | 'compare'; target?: string; concepts?: string[]; materials?: string[]; why: string }>
      }
      try {
        return { ok: true, ...(await service.createPlan(input)) }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_plan_update',
    description:
      '修改一条学习路径：勾掉/取消某一步（setStepN + setStepDone）、暂停/恢复（status）、改目标（goal）、或整体替换步骤（steps）。替换后会重新校验目标是否存在。',
    parameters: objectSchema({
      plan: { type: 'string', description: '计划 id' },
      setStepN: { type: 'number', description: '要改的步骤序号，从 1 开始' },
      setStepDone: { type: 'boolean' },
      status: { type: 'string', enum: ['active', 'paused', 'done'] },
      goal: { type: 'string' },
      steps: {
        type: 'array',
        description: '整体替换步骤',
        items: objectSchema({
          kind: { type: 'string', enum: ['unit', 'paper-pass', 'drill', 'compare'] },
          target: { type: 'string', description: '<material>:<unit>，unit/paper-pass 必填' },
          concepts: { type: 'array', items: { type: 'string' }, description: 'drill 步骤的概念 id' },
          materials: { type: 'array', items: { type: 'string' }, description: 'compare 步骤的资料 id' },
          why: { type: 'string', description: '为什么这一步排在这里' },
        }, ['kind', 'why']),
      },
    }, ['plan']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as {
        plan: string
        setStepN?: number
        setStepDone?: boolean
        status?: 'active' | 'paused' | 'done'
        goal?: string
        steps?: Array<{ kind: 'unit' | 'paper-pass' | 'drill' | 'compare'; target?: string; concepts?: string[]; materials?: string[]; why: string }>
      }
      try {
        return {
          ok: true,
          ...(await service.updatePlan(input.plan, {
            ...(input.setStepN !== undefined && input.setStepDone !== undefined
              ? { setStep: { n: input.setStepN, done: input.setStepDone } }
              : {}),
            ...(input.status === undefined ? {} : { setStatus: input.status }),
            ...(input.goal === undefined ? {} : { setGoal: input.goal }),
            ...(input.steps === undefined ? {} : { replaceSteps: input.steps }),
          })),
        }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  return tools
}
