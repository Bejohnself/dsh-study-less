/**
 * Prompts for compiling a learning path into a generated book.
 *
 * Outline first, then one sample chapter, then the rest. Every chapter prompt
 * carries the previous chapter's summary, the whole outline and the next
 * chapter's goal, which is what keeps the book from reading like stitched
 * unit notes.
 */
import type { BookChapterMeta, BookRecord, MaterialManifest } from '../../core/types.ts'
import { JSON_SYSTEM } from './prompts.ts'

/** Bump when the book contract changes. */
export const BOOK_PROMPT_VERSION = '1'

/** Style contract shared by chapter prompts. */
export const BOOK_STYLE = [
  '你是一位教材作者，不是摘要器。读者已经有一点基础，但还不能独立推导。',
  '每一章解决一个具体问题；开头先给问题或矛盾，不要从定义开始。',
  '每节先讲“为什么需要这个工具”，再给直觉，再给定义/公式，再推导，再例子或反例。',
  '每节结尾用一句过渡说明这为下一步准备了什么；不要突然跳题。',
  '不要重复上一章已经讲过的内容；需要时用一句话引用。',
  '不要用“本节目标/前置知识/核心概念/逐步讲解/类比/常见误区/自测/出处”这种固定八股；用叙事性的小标题。',
  '公式按需出现，先说明它在算什么；变量用斜体，函数名用 \\operatorname{}。',
  '每章至少一个完整推导、一个 worked example、一个常见错误；结尾给出三条 takeaway 和下一章要解决的问题。',
  '原文是证据，不是逐段复述；所有页码引用必须落在来源单元范围内。',
].join('\n')

/** Build the book outline prompt. */
export function bookOutlinePrompt(input: {
  goal: string
  brief?: string
  steps: Array<{ n: number; kind: string; title: string; materialTitle: string; why: string; target: string }>
  manifests: readonly MaterialManifest[]
  concepts: ReadonlyArray<{ id: string; name: string; mastery: number }>
}): { system: string; user: string } {
  const steps = input.steps
    .map(step => `${step.n}. [${step.kind}] ${step.materialTitle} / ${step.title} · target=${step.target} · why=${step.why}`)
    .join('\n')
  const catalogue = input.manifests
    .map(manifest => {
      const rows = manifest.structure.slice(0, 120).map(node => `  - ${manifest.id}:${node.uid} | ${node.title} | p${node.pageStart}-${node.pageEnd}`)
      return `- 《${manifest.title}》 id=${manifest.id}\n${rows.join('\n')}`
    })
    .join('\n\n')
  const conceptRows = input.concepts.map(concept => `- ${concept.id} | ${concept.name} | ${Math.round(concept.mastery * 100)}%`).join('\n')
  return {
    system: `${JSON_SYSTEM}\n\n${BOOK_STYLE}`,
    user: [
      '把下面这条学习路径编译成一本自编书的大纲。',
      `目标：${input.goal}`,
      ...(input.brief === undefined ? [] : [`补充：${input.brief}`]),
      '',
      '## 路径步骤',
      steps,
      '',
      '## 资料与单元目录',
      catalogue,
      '',
      '## 已有概念',
      conceptRows.length === 0 ? '（暂无）' : conceptRows,
      '',
      '## 输出契约',
      '输出一个 JSON 对象：',
      '{"title":"书名","subtitle":"副标题","audience":"读者画像","parts":[{"title":"部标题","chapters":[{"title":"章标题","summary":"两句话章摘要","objectives":["学完能做什么"],"prerequisites":["需要的前置"],"narrativeRole":"这一章在全书里承担什么","sourceUnits":["<material>:<unit>"]}]}]}',
      '3–8 章；每章 1–3 个 sourceUnits，必须逐字复制目录里的 <material>:<unit>；覆盖路径步骤里的大部分单元。',
      '章节顺序要形成一条线：先补前置，再核心推导，再论文证据，最后综合；不要按资料顺序平铺。',
    ].join('\n'),
  }
}

