import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutPage, paragraphAt } from '../src/core/layout.ts'
import type { TextBox } from '../src/core/layout.ts'

const page = { width: 500, height: 700 }

/** Build one line of boxes: many words laid out left to right. */
function line(y: number, x: number, words: readonly string[], width = 14, height = 12): TextBox[] {
  return words.map((word, index) => ({ str: word, x: x + index * width, y, w: width, h: height }))
}

test('an empty page has no paragraphs', () => {
  assert.deepEqual(layoutPage([], page), [])
  assert.deepEqual(layoutPage([{ str: '   ', x: 10, y: 10, w: 10, h: 10 }], page), [])
})

test('tightly set lines merge into one paragraph', () => {
  const boxes = [
    ...line(100, 40, ['第一行', '文字', '继续']),
    ...line(116, 40, ['第二行', '文字', '继续']),
    ...line(132, 40, ['第三行', '文字', '继续']),
  ]
  const paragraphs = layoutPage(boxes, page)
  assert.equal(paragraphs.length, 1)
  assert.ok(paragraphs[0]!.text.includes('第一行'))
  assert.ok(paragraphs[0]!.text.includes('第三行'))
})

test('a wide vertical gap starts a new paragraph', () => {
  const boxes = [
    ...line(100, 40, ['上一段', '结束']),
    ...line(116, 40, ['上一段', '结束']),
    ...line(220, 40, ['下一段', '开始']),
    ...line(236, 40, ['下一段', '结束']),
  ]
  const paragraphs = layoutPage(boxes, page)
  assert.equal(paragraphs.length, 2)
  assert.ok(paragraphs[0]!.text.includes('上一段'))
  assert.ok(paragraphs[1]!.text.includes('下一段'))
})

test('an indented first line starts a paragraph even without a gap', () => {
  // Lines fill the column, so "previous line is short" cannot fire by itself:
  // only the indent may start a paragraph here.
  const words = ['一', '二', '三', '四', '五', '六', '七', '八']
  const boxes = [...line(100, 40, words), ...line(116, 62, words), ...line(132, 40, words)]
  const paragraphs = layoutPage(boxes, page)
  assert.equal(paragraphs.length, 2)
  assert.ok(paragraphs[0]!.text.startsWith('一二三'))
  assert.ok(paragraphs[1]!.text.startsWith('一二三'))
})

test('Chinese lines are joined without spaces', () => {
  const boxes = [...line(100, 40, ['强化学习']), ...line(116, 40, ['智能体'])]
  const paragraphs = layoutPage(boxes, page)
  assert.equal(paragraphs[0]!.text, '强化学习智能体')
})

test('two columns are ordered left before right', () => {
  const boxes = [
    ...line(100, 40, ['左栏', '第一行']),
    ...line(116, 40, ['左栏', '第二行']),
    ...line(132, 40, ['左栏', '第三行']),
    ...line(100, 300, ['右栏', '第一行']),
    ...line(116, 300, ['右栏', '第二行']),
    ...line(132, 300, ['右栏', '第三行']),
  ]
  const paragraphs = layoutPage(boxes, page)
  assert.equal(paragraphs.length, 2)
  assert.ok(paragraphs[0]!.text.startsWith('左栏'), paragraphs[0]!.text)
  assert.ok(paragraphs[1]!.text.startsWith('右栏'), paragraphs[1]!.text)
  assert.ok(paragraphs[0]!.x < paragraphs[1]!.x)
})

test('a line that straddles the gutter keeps the page single-column', () => {
  const boxes = [
    ...line(100, 40, ['左栏', '第一行']),
    ...line(116, 40, ['左栏', '第二行']),
    ...line(100, 300, ['右栏', '第一行']),
    ...line(116, 300, ['右栏', '第二行']),
    // A heading spanning the full width: the empty band is not a gutter.
    { str: '跨栏标题跨栏标题', x: 40, y: 60, w: 420, h: 14 },
  ]
  const paragraphs = layoutPage(boxes, page)
  // The heading stands alone, and the body is not split into columns.
  assert.equal(paragraphs.length, 2, JSON.stringify(paragraphs.map(item => item.text)))
  assert.ok(paragraphs[0]!.text.startsWith('跨栏标题'))
  assert.ok(paragraphs[1]!.text.includes('左栏'))
})

test('boxes are normalised into 0..1 page units', () => {
  const boxes = [...line(100, 50, ['文字', '文字'])]
  const paragraphs = layoutPage(boxes, page)
  const first = paragraphs[0]!
  assert.ok(first.x > 0 && first.x < 1)
  assert.ok(first.y > 0 && first.y < 1)
  assert.ok(first.w > 0 && first.w < 1)
  assert.ok(first.y + first.h <= 1)
})

test('paragraphAt finds the paragraph covering a point', () => {
  const paragraphs = [
    { x: 0, y: 0.1, w: 1, h: 0.1, text: 'a' },
    { x: 0, y: 0.3, w: 1, h: 0.1, text: 'b' },
    { x: 0, y: 0.6, w: 1, h: 0.1, text: 'c' },
  ]
  assert.equal(paragraphAt(paragraphs, 0.15), 0)
  assert.equal(paragraphAt(paragraphs, 0.35), 1)
  assert.equal(paragraphAt(paragraphs, 0.62), 2)
  // A gap between paragraphs picks the one that starts below it.
  assert.equal(paragraphAt(paragraphs, 0.25), 1)
  // Past the end: the last paragraph still owns the line.
  assert.equal(paragraphAt(paragraphs, 0.99), 2)
  assert.equal(paragraphAt([], 0.5), -1)
})