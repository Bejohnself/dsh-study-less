import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructure } from '../src/host/structure.ts'
import type { ExtractedPage, OutlineEntry } from '../src/host/pdf.ts'

/** Pages from one string array per page. */
function pagesOf(lines: string[][]): ExtractedPage[] {
  return lines.map((text, index) => ({ page: index + 1, text: text.join('\n') }))
}

/** Section nodes only, in reading order. */
function sections(nodes: ReturnType<typeof buildStructure>) {
  return nodes.filter(node => node.kind === 'section')
}

function byTitle(nodes: ReturnType<typeof buildStructure>, title: string) {
  const node = sections(nodes).find(candidate => candidate.title === title)
  assert.ok(node, `missing section ${title}`)
  return node
}

test('a section keeps the page on which the next section starts mid-page', () => {
  const pages = pagesOf([
    ['第1章 引论', '1.1 起点', '正文一'],
    ['2 第1章 引论', '1.1 的续文', '1.2 第二节', '正文二'],
    ['1.2 的续文'],
    ['1.3 第三节', '正文四'],
    ['尾页'],
  ])
  const outline: OutlineEntry[] = [
    { title: '第1章 引论', level: 1, page: 1 },
    { title: '1.1 起点', level: 2, page: 1 },
    { title: '1.2 第二节', level: 2, page: 2 },
    { title: '1.3 第三节', level: 2, page: 4 },
  ]
  const nodes = buildStructure({ type: 'book', numPages: 5, outline, pages })

  assert.equal(byTitle(nodes, '第1章 引论').pageEnd, 5)
  // 1.1 cannot end on page 1: page 2 carries its tail above the 1.2 heading.
  assert.equal(byTitle(nodes, '1.1 起点').pageEnd, 2)
  // 1.3 opens page 4, so nothing above its heading belongs to 1.2.
  assert.equal(byTitle(nodes, '1.2 第二节').pageEnd, 3)
  assert.equal(byTitle(nodes, '1.3 第三节').pageEnd, 5)
})

test('a parent with its own prose gets an intro unit and the section keeps its page', () => {
  // 3 Model Architecture opens page 2 and its introduction is there, while the
  // first subsection starts on page 3. Opening the parent lands on the first
  // leaf, so that page needs a unit of its own — otherwise the prose is lost.
  const pages = pagesOf([
    ['1 Introduction', '正文一'],
    ['2 Background', '正文二', '3 MODEL ARCHITECTURE', '这一节先讲 Transformer 的整体结构，再把它拆成编码器与解码器。', '随后每个小节只讲一件事，读完能画出数据流。'],
    ['3.1 Encoder and Decoder Stacks', '小节正文'],
    ['3.1 的续文'],
  ])
  const outline: OutlineEntry[] = [
    { title: '1 Introduction', level: 1, page: 1 },
    { title: '2 Background', level: 1, page: 2 },
    { title: '3 Model Architecture', level: 1, page: 2 },
    { title: '3.1 Encoder and Decoder Stacks', level: 2, page: 3 },
  ]
  const nodes = buildStructure({ type: 'paper', numPages: 4, outline, pages })

  const intro = byTitle(nodes, '3 Model Architecture · Intro')
  assert.equal(intro.intro, true)
  assert.equal(intro.level, 2)
  assert.equal(intro.pageStart, 2)
  assert.equal(intro.pageEnd, 2)
  assert.equal(byTitle(nodes, '3.1 Encoder and Decoder Stacks').pageStart, 3)
  // Reading order: the intro sits right after its parent, before the first child.
  const order = nodes.map(node => node.title)
  assert.ok(order.indexOf('3 Model Architecture') < order.indexOf('3 Model Architecture · Intro'))
  assert.ok(order.indexOf('3 Model Architecture · Intro') < order.indexOf('3.1 Encoder and Decoder Stacks'))
})

test('a CJK parent gets a 序言 unit named after it', () => {
  const pages = pagesOf([
    ['3.2 多元正态分布的定义', '这一节先交代多元正态分布的定义，再讲它的性质与独立性，最后给出判别方法。'],
    ['3.2.1 定义及性质', '小节正文'],
  ])
  const outline: OutlineEntry[] = [
    { title: '3.2 多元正态分布的定义', level: 2, page: 1 },
    { title: '3.2.1 定义及性质', level: 3, page: 2 },
  ]
  const nodes = buildStructure({ type: 'book', numPages: 2, outline, pages })

  assert.equal(byTitle(nodes, '3.2 多元正态分布的定义 · 序言').pageStart, 1)
})

