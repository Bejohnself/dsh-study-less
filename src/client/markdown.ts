/**
 * Markdown rendering for study notes, with LaTeX math.
 *
 * Raw HTML is escaped (notes are generated content rendered into the app
 * origin), while math is protected before escaping and rendered by KaTeX to
 * self-contained MathML — no fonts, no stylesheet, no external assets.
 */
import { marked } from '../../vendor/marked/marked.mjs'
import katex from '../../vendor/katex/katex.mjs'

/** Placeholder that survives markdown parsing. */
const TOKEN = '\u0000MATH'

/** Render one TeX fragment to MathML, or fall back to its source on error. */
function renderTex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode: display,
      output: 'mathml',
      throwOnError: false,
      strict: false,
    })
  } catch {
    return `<code>${tex.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`
  }
}

/** Escape one text segment for HTML. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Replace math delimiters in one prose segment with rendered placeholders. */
function extractMath(segment: string, math: string[]): string {
  const protect = (tex: string, display: boolean): string => {
    math.push(renderTex(tex, display))
    return `${TOKEN}${math.length - 1}\u0000`
  }
  let value = segment
  // Block math first: $$...$$ and \[...\]
  value = value.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => protect(tex, true))
  value = value.replace(/\\\[([\s\S]+?)\\\]/g, (_match, tex: string) => protect(tex, true))
  // Inline math: $...$ (not $$) and \(...\).
  // Opening $ must not be followed by a space or another $; the closing $ must
  // not be preceded by a space nor followed by a digit, so "$5 and $10" is not
  // mistaken for math.
  value = value.replace(
    /(?<![\w$])\$(?![\s$])([^\s$](?:[^$\n]*?[^\s$])?)\$(?![\d$])/g,
    (_match, tex: string) => protect(tex, false),
  )
  value = value.replace(/\\\(([\s\S]+?)\\\)/g, (_match, tex: string) => protect(tex, false))
  return value
}

/**
 * Render study notes to HTML.
 * @param markdown - the notes source.
 * @returns safe HTML with MathML for every formula.
 */
export function renderMarkdown(markdown: string): string {
  const math: string[] = []
  // Keep fenced code and inline code untouched: math delimiters inside code are
  // literal, and their content must not be escaped twice.
  const parts = markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  const escaped = parts
    .map((part, index) => (index % 2 === 1 ? part : extractMath(part, math)))
    .join('')

  const html = marked.parse(escapeHtml(escaped), { async: false })
  const text = typeof html === 'string' ? html : ''
  return text.replace(new RegExp(`${TOKEN}(\\d+)\u0000`, 'g'), (_match, index: string) => math[Number(index)] ?? '')
}
