/**
 * Note tools: concepts, concept links and insight cards.
 */
import { objectSchema, refusal, renderJson, type StudyToolDefinition, type ToolContext } from './shared.ts'
import { StudyError } from '../service/error.ts'

export function notesTools({ service, extras }: ToolContext): StudyToolDefinition[] {
  const tools: StudyToolDefinition[] = []

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
        const { upsertConcept } = await import('../../core/concepts.ts')
        const record = await upsertConcept(service.paths, input)
        return { ok: true, concept: record }
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

  return tools
}