test('a title page that only lists its sections gets no intro unit', () => {
  const pages = pagesOf([
    ['1', 'The Dynamic Programming', 'Algorithm', 'Contents', '1.1. Introduction p. 2'],
    ['2 The Dynamic Programming Algorithm Chap. 1', '1.1 INTRODUCTION', '正文一'],
  ])
  const outline: OutlineEntry[] = [
    { title: '1.The Dynamic Programming Algorithm', level: 1, page: 1 },
    { title: '1.1.Introduction', level: 2, page: 2 },
  ]
  const nodes = buildStructure({ type: 'book', numPages: 2, outline, pages })

  assert.equal(nodes.filter(node => node.intro === true).length, 0)
  assert.equal(byTitle(nodes, '1.1.Introduction').pageStart, 2)
})

test('a running head or a chapter contents line never moves a section start', () => {
  // The outline destinations are right; page text is only a witness for stale
  // ones. A running head repeats the chapter title, and a chapter title page
  // lists its sections, so neither may pull a start off its destination.
  const special = new Map<number, string[]>([
    [17, ['1', 'The Dynamic Programming', 'Algorithm', 'Contents', '1.1. Introduction p. 2']],
    [18, ['2 The Dynamic Programming Algorithm Chap. 1', '1.1 INTRODUCTION', '正文一']],
    [28, ['12 The Dynamic Programming Algorithm Chap. 1', '1.2 THE BASIC PROBLEM', '正文二']],
    [32, ['16 The Dynamic Programming Algorithm Chap. 1', '1.2 的续文']],
    [34, ['18 The Dynamic Programming Algorithm Chap. 1', '1.3 THE DYNAMIC PROGRAMMING ALGORITHM', '正文三']],
  ])
  const pages = Array.from({ length: 40 }, (_, index) => ({
    page: index + 1,
    text: (special.get(index + 1) ?? [`第 ${index + 1} 页正文`]).join('\n'),
  }))
  const outline: OutlineEntry[] = [
    { title: '1.The Dynamic Programming Algorithm', level: 1, page: 17 },
    { title: '1.1.Introduction', level: 2, page: 18 },
    { title: '1.2.The Basic Problem', level: 2, page: 28 },
    { title: '1.3.The Dynamic Programming Algorithm', level: 2, page: 34 },
  ]
  const nodes = buildStructure({ type: 'book', numPages: 40, outline, pages })

  assert.equal(byTitle(nodes, '1.The Dynamic Programming Algorithm').pageStart, 17)
  assert.equal(byTitle(nodes, '1.1.Introduction').pageStart, 18)
  assert.equal(byTitle(nodes, '1.3.The Dynamic Programming Algorithm').pageStart, 34)
})

test('a section whose heading opens its page ends the unit before it on the page before', () => {
  const pages = pagesOf([
    ['1.1 起点', '正文一'],
    ['1.2 第二节', '正文二'],
    ['1.3 第三节'],
  ])
  const outline: OutlineEntry[] = [
    { title: '1.1 起点', level: 2, page: 1 },
    { title: '1.2 第二节', level: 2, page: 2 },
    { title: '1.3 第三节', level: 2, page: 3 },
  ]
  const nodes = buildStructure({ type: 'book', numPages: 3, outline, pages })

  // Nothing above a heading that opens its page, so it is not extra reading.
  assert.equal(byTitle(nodes, '1.1 起点').pageEnd, 1)
  assert.equal(byTitle(nodes, '1.2 第二节').pageEnd, 2)
})

test('a running head above a heading is page furniture, not body text', () => {
  const pages = pagesOf([
    ['1.1 起点', '正文一'],
    ['12 第二章 名称', '1.2 第二节', '正文二'],
    ['12 第二章 名称', '1.2 的续文'],
    ['12 第二章 名称', '1.3 第三节', '正文三'],
  ])
  const outline: OutlineEntry[] = [
    { title: '1.1 起点', level: 2, page: 1 },
    { title: '1.2 第二节', level: 2, page: 2 },
    { title: '1.3 第三节', level: 2, page: 4 },
  ]
  const nodes = buildStructure({ type: 'book', numPages: 4, outline, pages })

  const repeated = byTitle(nodes, '1.2 第二节')
  assert.equal(repeated.pageStart, 2)
  assert.equal(repeated.pageEnd, 3)
  assert.equal(byTitle(nodes, '1.1 起点').pageEnd, 1)
})