/** One source block for a chapter prompt. */
function sourceBlock(input: {
  materialTitle: string
  unitTitle: string
  pageStart: number
  pageEnd: number
  text: string
  notes?: string
}): string {
  return [
    `### ${input.materialTitle} / ${input.unitTitle}（p${input.pageStart}-${input.pageEnd}）`,
    input.notes === undefined || input.notes.trim().length === 0 ? '' : `已有精读笔记（可参考，不要照抄）：\n${input.notes.slice(0, 6000)}`,
    '原文：',
    input.text.slice(0, 12_000),
  ]
    .filter(line => line.length > 0)
    .join('\n')
}

/** Build one chapter prompt. */
export function bookChapterPrompt(input: {
  book: BookRecord
  chapter: BookChapterMeta
  previous?: BookChapterMeta
  next?: BookChapterMeta
  sources: Array<{
    materialTitle: string
    unitTitle: string
    pageStart: number
    pageEnd: number
    text: string
    notes?: string
  }>
}): { system: string; user: string } {
  const outline = input.book.chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(chapter => `${chapter.order}. ${chapter.title}｜${chapter.summary}`)
    .join('\n')
  return {
    system: `${JSON_SYSTEM}\n\n${BOOK_STYLE}`,
    user: [
      `正在写《${input.book.title}》的第 ${input.chapter.order} 章「${input.chapter.title}」。`,
      `全书目标：${input.book.goal}`,
      ...(input.book.audience === undefined ? [] : [`读者：${input.book.audience}`]),
      '',
      '## 全书大纲',
      outline,
      '',
      '## 本章任务',
      `目标：${input.chapter.objectives.join('；')}`,
      `前置：${input.chapter.prerequisites.join('；')}`,
      `叙事角色：${input.chapter.narrativeRole}`,
      `摘要（写作前）：${input.chapter.summary}`,
      ...(input.previous === undefined
        ? []
        : [`上一章「${input.previous.title}」摘要：${input.previous.summary}`]),
      ...(input.next === undefined ? [] : [`下一章「${input.next.title}」要解决：${input.next.objectives.join('；')}`]),
      '',
      '## 本章素材',
      ...input.sources.map(sourceBlock),
      '',
      '## 输出契约',
      '输出一个 JSON 对象：',
      '{"summary":"本章两句话摘要，供下一章使用","body":"完整 Markdown 正文","takeaways":["三条 takeaway"],"transition":"给下一章的过渡句","sourceRefs":[{"material":"id","unit":"uid","page":12}],"concepts":[{"id":"topic/slug","name":"中文名","definition":"一句话定义"}],"exercises":[{"type":"choice|cloze|recall|apply|evidence","question":"题干","choices":["A","B"],"answerIndex":0,"answer":"填空答案","rubric":["评分要点"],"concepts":["topic/slug"],"page":12,"difficulty":1,"explanation":"解析"}]}',
      'body 必须包含 `## 本章小结`；不要使用固定八股；至少一个完整推导和一个例子。',
      'exercises 3–5 道，难度 1–3；题型混合，题干和选项可以用 $...$ 或 $$...$$。',
      'sourceRefs 的页码必须落在来源单元范围内；不要编造 unit。',
    ].join('\n'),
  }
}

/** Build the continuity pass prompt. */
export function bookContinuityPrompt(input: {
  book: BookRecord
  chapters: Array<{ order: number; title: string; summary: string; opening: string; closing: string }>
}): { system: string; user: string } {
  return {
    system: `${JSON_SYSTEM}\n\n${BOOK_STYLE}`,
    user: [
      `对《${input.book.title}》做一次统稿检查。`,
      '只找问题，不重写整章。重点：重复、前置缺失、章节之间跳跃、章节目标未兑现、过渡生硬。',
      '',
      '## 各章摘要与首尾',
      ...input.chapters.map(chapter => `### ${chapter.order}. ${chapter.title}\n摘要：${chapter.summary}\n开头：${chapter.opening}\n结尾：${chapter.closing}`),
      '',
      '## 输出契约',
      '输出一个 JSON 对象：',
      '{"verdict":"pass|warn","issues":[{"chapter":1,"kind":"repetition|gap|jump|unmet-goal|transition","detail":"具体问题","suggestion":"怎么改"}],"bridges":[{"chapter":2,"opening":"建议的开头","closing":"建议的结尾"}]}',
      'bridges 只给确实需要改的章；不要为了改而改。',
    ].join('\n'),
  }
}
