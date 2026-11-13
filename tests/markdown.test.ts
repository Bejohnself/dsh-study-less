import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../src/client/markdown.ts'

const mathCount = (html: string): number => (html.match(/<math/g) ?? []).length

test('inline math with padding renders', () => {
  assert.equal(mathCount(renderMarkdown('值是 $ \\alpha $ 这样。')), 1)
  assert.equal(mathCount(renderMarkdown('值是 $x + y$ 这样。')), 1)
})

test('currency is not mistaken for math', () => {
  const html = renderMarkdown('价格是 $5 and $10 美元。')
  assert.equal(mathCount(html), 0)
  assert.ok(html.includes('$5 and $10'))
})

test('display math and latex environments render', () => {
  assert.equal(mathCount(renderMarkdown('$$\\frac{a}{b}$$')), 1)
  assert.equal(mathCount(renderMarkdown('\\[x=1\\]')), 1)
  assert.equal(mathCount(renderMarkdown('\\begin{equation}x=1\\end{equation}')), 1)
})

test('paren delimiters and escaped dollars work', () => {
  assert.equal(mathCount(renderMarkdown('旧写法 \\(x^2\\)。')), 1)
  assert.equal(mathCount(renderMarkdown('价格 \\$5。')), 0)
})

test('mathrm function names are kept together', () => {
  const html = renderMarkdown('$$\\mathrm{Attention}(Q,K,V)$$')
  assert.ok(html.includes('>Attention</mi>'))
  assert.ok(!html.includes('<mi mathvariant="normal">A</mi>'))
})

test('code fences keep dollars literal', () => {
  const html = renderMarkdown('```js\nconst price = "$100"\n```\n\n正文 $x$。')
  assert.ok(html.includes('$100'))
  assert.equal(mathCount(html), 1)
})
