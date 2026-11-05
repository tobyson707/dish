// Theme primitives shared by the provider and tests. The inline pre-paint script
// in index.html mirrors resolve()/apply() so the first paint is already correct.
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_KEY = 'dish-theme'
export const THEME_DIRTY_KEY = 'dish-theme-dirty' // local change not yet saved to the profile
export const THEME_SAVED_AT_KEY = 'dish-theme-saved-at' // when the local choice last reached the profile
const META_COLOR: Record<ResolvedTheme, string> = { light: '#FFFFFF', dark: '#111111' }

export const isPreference = (v: unknown): v is ThemePreference => v === 'light' || v === 'dark' || v === 'system'

export function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(pref: ThemePreference, system: ResolvedTheme = systemTheme()): ResolvedTheme {
  return pref === 'system' ? system : pref
}

export function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return isPreference(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

export function storePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    /* storage unavailable: preference still applies for this session */
  }
}

let target: ResolvedTheme | null = null // latest requested theme (a cross-fade may still be pending)

export function applyTheme(theme: ResolvedTheme, opts: { animate?: boolean } = {}): void {
  const root = document.documentElement
  const current = target ?? root.dataset.theme
  target = theme
  if (current === theme && root.dataset.theme === theme) return
  // Always apply the LATEST request: a deferred cross-fade must never land a superseded theme.
  const swap = () => {
    const t = target ?? theme
    root.dataset.theme = t
    root.style.colorScheme = t
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[t])
  }
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const doc = document as Document & { startViewTransition?: (cb: () => void) => ViewTransitionLike }
  // One brief root cross-fade where supported; instant otherwise or with reduced motion.
  if (opts.animate && !reduce && typeof doc.startViewTransition === 'function') {
    const vt = doc.startViewTransition(swap)
    // A newer change can supersede this transition (it is then skipped and its
    // promises reject) — that's expected, the latest theme still applies.
    for (const p of [vt?.ready, vt?.finished, vt?.updateCallbackDone]) p?.catch(() => {})
  } else swap()
}

interface ViewTransitionLike {
  ready?: Promise<unknown>
  finished?: Promise<unknown>
  updateCallbackDone?: Promise<unknown>
}
