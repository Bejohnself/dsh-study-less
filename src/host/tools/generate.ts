/**
 * Generation and practice tools: inline generation, jobs, quiz sessions and books.
 */
import { objectSchema, refusal, renderJson, type StudyToolDefinition, type ToolContext } from './shared.ts'
import { StudyError } from '../service/error.ts'

export function generateTools({ service, extras }: ToolContext): StudyToolDefinition[] {
  const tools: StudyToolDefinition[] = []

  if (extras.generation !== undefined) {
    const generation = extras.generation
    tools.push({
      name: 'study_generate',
      description:
        '在页面内用已配置的文本引擎生成内容，不再把 prompt 发进聊天。action=plan 编排路径；concepts 给一节补齐知识点；unit 生成/重写精读稿（顺带出题）；quiz 生成练习题。plan/unit/quiz 返回 jobId，用 study_jobs 或页面轮询进度；concepts 同步返回写入的概念。未配置引擎时请在设置里配置，或让用户回到对话。',
      parameters: objectSchema({
        action: { type: 'string', enum: ['plan', 'concepts', 'unit', 'quiz'] },
        goal: { type: 'string', description: 'plan 的目标' },
        deliverable: { type: 'string', description: 'plan 要交出的东西（目标边界的依据）' },
        deadline: { type: 'string', description: 'plan 的期限 YYYY-MM-DD（必填）' },
        audience: { type: 'string', description: 'plan 的读者/受众' },
        brief: { type: 'string', description: 'plan 的补充说明' },
        materials: { type: 'array', items: { type: 'string' }, description: 'plan 选中的资料 id' },
        hoursPerWeek: { type: 'number' },
        depth: { type: 'string', enum: ['deep', 'overview'] },
        material: { type: 'string', description: 'unit/quiz 的资料 id' },
        unit: { type: 'string', description: 'unit/quiz 的单元 uid' },
        planId: { type: 'string', description: 'unit 可附带路径上下文' },
      }, ['action']),
      output: { schema: {}, render: renderJson },
      async execute(args) {
        const input = args as {
          action: 'plan' | 'concepts' | 'unit' | 'quiz'
          goal?: string
          deliverable?: string
          deadline?: string
          audience?: string
          brief?: string
          materials?: string[]
          hoursPerWeek?: number
          depth?: 'deep' | 'overview'
          material?: string
          unit?: string
          planId?: string
        }
        try {
          if (input.action === 'plan') {
            if (input.goal === undefined || input.materials === undefined || input.materials.length === 0) {
              throw new StudyError('invalid', 'plan 需要 goal 与 materials')
            }
            if (input.deadline === undefined || input.deadline.trim().length === 0) {
              throw new StudyError('invalid', 'plan 需要 deadline（期限必填）')
            }
            return {
              ok: true,
              ...(await generation.generatePlan({
                goal: input.goal,
                materials: input.materials,
                ...(input.deliverable === undefined ? {} : { deliverable: input.deliverable }),
                deadline: input.deadline,
                ...(input.audience === undefined ? {} : { audience: input.audience }),
                ...(input.brief === undefined ? {} : { brief: input.brief }),
                ...(input.hoursPerWeek === undefined ? {} : { hoursPerWeek: input.hoursPerWeek }),
                ...(input.depth === undefined ? {} : { depth: input.depth }),
              })),
            }
          }
          if (input.action === 'concepts') {
            if (input.material === undefined || input.unit === undefined) {
              throw new StudyError('invalid', 'concepts 需要 material 与 unit')
            }
            return {
              ok: true,
              ...(await generation.extractUnitConcepts({ material: input.material, unit: input.unit })),
            }
          }
          if (input.action === 'unit') {
            if (input.material === undefined || input.unit === undefined) throw new StudyError('invalid', 'unit 需要 material 与 unit')
            return {
              ok: true,
              ...(await generation.generateUnit({
                material: input.material,
                unit: input.unit,
                ...(input.planId === undefined ? {} : { planId: input.planId }),
              })),
            }
          }
          if (input.action === 'quiz') {
            if (input.material === undefined || input.unit === undefined) throw new StudyError('invalid', 'quiz 需要 material 与 unit')
            return { ok: true, ...(await generation.generateQuiz({ material: input.material, unit: input.unit })) }
          }
          throw new StudyError('invalid', `未知 action：${String(input.action)}`)
        } catch (error) {
          return refusal(error)
        }
      },
    })
  }

  if (extras.jobs !== undefined) {
    const jobs = extras.jobs
    tools.push({
      name: 'study_jobs',
      description:
        '查看页面内生成任务：list 最近任务；get 查一个 job；cancel 取消。study_generate 返回 jobId 后用它轮询；done 的 result 里有产出摘要。',
      parameters: objectSchema({
        action: { type: 'string', enum: ['list', 'get', 'cancel'] },
        id: { type: 'string' },
      }, ['action']),
      output: { schema: {}, render: renderJson },
      async execute(args) {
        const input = args as { action: 'list' | 'get' | 'cancel'; id?: string }
        try {
          if (input.action === 'list') return { ok: true, jobs: await jobs.list(20) }
          if (input.id === undefined) throw new StudyError('invalid', '需要 id')
          if (input.action === 'cancel') return { ok: true, job: await jobs.cancel(input.id) }
          return { ok: true, job: await jobs.get(input.id) }
        } catch (error) {
          return refusal(error)
        }
      },
    })
  }

  if (extras.quizSessions !== undefined) {
    const sessions = extras.quizSessions
    tools.push({
      name: 'study_quiz',
      description:
        '自适应练习：start 开始或接着上次的一组题（同一节默认续答；restart=true 重开），answer 提交当前题并拿下一题（主观题有文本引擎时由 AI 按 rubric 判分，无引擎才要 selfGrade），appeal 提交 rebuttal 由 AI 综合原答案重判（可多次，最后一次为准），finish 提前结束，get 查看会话与回答历史。题目提交前不会暴露答案。',
      parameters: objectSchema({
        action: { type: 'string', enum: ['start', 'answer', 'appeal', 'finish', 'get'] },
        mid: { type: 'string' },
        uid: { type: 'string' },
        sid: { type: 'string' },
        itemId: { type: 'string' },
        answer: {},
        selfGrade: { type: 'string', description: 'answer 无引擎时的自评；appeal 时仅作为读者主张，不直接改判', enum: ['correct', 'partial', 'wrong'] },
        reason: { type: 'string', description: 'appeal 的 rebuttal：补上漏掉的要点或指出判分错误' },
        limit: { type: 'number' },
        restart: { type: 'boolean', description: 'true 时结束这一节旧的活跃组并开新组' },
      }, ['action']),
      output: { schema: {}, render: renderJson },
      async execute(args) {
        const input = args as {
          action: 'start' | 'answer' | 'appeal' | 'finish' | 'get'
          mid?: string
          uid?: string
          sid?: string
          itemId?: string
          answer?: unknown
          selfGrade?: 'correct' | 'partial' | 'wrong'
          reason?: string
          limit?: number
          restart?: boolean
        }
        try {
          if (input.action === 'start') {
            if (input.mid === undefined || input.uid === undefined) {
              throw new StudyError('invalid', 'start 需要 mid 与 uid')
            }
            return {
              ok: true,
              ...(await sessions.start({
                ...(input.mid === undefined ? {} : { material: input.mid }),
                ...(input.uid === undefined ? {} : { unit: input.uid }),
                ...(input.limit === undefined ? {} : { limit: input.limit }),
                ...(input.restart === true ? { restart: true } : {}),
              })),
            }
          }
          if (input.sid === undefined) throw new StudyError('invalid', '需要 sid')
          if (input.action === 'get') return { ok: true, ...(await sessions.get(input.sid)) }
          if (input.action === 'finish') return { ok: true, ...(await sessions.finish(input.sid)) }
          if (input.itemId === undefined) throw new StudyError('invalid', 'answer 需要 itemId')
          if (input.action === 'appeal') {
            if (input.reason === undefined) throw new StudyError('invalid', 'appeal 需要 reason')
            return {
              ok: true,
              ...(await sessions.appeal(input.sid, input.itemId, input.reason, input.selfGrade)),
            }
          }
          return {
            ok: true,
            ...(await sessions.answer(input.sid, input.itemId, input.answer, input.selfGrade)),
          }
        } catch (error) {
          return refusal(error)
        }
      },
    })
  }

  if (extras.books !== undefined && extras.generation !== undefined) {
    const books = extras.books
    const generation = extras.generation
    tools.push({
      name: 'study_book',
      description:
        '自编书：list 某条路径的书；get 看书封面/目录；chapter 读一章；outline 从路径编译大纲；generate-chapter 生成一章；continuity 做全书统稿检查；export 导出 Markdown；delete 删除书。生成会返回 jobId，用 study_jobs 查进度。',
      parameters: objectSchema({
        action: { type: 'string', enum: ['list', 'get', 'chapter', 'outline', 'generate-chapter', 'continuity', 'export', 'delete'] },
        pid: { type: 'string' },
        bid: { type: 'string' },
        cid: { type: 'string' },
      }, ['action']),
      output: { schema: {}, render: renderJson },
      async execute(args) {
        const input = args as { action: string; pid?: string; bid?: string; cid?: string }
        try {
          if (input.action === 'list') return { ok: true, books: await books.list(input.pid) }
          if (input.action === 'outline') {
            if (input.pid === undefined) throw new StudyError('invalid', 'outline 需要 pid')
            return { ok: true, ...(await generation.generateBookOutline(input.pid)) }
          }
          if (input.bid === undefined) throw new StudyError('invalid', '需要 bid')
          if (input.action === 'get') return { ok: true, ...(await books.get(input.bid)) }
          if (input.action === 'export') return { ok: true, markdown: await books.exportMarkdown(input.bid) }
          if (input.action === 'delete') return { ok: true, ...(await books.delete(input.bid)) }
          if (input.action === 'continuity') return { ok: true, ...(await generation.generateBookContinuity(input.bid)) }
          if (input.cid === undefined) throw new StudyError('invalid', '需要 cid')
          if (input.action === 'chapter') return { ok: true, ...(await books.chapter(input.bid, input.cid)) }
          if (input.action === 'generate-chapter') return { ok: true, ...(await generation.generateBookChapter(input.bid, input.cid)) }
          throw new StudyError('invalid', `未知 action：${input.action}`)
        } catch (error) {
          return refusal(error)
        }
      },
    })
  }

  return tools
}
