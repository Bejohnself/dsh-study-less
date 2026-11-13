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
    // Models frequently write `\mathrm{softmax}(...)` for a function name. KaTeX
    // turns that into one <mi> per letter, which reads badly in MathML; an
    // operator name keeps the word together.
    const normalized = tex.replace(/\\mathrm\{([A-Za-z][A-Za-z0-9]*)\}(?=\s*(?:\\left\s*)?\()/g, '\\operatorname{$1}')
    return katex.renderToString(normalized.trim(), {
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

/**
 * Heuristic: does the text between two `$` look like math rather than currency?
 *
 * Models often write `$ \alpha $` with padding; the old regex rejected that, so
 * the formula showed as raw `$...$` (including a visible `\mathrm`). Accept
 * padding when the content carries a LaTeX signal, and keep `$5 and $10` as text.
 */
function looksLikeMath(content: string): boolean {
  const text = content.trim()
  if (text.length === 0 || text.length > 500) return false
  if (text.includes('\n') || text.includes('$')) return false
  if (/[\\^_{}]/.test(text)) return true
  if (/[=+*/<>|]/.test(text) && /\s/.test(text)) return true
  if (/[=+*/<>|]/.test(text) && /[a-zA-Z0-9]/.test(text)) return true
  if (/[\u0370-\u03ff\u2200-\u22ff\u2a00-\u2aff]/.test(text)) return true
  // A bare token like `x`, `d_k` or `Q(s,a)`; reject prose with spaces.
  if (/\s/.test(text)) return false
  return text.length <= 64
}

/** Protect inline `$...$` pairs, tolerating padding inside the delimiters. */
function protectInlineDollars(segment: string, math: string[]): string {
  let out = ''
  let index = 0
  while (index < segment.length) {
    const char = segment[index]
    if (char === '\\' && segment[index + 1] === '$') {
      out += '\\$'
      index += 2
      continue
    }
    if (char !== '$' || segment[index + 1] === '$') {
      out += char
      index += 1
      continue
    }
    let end = index + 1
    let closed = -1
    while (end < segment.length) {
      if (segment[end] === '\\') {
        end += 2
        continue
      }
      if (segment[end] === '$') {
        closed = end
        break
      }
      if (segment[end] === '\n') break
      end += 1
    }
    if (closed > 0) {
      const content = segment.slice(index + 1, closed)
      if (looksLikeMath(content)) {
        math.push(renderTex(content, false))
        out += `${TOKEN}${math.length - 1}\u0000`
        index = closed + 1
        continue
      }
    }
    out += '$'
    index += 1
  }
  return out
}

/** Replace math delimiters in one prose segment with rendered placeholders. */
function extractMath(segment: string, math: string[]): string {
  const protect = (tex: string, display: boolean): string => {
    math.push(renderTex(tex, display))
    return `${TOKEN}${math.length - 1}\u0000`
  }
  let value = segment
  // Block math first: $$...$$, \[...\], and standalone LaTeX environments.
  value = value.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => protect(tex, true))
  value = value.replace(/\\\[([\s\S]+?)\\\]/g, (_match, tex: string) => protect(tex, true))
  value = value.replace(
    /\\begin\{(equation\*?|align\*?|aligned|gather\*?|multline\*?|eqnarray\*?|displaymath)\}([\s\S]*?)\\end\{\1\}/g,
    (_match, _env: string, tex: string) => protect(tex, true),
  )
  // Inline math: a small scanner so `$ \alpha $` works and `$5 and $10` does not.
  value = protectInlineDollars(value, math)
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
