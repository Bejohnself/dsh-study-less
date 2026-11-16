import { renderMarkdown } from '../../../src/client/markdown.ts'

const cases = {
  inline: '分数是 $\\frac{a}{b}$ 这样。',
  display: '$$\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V$$',
  paren: '旧写法 \\(x^2\\) 也要能渲染。',
  currency: '价格是 $5 and $10 美元。',
  code: '```js\nconst price = "$100";\n```\n\n正文 $x$。',
  html: '<script>alert(1)</script>',
}
for (const [name, source] of Object.entries(cases)) {
  const html = renderMarkdown(source)
  const mathCount = (html.match(/<math/g) ?? []).length
  const script = html.includes('<script')
  console.log(`${name}: math=${mathCount} script=${script} | ${html.replace(/\s+/g, ' ').slice(0, 140)}`)
}
