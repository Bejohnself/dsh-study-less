/**
 * Study desk design system.
 *
 * Blue-led palette with explicit surfaces: the page owns its background, text
 * and elevation instead of borrowing shell colors as fills, so contrast holds in
 * both themes. The dark palette follows the attribute installed by theme.ts.
 */

import { BASE_CSS } from './styles/base.ts'
import { READING_CSS } from './styles/reading.ts'
import { PANELS_CSS } from './styles/panels.ts'
import { VISUALS_CSS } from './styles/visuals.ts'
import { RAIL_CSS } from './styles/rail.ts'
import { FULLSCREEN_CSS } from './styles/fullscreen.ts'

let injected = false

/** One stylesheet, in source order. */
export const STUDY_CSS = [
  BASE_CSS,
  READING_CSS,
  PANELS_CSS,
  VISUALS_CSS,
  RAIL_CSS,
  FULLSCREEN_CSS,
].join('\n')

/** Inject the stylesheet once per document. */
export function ensureStudyStyles(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const style = document.createElement('style')
  style.setAttribute('data-dsh-study-style', '')
  style.textContent = STUDY_CSS
  document.head.append(style)
  // KaTeX 自己的样式表与字体由 Host 提供，公式才长得像大家见过的样子。
  if (document.querySelector('link[data-dsh-study-katex]') === null) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/study-api/katex/katex.min.css'
    link.setAttribute('data-dsh-study-katex', '')
    document.head.append(link)
  }
}
