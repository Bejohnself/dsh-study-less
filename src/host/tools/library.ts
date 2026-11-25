/**
 * Library and authoring tools: materials, unit material, notes and deletion.
 */
import { objectSchema, refusal, renderJson, type StudyToolDefinition, type ToolContext } from './shared.ts'
import type { StructureNode } from '../../core/types.ts'
import { StudyError } from '../service/error.ts'

export function libraryTools({ service, extras }: ToolContext): StudyToolDefinition[] {
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
      '导入一本 PDF（书籍或论文）到学习库：抽取目录、按页切片、生成学习单元。返回资料 id、类型、页数、单元列表预览与 warnings。导入前确认 PDF 有文字层与书签目录：扫描件先做成可搜索 PDF，缺目录可用 https://tocify.aeriszhu.com/ 补。导入后可调用 study_structure_set 修正目录，再用 study_unit_material / study_unit_write 逐节生成精读稿。',
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
      '替换一份资料的学习单元结构（用于修正导入时的目录识别）。单元必须按阅读顺序排列，页码范围不能重叠且必须落在 1..总页数内。教材和论文都按小节切；pass 仅用于兼容旧资料。',
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
    name: 'study_delete',
    description:
      '删除一条学习路径或一份资料，不可恢复，调用前必须让用户明确确认。target=plan 会连它产生的判定卡、按目标开的练习会话和它生成的书一起删掉；资料本身、单元的题库和知识点掌握度保留（结案才是保留痕迹的方式）。target=material 会删掉资料目录、精读、练习、相关进度，并清理指向它的概念/洞察来源。',
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

  return tools
}
