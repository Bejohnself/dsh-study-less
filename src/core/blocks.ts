/**
 * The reading surface's only contract.
 *
 * A block is a contiguous page range carrying at most one guiding card. Cards
 * are prompt-only: no answer field exists, and the validator refuses anything
 * that reads like an explanation, because that is how the rail turns back into
 * a summary (see DESIGN.md 信息架构 and 不做什么).
 *
 * Paragraph ranges are contiguous and cover the unit exactly. That single rule
 * is what lets the rail follow the scroll without storing where anybody read:
 * the client only has to answer "which paragraph is at the reading line?".
 */
import type { BlockInput, BlockRecord, PromptCard, PromptKind } from './types.ts'

/** Rail heading, at most this many characters. */
export const BLOCK_TITLE_MAX = 10

/** One line that points at the text just read. */
export const BLOCK_TRANSITION_MAX = 25

/** One question, one question mark. */
export const BLOCK_QUESTION_MAX = 35

/** Blocks per unit. The density cap that keeps the rail from becoming a ticker. */
export const BLOCK_MAX_PER_UNIT = 8

/** The four moves a card may ask for. */
export const PROMPT_KINDS: PromptKind[] = ['predict', 'contrast', 'recall', 'transfer']

/**
 * Connectives that turn a pointer into an explanation.
 *
 * `transition` must point at what was read, not restate its conclusion; these
 * are the openings that a model reaches for when it starts summarising.
 */
export const EXPLAINING_CONNECTIVES = ['因为', '所以', '也就是说', '简单来说', '本质上', '这意味着', '换句话说']

/** Count question marks, ASCII and full width. */
function questionMarks(text: string): number {
  return (text.match(/[?？]/gu) ?? []).length
}

/** Trim and collapse whitespace so length checks measure what is shown. */
function clean(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/** How many paragraphs the unit has; the space blocks must tile. */
export interface BlockRange {
  paragraphs: number
}

/**
 * Check one unit's blocks against the reading-surface contract.
 *
 * Returns every problem at once: the generation job hands the list back to the
 * model in one repair round instead of failing one issue per call.
 */
export function validateBlocks(blocks: readonly BlockInput[], range: BlockRange): string[] {
  const issues: string[] = []
  const total = range.paragraphs

  if (blocks.length === 0) {
    issues.push('至少需要一块')
    return issues
  }
  if (blocks.length > BLOCK_MAX_PER_UNIT) {
    issues.push(`一节最多 ${String(BLOCK_MAX_PER_UNIT)} 块，现在是 ${String(blocks.length)} 块`)
  }
  if (total <= 0) {
    issues.push('这一节没有段落，无法分块')
    return issues
  }
  if (blocks.length > total) {
    issues.push(`块数（${String(blocks.length)}）不能多于段落数（${String(total)}）`)
  }

  const seen = new Set<string>()
  blocks.forEach((block, index) => {
    const at = `第 ${String(index + 1)} 块`
    if (block.id.trim().length === 0) issues.push(`${at}缺少 id`)
    else if (seen.has(block.id)) issues.push(`${at}的 id 重复：${block.id}`)
    seen.add(block.id)

    if (!Number.isInteger(block.startPara) || !Number.isInteger(block.endPara)) {
      issues.push(`${at}的段落序号必须是整数`)
      return
    }
    if (block.startPara > block.endPara) {
      issues.push(`${at}的起始段 ${String(block.startPara)} 大于结束段 ${String(block.endPara)}`)
    }
    if (block.startPara < 0 || block.endPara > total - 1) {
      issues.push(`${at}超出本节段落范围 0–${String(total - 1)}`)
    }

    const title = clean(block.title)
    if (title.length === 0) issues.push(`${at}缺少标题`)
    else if (title.length > BLOCK_TITLE_MAX) {
      issues.push(`${at}的标题 ${String(title.length)} 字，上限 ${String(BLOCK_TITLE_MAX)} 字：${title}`)
    }

    if (block.prompt === undefined) {
      issues.push(`${at}缺少引导问题`)
      return
    }
    issues.push(...validatePrompt(block.prompt, at))
  })

  // Contiguity: the ranges must tile the unit with no gap and no overlap.
  const ordered = blocks
    .filter(block => Number.isInteger(block.startPara) && Number.isInteger(block.endPara))
    .slice()
    .sort((a, b) => a.startPara - b.startPara)
  if (ordered.length === blocks.length && ordered.length > 0) {
    if (ordered[0]!.startPara !== 0) {
      issues.push(`第一块必须从第 0 段开始，现在从第 ${String(ordered[0]!.startPara)} 段开始`)
    }
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!
      const current = ordered[index]!
      if (current.startPara !== previous.endPara + 1) {
        issues.push(
          `第 ${String(index + 1)} 块必须紧接上一块：上一块到第 ${String(previous.endPara)} 段，这一块从第 ${String(current.startPara)} 段开始`,
        )
      }
    }
    const last = ordered[ordered.length - 1]!
    if (last.endPara !== total - 1) {
      issues.push(`最后一块必须到第 ${String(total - 1)} 段，现在到第 ${String(last.endPara)} 段`)
    }
  }

  return issues
}

/** Check one card: one pointer, one question, no answer. */
export function validatePrompt(prompt: PromptCard, at = '引导问题'): string[] {
  const issues: string[] = []

  if (!PROMPT_KINDS.includes(prompt.kind)) {
    issues.push(`${at}的类型必须是 ${PROMPT_KINDS.join(' / ')}`)
  }

  const transition = clean(prompt.transition)
  if (transition.length === 0) issues.push(`${at}缺少过渡句`)
  else {
    if (transition.length > BLOCK_TRANSITION_MAX) {
      issues.push(`${at}的过渡句 ${String(transition.length)} 字，上限 ${String(BLOCK_TRANSITION_MAX)} 字`)
    }
    if (questionMarks(transition) > 0) issues.push(`${at}的过渡句不能是问句：${transition}`)
    for (const word of EXPLAINING_CONNECTIVES) {
      if (transition.includes(word)) {
        issues.push(`${at}的过渡句只能指向刚读过的内容，不要解释（出现「${word}」）：${transition}`)
        break
      }
    }
  }

  const question = clean(prompt.question)
  if (question.length === 0) issues.push(`${at}缺少问题`)
  else {
    if (question.length > BLOCK_QUESTION_MAX) {
      issues.push(`${at}的问题 ${String(question.length)} 字，上限 ${String(BLOCK_QUESTION_MAX)} 字`)
    }
    const marks = questionMarks(question)
    if (marks !== 1) issues.push(`${at}的问题必须只含一个问号，现在有 ${String(marks)} 个`)
    if (!/[?？]$/u.test(question)) issues.push(`${at}的问题要以问号结尾`)
  }

  return issues
}

/** The block containing one paragraph (the rail's primary lookup). */
export function blockForParagraph(blocks: readonly BlockRecord[], para: number): BlockRecord | null {
  for (const block of blocks) {
    if (para >= block.startPara && para <= block.endPara) return block
  }
  return null
}

/** The block containing one page, used only when a unit has no layout. */
export function blockAtPage(blocks: readonly BlockRecord[], page: number): BlockRecord | null {
  for (const block of blocks) {
    if (page >= block.startPage && page <= block.endPage) return block
  }
  return null
}
