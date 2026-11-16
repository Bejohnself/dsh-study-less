import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockForParagraph, validateBlocks } from '../src/core/blocks.ts'
import type { BlockInput, BlockRecord } from '../src/core/types.ts'

const range = { paragraphs: 10 }

function block(patch: Partial<BlockInput> = {}): BlockInput {
  return {
    id: 'b1',
    startPara: 0,
    endPara: 3,
    title: '要素',
    prompt: {
      kind: 'predict',
      transition: '上面对比了策略和值函数两种思路',
      question: '如果去掉奖励信号，智能体还能靠什么学？',
    },
    ...patch,
  }
}

/** Three blocks that tile paragraphs 0–9 exactly. */
function tiling(): BlockInput[] {
  return [
    block(),
    block({ id: 'b2', startPara: 4, endPara: 6, title: '推导' }),
    block({ id: 'b3', startPara: 7, endPara: 9, title: '结论' }),
  ]
}

test('a contiguous tiling passes', () => {
  assert.deepEqual(validateBlocks(tiling(), range), [])
})

test('a gap between blocks is refused', () => {
  const blocks = [block(), block({ id: 'b2', startPara: 5, endPara: 9 })]
  const issues = validateBlocks(blocks, range)
  assert.ok(issues.some(issue => issue.includes('紧接上一块')), issues.join(' | '))
})

test('the first block must start at the first paragraph', () => {
  const issues = validateBlocks([block({ startPara: 1 }), block({ id: 'b2', startPara: 4, endPara: 9 })], range)
  assert.ok(issues.some(issue => issue.includes('必须从第 0 段开始')), issues.join(' | '))
})

test('the last block must reach the last paragraph', () => {
  const issues = validateBlocks([block({ startPara: 0, endPara: 8 })], range)
  assert.ok(issues.some(issue => issue.includes('必须到第 9 段')), issues.join(' | '))
})

test('paragraphs outside the unit range are refused', () => {
  const issues = validateBlocks([block({ startPara: 0, endPara: 12 })], range)
  assert.ok(issues.some(issue => issue.includes('超出本节段落范围')), issues.join(' | '))
})

test('more than eight blocks is refused', () => {
  const blocks = Array.from({ length: 9 }, (_, index) =>
    block({ id: `b${String(index + 1)}`, startPara: index, endPara: index, title: `块${String(index + 1)}` }),
  )
  const issues = validateBlocks(blocks, { paragraphs: 9 })
  assert.ok(issues.some(issue => issue.includes('最多 8 块')), issues.join(' | '))
})

test('an explaining transition is refused', () => {
  const issues = validateBlocks(
    [block({ prompt: { kind: 'predict', transition: '因为奖励可微，所以能反传', question: '基线有什么用？' } })],
    range,
  )
  assert.ok(issues.some(issue => issue.includes('只能指向刚读过的内容')), issues.join(' | '))
})

test('a transition that is a question is refused', () => {
  const issues = validateBlocks(
    [block({ prompt: { kind: 'recall', transition: '刚才那段你记得吗？', question: '它说了什么？' } })],
    range,
  )
  assert.ok(issues.some(issue => issue.includes('不能是问句')), issues.join(' | '))
})

test('two question marks are refused', () => {
  const issues = validateBlocks(
    [block({ prompt: { kind: 'contrast', transition: '上面对比了两种思路', question: '差在哪？为什么？' } })],
    range,
  )
  assert.ok(issues.some(issue => issue.includes('只含一个问号')), issues.join(' | '))
})

test('an over-long question is refused', () => {
  const issues = validateBlocks(
    [block({ prompt: { kind: 'transfer', transition: '刚读完要素这一段', question: `${'换'.repeat(36)}？` } })],
    range,
  )
  assert.ok(issues.some(issue => issue.includes('上限 35 字')), issues.join(' | '))
})

test('an over-long title is refused', () => {
  const issues = validateBlocks([block({ title: '一二三四五六七八九十一' })], range)
  assert.ok(issues.some(issue => issue.includes('上限 10 字')), issues.join(' | '))
})

test('a block without a card is refused', () => {
  const issues = validateBlocks([block({ startPara: 0, endPara: 9, prompt: undefined })], range)
  assert.ok(issues.some(issue => issue.includes('缺少引导问题')), issues.join(' | '))
})

/** The paragraph lookup needs stored blocks, which carry derived page spans. */
function stored(blocks: readonly BlockInput[]): BlockRecord[] {
  return blocks.map(block => ({ ...block, startPage: 3, endPage: 4 }))
}

test('blockForParagraph picks the block that covers the paragraph', () => {
  const blocks = stored(tiling())
  assert.equal(blockForParagraph(blocks, 0)?.id, 'b1')
  assert.equal(blockForParagraph(blocks, 3)?.id, 'b1')
  assert.equal(blockForParagraph(blocks, 4)?.id, 'b2')
  assert.equal(blockForParagraph(blocks, 9)?.id, 'b3')
  assert.equal(blockForParagraph(blocks, 10), null)
})