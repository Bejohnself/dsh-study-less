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

  assert.equal(byTitle(nodes, '第1章 引论').pageEnd, 1)
  // 1.1 cannot end on page 1: page 2 carries its tail above the 1.2 heading.
  assert.equal(byTitle(nodes, '1.1 起点').pageEnd, 2)
  // 1.3 starts on page 4, so 1.2 reads up to that shared page as well.
  assert.equal(byTitle(nodes, '1.2 第二节').pageEnd, 4)
  assert.equal(byTitle(nodes, '1.3 第三节').pageEnd, 5)
})

test('a section that opens its page still shares it with the section before', () => {
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

  // A section heading is indistinguishable from the running head that repeats
  // its words, so the page it starts on belongs to both units.
  assert.equal(byTitle(nodes, '1.1 起点').pageEnd, 2)
  assert.equal(byTitle(nodes, '1.2 第二节').pageEnd, 3)
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
  assert.equal(byTitle(nodes, '第2章 新章').pageEnd, 2)
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