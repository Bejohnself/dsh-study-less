/**
 * Agent tools of the study desk.
 *
 * Definitions are plain ToolDefinition-shaped objects (name, description, JSON
 * Schema parameters, canonical JSON output and a renderer), so no runtime
 * dependency on the tool SDK is needed. Domain refusals are returned as values
 * the model can read and fix, not thrown as opaque errors.
 */
import type { Rating, StructureNode } from '../core/types.ts'
import type { BookService } from './books.ts'
import type { GenerationService } from './generation.ts'
import type { InsightService } from './insights.ts'
import type { JobQueue } from './jobs.ts'
import type { QuizSessionService } from './quizSessions.ts'
import { StudyError, type StudyService } from './service.ts'

/** Minimal ToolDefinition shape the Host registry accepts. */
export interface StudyToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  execute(args: unknown, exec: { signal?: AbortSignal }): Promise<unknown>
}

/** Render a canonical value as pretty JSON for the model. */
function renderJson(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** Refusal value returned instead of throwing for expected domain errors. */
function refusal(error: unknown): Record<string, unknown> {
  if (error instanceof StudyError) {
    return { ok: false, code: error.code, message: error.message, details: error.details ?? null }
  }
  throw error
}

/** Object JSON Schema helper. */
function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

/**
 * Build every tool the study desk registers.
 * @param service - the live study service.
 * @param extras - optional generation/insight services.
 */
export function buildStudyTools(
  service: StudyService,
  extras: { generation?: GenerationService; insights?: InsightService; jobs?: JobQueue; quizSessions?: QuizSessionService; books?: BookService } = {},
): StudyToolDefinition[] {
  const tools: StudyToolDefinition[] = []

  tools.push({
    name: 'study_library',
    description:
      '列出学习库里的所有资料（书/论文/文章）：id、类型、标题、作者、页数、单元数、已学单元数、到期数、生成状态。当用户问“我有哪些书/论文”“下一步学什么”时先调这个。',
    parameters: objectSchema({}),
    output: { schema: {}, render: renderJson },
    async execute() {
      try {
        return { ok: true, materials: await service.library() }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_import_book',
    description:
      '导入一本 PDF（书籍或论文）到学习库：抽取目录、按页切片、生成学习单元。返回资料 id、类型、页数、单元列表预览。导入后可调用 study_structure_set 修正目录，再用 study_unit_material / study_unit_write 逐节生成精读稿。',
    parameters: objectSchema({
      path: { type: 'string', description: '本地 PDF 的绝对路径' },
      type: { type: 'string', enum: ['book', 'paper', 'article'], description: '资料类型；省略则自动判断' },
      title: { type: 'string', description: '显示标题；省略则用文件名' },
    }, ['path']),
    output: { schema: {}, render: renderJson },
    async execute(args, exec) {
      const input = args as { path: string; type?: 'book' | 'paper' | 'article'; title?: string }
      try {
        const result = await service.import({
          filePath: input.path,
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(exec.signal === undefined ? {} : { signal: exec.signal }),
        })
        return {
          ok: true,
          material: {
            id: result.manifest.id,
            type: result.manifest.type,
            title: result.manifest.title,
            pages: result.manifest.source.pages,
            units: result.manifest.structure.map(node => ({
              uid: node.uid,
              title: node.title,
              kind: node.kind,
              ...(node.pass === undefined ? {} : { pass: node.pass }),
              pageStart: node.pageStart,
              pageEnd: node.pageEnd,
            })),
          },
          warnings: result.warnings,
          extraction: result.extraction,
        }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_structure_set',
    description:
      '替换一份资料的学习单元结构（用于修正导入时的目录识别）。单元必须按阅读顺序排列，页码范围不能重叠且必须落在 1..总页数内。教材按小节，论文保留 p1/p2/p3 三遍法单元。',
    parameters: objectSchema({
      material: { type: 'string', description: '资料 id' },
      units: {
        type: 'array',
        description: '完整的新结构',
        items: objectSchema({
          uid: { type: 'string', description: '小写 slug，节内唯一' },
          title: { type: 'string' },
          kind: { type: 'string', enum: ['section', 'pass'] },
          pass: { type: 'number' },
          pageStart: { type: 'number' },
          pageEnd: { type: 'number' },
        }, ['uid', 'title', 'kind', 'pageStart', 'pageEnd']),
      },
    }, ['material', 'units']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as { material: string; units: StructureNode[] }
      try {
        const manifest = await service.structureSet(input.material, input.units)
        return {
          ok: true,
          material: manifest.id,
          units: manifest.structure.map(node => ({ uid: node.uid, title: node.title, pageStart: node.pageStart, pageEnd: node.pageEnd })),
        }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_unit_material',
    description:
      '取一个学习单元的原文材料（按页标注，默认最多 12000 字）与写作检查表，供你写精读稿。返回 pageStart/pageEnd，所有页码引用必须落在这个区间内。',
    parameters: objectSchema({
      material: { type: 'string' },
      unit: { type: 'string' },
      maxChars: { type: 'number', description: '最多返回多少字，默认 12000' },
    }, ['material', 'unit']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as { material: string; unit: string; maxChars?: number }
      try {
        const material = await service.unitMaterial(input.material, input.unit, input.maxChars)
        return {
          ok: true,
          material: input.material,
          unit: input.unit,
          title: material.node.title,
          pageStart: material.node.pageStart,
          pageEnd: material.node.pageEnd,
          text: material.text,
          truncated: material.truncated,
          existingConcepts: material.concepts,
          existingNotes: material.existingNotes,
          requiredHeadings: ['本节目标', '前置知识', '核心概念', '逐步讲解', '类比', '常见误区', '自测', '出处'],
        }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_unit_write',
    description:
      '写入一个单元的精读稿（Markdown）与概念。硬性要求：包含全部固定小节、正文≥400 字、页码引用在单元范围内、每个概念 id 形如 consensus/raft 并带名称；公式一律写 LaTeX（行内 $...$，独立 $$...$$），不要用 √、ᵀ、∑ 等 Unicode 字符拼公式。未通过校验会返回 issues 列表，修好后重试即可。',
    parameters: objectSchema({
      material: { type: 'string' },
      unit: { type: 'string' },
      notes: { type: 'string', description: '完整 Markdown 精读稿' },
      pageRefs: { type: 'array', items: { type: 'number' }, description: '正文引用到的原书页码' },
      concepts: {
        type: 'array',
        description: '本节引入的概念（全局唯一 id）',
        items: objectSchema({
          id: { type: 'string', description: '形如 consensus/log-replication' },
          name: { type: 'string' },
          definition: { type: 'string' },
        }, ['id']),
      },
    }, ['material', 'unit', 'notes', 'pageRefs', 'concepts']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as {
        material: string
        unit: string
        notes: string
        pageRefs: number[]
        concepts: Array<{ id: string; name?: string; definition?: string }>
      }
      try {
        return { ok: true, ...(await service.writeUnit(input.material, input.unit, input)) }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_unit_verify',
    description:
      '记录对某一节精读稿的独立校验结论。verdict=pass 才会在阅读器里标为“已校验”。校验要点：论断是否有原文支撑、页码是否正确、概念是否漏写、是否只是复述原文。',
    parameters: objectSchema({
      material: { type: 'string' },
      unit: { type: 'string' },
      verdict: { type: 'string', enum: ['pass', 'fail'] },
      issues: { type: 'array', items: { type: 'string' } },
    }, ['material', 'unit', 'verdict']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as { material: string; unit: string; verdict: 'pass' | 'fail'; issues?: string[] }
      try {
        return { ok: true, ...(await service.verifyUnit(input.material, input.unit, input)) }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  tools.push({
    name: 'study_concept_link',
    description:
      '创建或补充一个全局概念：名称、定义、别名、前置/相关概念，以及在资料中的出现位置。跨资料的概念共用同一个 id，这样阅读器能从概念跳到任意一本书/论文的对应页。',
    parameters: objectSchema({
      id: { type: 'string', description: '形如 consensus/raft' },
      name: { type: 'string' },
      definition: { type: 'string' },
      aliases: { type: 'array', items: { type: 'string' } },
      prereqOf: { type: 'array', items: { type: 'string' } },
      related: { type: 'array', items: { type: 'string' } },
      occurrences: {
        type: 'array',
        items: objectSchema({
          material: { type: 'string' },
          unit: { type: 'string' },
          page: { type: 'number' },
          role: { type: 'string', enum: ['definition', 'method', 'evidence', 'critique', 'use'] },
        }, ['material', 'unit', 'page', 'role']),
      },
    }, ['id', 'name']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as {
        id: string
        name: string
        definition?: string
        aliases?: string[]
        prereqOf?: string[]
        related?: string[]
        occurrences?: Array<{ material: string; unit: string; page: number; role: 'definition' | 'method' | 'evidence' | 'critique' | 'use' }>
      }
      try {
        const { upsertConcept } = await import('../core/concepts.ts')
        const record = await upsertConcept(service.paths, input)
        return { ok: true, concept: record }
      } catch (error) {
        return refusal(error)
      }
    },
  })

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

  tools.push({
    name: 'study_concept',
    description: '查看一个概念：定义、掌握度、在每份资料的具体位置（可跳转）。做前置缺口分析、判断“这个概念他到底会不会”时用。',
    parameters: objectSchema({ id: { type: 'string', description: '概念 id，如 consensus/raft' } }),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as { id: string }
      try {
        return { ok: true, ...(await service.conceptView(input.id)) }
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

  if (extras.generation !== undefined) {
    const generation = extras.generation
    tools.push({
      name: 'study_generate',
      description:
        '在页面内用已配置的文本引擎生成内容，不再把 prompt 发进聊天。action=plan 编排路径；unit 生成/重写精读稿（可顺带出题与洞察）；quiz 生成练习题；insight 从单元或概念提炼洞察。返回 jobId，用 study_jobs 或页面轮询进度；未配置引擎时请在设置里配置，或让用户回到对话。',
      parameters: objectSchema({
        action: { type: 'string', enum: ['plan', 'unit', 'quiz', 'insight'] },
        goal: { type: 'string', description: 'plan 的目标' },
        brief: { type: 'string', description: 'plan 的补充说明' },
        materials: { type: 'array', items: { type: 'string' }, description: 'plan 选中的资料 id' },
        hoursPerWeek: { type: 'number' },
        depth: { type: 'string', enum: ['deep', 'overview'] },
        material: { type: 'string', description: 'unit/quiz/insight 的资料 id' },
        unit: { type: 'string', description: 'unit/quiz/insight 的单元 uid' },
        planId: { type: 'string', description: 'unit 可附带路径上下文' },
        concept: { type: 'string', description: 'insight 可改为跨资料合并一个概念' },
      }, ['action']),
      output: { schema: {}, render: renderJson },
      async execute(args) {
        const input = args as {
          action: 'plan' | 'unit' | 'quiz' | 'insight'
          goal?: string
          brief?: string
          materials?: string[]
          hoursPerWeek?: number
          depth?: 'deep' | 'overview'
          material?: string
          unit?: string
          planId?: string
          concept?: string
        }
        try {
          if (input.action === 'plan') {
            if (input.goal === undefined || input.materials === undefined || input.materials.length === 0) {
              throw new StudyError('invalid', 'plan 需要 goal 与 materials')
            }
            return {
              ok: true,
              ...(await generation.generatePlan({
                goal: input.goal,
                materials: input.materials,
                ...(input.brief === undefined ? {} : { brief: input.brief }),
                ...(input.hoursPerWeek === undefined ? {} : { hoursPerWeek: input.hoursPerWeek }),
                ...(input.depth === undefined ? {} : { depth: input.depth }),
              })),
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
          if (input.concept !== undefined) {
            return { ok: true, ...(await generation.generateInsights({ concept: input.concept })) }
          }
          if (input.material === undefined || input.unit === undefined) {
            throw new StudyError('invalid', 'insight 需要 material+unit 或 concept')
          }
          return {
            ok: true,
            ...(await generation.generateInsights({ material: input.material, unit: input.unit })),
          }
        } catch (error) {
          return refusal(error)
        }
      },
    })
  }

  if (extras.insights !== undefined) {
    const insights = extras.insights
    const sourceSchema = objectSchema({
      material: { type: 'string' },
      unit: { type: 'string' },
      page: { type: 'number' },
      quote: { type: 'string' },
    }, ['material', 'unit', 'page'])
    tools.push({
      name: 'study_insight',
      description:
        '「大道至简」洞察卡：list/get/create/update/pin/delete。创建时必须给 title、oneLiner、body、concepts 与 sources；sources.page 必须落在该单元页码范围内。洞察是跨资料总结，不是精读稿的替代。',
      parameters: objectSchema({
        action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'pin', 'delete'] },
        id: { type: 'string' },
        title: { type: 'string' },
        oneLiner: { type: 'string' },
        body: { type: 'string' },
        formula: { type: 'string' },
        concepts: { type: 'array', items: { type: 'string' } },
        sources: { type: 'array', items: sourceSchema },
        tags: { type: 'array', items: { type: 'string' } },
        kind: { type: 'string', enum: ['principle', 'formula', 'contrast', 'pitfall', 'analogy', 'method'] },
        pinned: { type: 'boolean' },
      }, ['action']),
      output: { schema: {}, render: renderJson },
      async execute(args) {
        const input = args as {
          action: 'list' | 'get' | 'create' | 'update' | 'pin' | 'delete'
          id?: string
          title?: string
          oneLiner?: string
          body?: string
          formula?: string
          concepts?: string[]
          sources?: Array<{ material: string; unit: string; page: number; quote?: string }>
          tags?: string[]
          kind?: 'principle' | 'formula' | 'contrast' | 'pitfall' | 'analogy' | 'method'
          pinned?: boolean
        }
        try {
          if (input.action === 'list') return { ok: true, insights: await insights.cards() }
          if (input.id === undefined) throw new StudyError('invalid', '需要 id')
          if (input.action === 'get') return { ok: true, ...(await insights.view(input.id)) }
          if (input.action === 'delete') return { ok: true, ...(await insights.remove(input.id)) }
          if (input.action === 'pin') {
            if (input.pinned === undefined) throw new StudyError('invalid', 'pin 需要 pinned')
            return { ok: true, insight: await insights.pin(input.id, input.pinned) }
          }
          if (input.action === 'update') {
            return {
              ok: true,
              insight: await insights.update(input.id, {
                ...(input.title === undefined ? {} : { title: input.title }),
                ...(input.oneLiner === undefined ? {} : { oneLiner: input.oneLiner }),
                ...(input.body === undefined ? {} : { body: input.body }),
                ...(input.formula === undefined ? {} : { formula: input.formula }),
                ...(input.concepts === undefined ? {} : { concepts: input.concepts }),
                ...(input.sources === undefined ? {} : { sources: input.sources }),
                ...(input.tags === undefined ? {} : { tags: input.tags }),
                ...(input.kind === undefined ? {} : { kind: input.kind }),
                ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
              }),
            }
          }
          if (
            input.title === undefined ||
            input.oneLiner === undefined ||
            input.body === undefined ||
            input.concepts === undefined ||
            input.sources === undefined
          ) {
            throw new StudyError('invalid', 'create 需要 title/oneLiner/body/concepts/sources')
          }
          return {
            ok: true,
            insight: await insights.create({
              title: input.title,
              oneLiner: input.oneLiner,
              body: input.body,
              concepts: input.concepts,
              sources: input.sources,
              ...(input.formula === undefined ? {} : { formula: input.formula }),
              ...(input.tags === undefined ? {} : { tags: input.tags }),
              ...(input.kind === undefined ? {} : { kind: input.kind }),
              ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
            }),
          }
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

  tools.push({
    name: 'study_delete',
    description:
      '删除一条学习路径或一份资料。target=plan 只删路径，不动单元和进度；target=material 会删掉资料目录、精读、练习、相关进度，并清理指向它的概念/洞察来源。不可恢复，调用前必须让用户明确确认。',
    parameters: objectSchema({
      target: { type: 'string', enum: ['plan', 'material'] },
      id: { type: 'string', description: '计划 id 或资料 id' },
    }, ['target', 'id']),
    output: { schema: {}, render: renderJson },
    async execute(args) {
      const input = args as { target: 'plan' | 'material'; id: string }
      try {
        if (input.target === 'plan') return { ok: true, ...(await service.deletePlan(input.id)) }
        return { ok: true, ...(await service.deleteMaterial(input.id)) }
      } catch (error) {
        return refusal(error)
      }
    },
  })

  if (extras.quizSessions !== undefined) {
    const sessions = extras.quizSessions
    tools.push({
      name: 'study_quiz',
      description:
        '自适应练习：start 开始或接着上次的一组题（同一节默认续答；restart=true 重开），answer 提交当前题并拿下一题，finish 提前结束，get 查看会话与回答历史。题目提交前不会暴露答案；主观题需要 selfGrade=correct|partial|wrong。',
      parameters: objectSchema({
        action: { type: 'string', enum: ['start', 'answer', 'finish', 'get'] },
        mid: { type: 'string' },
        uid: { type: 'string' },
        bid: { type: 'string', description: '自编书 id（与 cid 一起）' },
        cid: { type: 'string', description: '自编书章节 id' },
        sid: { type: 'string' },
        itemId: { type: 'string' },
        answer: {},
        selfGrade: { type: 'string', enum: ['correct', 'partial', 'wrong'] },
        limit: { type: 'number' },
        restart: { type: 'boolean', description: 'true 时结束这一节旧的活跃组并开新组' },
      }, ['action']),
      output: { schema: {}, render: renderJson },
      async execute(args) {
        const input = args as {
          action: 'start' | 'answer' | 'finish' | 'get'
          mid?: string
          uid?: string
          bid?: string
          cid?: string
          sid?: string
          itemId?: string
          answer?: unknown
          selfGrade?: 'correct' | 'partial' | 'wrong'
          limit?: number
          restart?: boolean
        }
        try {
          if (input.action === 'start') {
            if ((input.mid === undefined || input.uid === undefined) && (input.bid === undefined || input.cid === undefined)) {
              throw new StudyError('invalid', 'start 需要 mid+uid 或 bid+cid')
            }
            return {
              ok: true,
              ...(await sessions.start({
                ...(input.mid === undefined ? {} : { material: input.mid }),
                ...(input.uid === undefined ? {} : { unit: input.uid }),
                ...(input.bid === undefined ? {} : { book: input.bid }),
                ...(input.cid === undefined ? {} : { chapter: input.cid }),
                ...(input.limit === undefined ? {} : { limit: input.limit }),
                ...(input.restart === true ? { restart: true } : {}),
              })),
            }
          }
          if (input.sid === undefined) throw new StudyError('invalid', '需要 sid')
          if (input.action === 'get') return { ok: true, ...(await sessions.get(input.sid)) }
          if (input.action === 'finish') return { ok: true, ...(await sessions.finish(input.sid)) }
          if (input.itemId === undefined) throw new StudyError('invalid', 'answer 需要 itemId')
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