test('a chapter covers its sections and ends where the next chapter starts', () => {
  const pages = pagesOf([
    ['第1章 引论', '1.1 起点', '正文一'],
    ['1.1 的续文', '1.2 第二节', '正文二'],
    ['1.2 的续文'],
    ['第2章 新章', '2.1 小节', '正文三'],
    ['2.1 的续文'],
  ])
  const outline: OutlineEntry[] = [
    { title: '第1章 引论', level: 1, page: 1 },
    { title: '1.1 起点', level: 2, page: 1 },
    { title: '1.2 第二节', level: 2, page: 2 },
    { title: '第2章 新章', level: 1, page: 4 },
    { title: '2.1 小节', level: 2, page: 4 },
  ]
  const nodes = buildStructure({ type: 'book', numPages: 5, outline, pages })

  assert.equal(byTitle(nodes, '第1章 引论').pageEnd, 3)
  assert.equal(byTitle(nodes, '1.2 第二节').pageEnd, 3)
  assert.equal(byTitle(nodes, '第2章 新章').pageEnd, 5)
  assert.equal(byTitle(nodes, '2.1 小节').pageEnd, 5)
})

test('a chapter title wrapped over lines still opens its page', () => {
  const pages = pagesOf([
    ['1.1 起点', '正文一'],
    ['2', 'Deterministic Systems and the', 'Shortest Path Problem', 'Contents', '2.1. 小节 p. 3'],
    ['2.1 小节', '正文二'],
  ])
  const outline: OutlineEntry[] = [
    { title: '1.1 起点', level: 2, page: 1 },
    { title: '2.Deterministic Systems and the Shortest Path Problem', level: 1, page: 2 },
    { title: '2.1 小节', level: 2, page: 3 },
  ]
  const nodes = buildStructure({ type: 'book', numPages: 3, outline, pages })

  assert.equal(byTitle(nodes, '1.1 起点').pageEnd, 1)
})

test('a chapter that opens a fresh page ends its predecessor before it', () => {
  const pages = pagesOf([
    ['1.1 起点', '正文一'],
    ['第2章 新章', '学习目标', '2.1 小节'],
    ['2.1 的续文'],
  ])
  const outline: OutlineEntry[] = [
    { title: '1.1 起点', level: 2, page: 1 },
    { title: '第2章 新章', level: 1, page: 2 },
    { title: '2.1 小节', level: 2, page: 2 },
  ]
  const nodes = buildStructure({ type: 'book', numPages: 3, outline, pages })

  assert.equal(byTitle(nodes, '1.1 起点').pageEnd, 1)
  assert.equal(byTitle(nodes, '第2章 新章').pageEnd, 3)
})

test('a paper uses sections without generating three reading passes', () => {
  const pages = pagesOf([
    ['Abstract', '1 Introduction', 'body'],
    ['intro continued', 'still the introduction', '2 Method', 'method body'],
    ['method continued'],
  ])
  const outline: OutlineEntry[] = [
    { title: '1 Introduction', level: 1, page: 1 },
    { title: '2 Method', level: 1, page: 2 },
  ]
  const nodes = buildStructure({ type: 'paper', numPages: 3, outline, pages })

  assert.equal(nodes.filter(node => node.kind === 'pass').length, 0)
  assert.equal(byTitle(nodes, '1 Introduction').pageEnd, 2)
  assert.equal(byTitle(nodes, '2 Method').pageEnd, 3)
})

test('a book without headings keeps page chunks side by side', () => {
  const pages = Array.from({ length: 20 }, (_, index) => ({
    page: index + 1,
    text: `这是第 ${index + 1} 页的正文，没有任何小节标题。`,
  }))
  const nodes = buildStructure({ type: 'book', numPages: 20, outline: [], pages })
  const rows = sections(nodes)

  assert.ok(rows.length >= 2)
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!
    const current = rows[index]!
    assert.equal(current.pageStart, previous.pageEnd + 1)
  }
})