/**
 * Theme for the study desk: 纸 (light) or 墨 (dark), plus 跟随外壳 (auto).
 *
 * The palette itself lives in styles.ts; this module only decides which
 * attribute `[data-dsh-study]` reads. `auto` follows what the page actually
 * looks like, so an explicit shell theme wins over the OS preference — the desk
 * never sits as a light rectangle inside a dark shell.
 *
 * The choice is per browser (localStorage), not per library: it belongs to the
 * screen you are reading on, not to the data.
 */

/** What the user picked: a fixed paper/ink look, or whatever the shell uses. */
export type ThemePreference = 'auto' | 'light' | 'dark'

const THEME_ATTR = 'data-dsh-study-theme'
const PREF_KEY = 'dsh-study-theme-pref'

const listeners = new Set<(preference: ThemePreference) => void>()

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

/** The stored preference; anything unreadable falls back to following the shell. */
export function getPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(PREF_KEY)
    if (value === 'light' || value === 'dark' || value === 'auto') return value
  } catch {
    // A blocked localStorage only costs persistence, not the theme itself.
  }
  return 'auto'
}

/** Resolve a preference into the attribute the stylesheet reads. */
function apply(preference: ThemePreference): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute(THEME_ATTR, preference === 'auto' ? detectTheme() : preference)
}

/** Store and apply a preference, then tell every subscribed control. */
export function setPreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(PREF_KEY, preference)
  } catch {
    // Keep the choice for this page even when it cannot be stored.
  }
  apply(preference)
  for (const listener of listeners) listener(preference)
}

/** Watch preference changes (the toggle button and the settings dialog share one). */
export function subscribePreference(listener: (preference: ThemePreference) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Install the theme attribute and keep it in sync with the shell.
 * @returns the disposer that removes every listener.
 */
export function installTheme(): () => void {
  if (typeof document === 'undefined') return () => undefined

  apply(getPreference())

  // Only `auto` follows the shell; a fixed choice must not be overwritten by it.
  const follow = (): void => {
    if (getPreference() === 'auto') apply('auto')
  }

  const media = matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', follow)

  const observer = new MutationObserver(follow)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'style'],
  })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })

  // Another tab (or another panel) changed the choice: adopt it without writing back.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== PREF_KEY) return
    apply(getPreference())
    for (const listener of listeners) listener(getPreference())
  }
  window.addEventListener('storage', onStorage)

  return () => {
    media.removeEventListener('change', follow)
    observer.disconnect()
    window.removeEventListener('storage', onStorage)
    document.documentElement.removeAttribute(THEME_ATTR)
  }
}
