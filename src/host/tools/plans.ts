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
      '创建一条跨资料学习路径。步骤只能是 unit/paper-pass（target=<material>:<unit>），每个步骤必须写 why。Host 会校验目标是否存在，不存在会返回 issues。做“针对性学习”时：先 study_library + study_concept 看清家底，再按「前置→核心」排节，并给每节写一个档位（level 1–4）。知识点属于节本身，目标不另列；建完用 study_generate action=concepts 给各节补知识点。目标的交付物与期限是结案必需项，建的时候就要写。',
    parameters: objectSchema({
      goal: { type: 'string', description: '要达成的学习目标' },
      deliverable: { type: 'string', description: '这次要交出什么；缺少交付物不能结案' },
      deadline: { type: 'string', description: '期限 YYYY-MM-DD；缺少期限不能结案' },
      audience: { type: 'string', description: '读者/受众，可选' },
      hoursPerWeek: { type: 'number', description: '每周可用小时数，可选' },
      steps: {
        type: 'array',
        items: objectSchema({
          kind: { type: 'string', enum: ['unit', 'paper-pass'] },
          target: { type: 'string', description: '<material>:<unit>，必填' },
          why: { type: 'string', description: '为什么这一步排在这里' },
          level: { type: 'number', enum: [1, 2, 3, 4], description: '这一节要到哪一档' },
        }, ['kind', 'why']),
      },
    }, ['goal', 'steps']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as {
        goal: string
        deliverable?: string
        deadline?: string
        audience?: string
        hoursPerWeek?: number
        steps: Array<{ kind: 'unit' | 'paper-pass'; target?: string; why: string; level?: 1 | 2 | 3 | 4 }>
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
      '修改一条学习路径：勾掉/取消某一步（setStepN + setStepDone）、暂停/恢复（status）、改目标（goal）、整体替换步骤（steps）、或改某一节的档位（setLevelN + setLevel）。替换后会重新校验目标是否存在。',
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
          kind: { type: 'string', enum: ['unit', 'paper-pass'] },
          target: { type: 'string', description: '<material>:<unit>，必填' },
          why: { type: 'string', description: '为什么这一步排在这里' },
          level: { type: 'number', enum: [1, 2, 3, 4], description: '这一节要到哪一档' },
        }, ['kind', 'why']),
      },
      setLevelN: { type: 'number', description: '要改档位的步骤序号，从 1 开始' },
      setLevel: { type: 'number', enum: [1, 2, 3, 4], description: '1 了解 / 2 会用 / 3 能讲 / 4 创新' },
    }, ['plan']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as {
        plan: string
        setStepN?: number
        setStepDone?: boolean
        status?: 'active' | 'paused' | 'done'
        goal?: string
        steps?: Array<{ kind: 'unit' | 'paper-pass'; target?: string; why: string; level?: 1 | 2 | 3 | 4 }>
        setLevelN?: number
        setLevel?: 1 | 2 | 3 | 4
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
            ...(input.setLevelN === undefined || input.setLevel === undefined
              ? {}
              : { setLevel: { n: input.setLevelN, level: input.setLevel } }),
          })),
        }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  return tools
}
