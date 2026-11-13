/**
 * Theme detection for the study desk.
 *
 * The desk brings its own blue palette instead of borrowing shell text colors
 * as surfaces (which produced unreadable blocks). The palette follows the shell:
 * the document's actual background decides light or dark, so an explicit shell
 * theme wins over the OS preference.
 */

const THEME_ATTR = 'data-dsh-study-theme'

/** Parse an `rgb()`/`rgba()` color into relative luminance. */
function luminanceOf(color: string): number | null {
  const match = /rgba?\(([^)]+)\)/.exec(color)
  if (match === null) return null
  const parts = match[1]!.split(/[,/\s]+/).map(Number)
  if (parts.length < 3 || parts.some(value => Number.isNaN(value))) return null
  const [r, g, b] = parts as [number, number, number]
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Decide the theme from what the page actually looks like. */
function detectTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const body = document.body
  const root = document.documentElement
  for (const element of [body, root]) {
    const background = getComputedStyle(element).backgroundColor
    const luminance = luminanceOf(background)
    if (luminance !== null && /rgba?\([^)]*\)/.test(background) && !/rgba\([^)]*,\s*0(\.0+)?\)$/.test(background)) {
      return luminance < 0.45 ? 'dark' : 'light'
    }
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Install the theme attribute and keep it in sync with the shell.
 * @returns the disposer that removes every listener.
 */
export function installTheme(): () => void {
  if (typeof document === 'undefined') return () => undefined

  const apply = (): void => {
    document.documentElement.setAttribute(THEME_ATTR, detectTheme())
  }
  apply()

  const media = matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', apply)

  const observer = new MutationObserver(apply)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'style'],
  })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })

  return () => {
    media.removeEventListener('change', apply)
    observer.disconnect()
    document.documentElement.removeAttribute(THEME_ATTR)
  }
}
