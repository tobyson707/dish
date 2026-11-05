import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyTheme, readStoredPreference, resolveTheme, storePreference, systemTheme, THEME_DIRTY_KEY, type ResolvedTheme, type ThemePreference } from './theme'

interface ThemeContextValue {
  /** what the user chose */
  preference: ThemePreference
  /** what is actually rendered */
  resolved: ResolvedTheme
  /** user-initiated change: applies immediately and is queued for saving to the profile */
  setPreference: (p: ThemePreference) => void
  /** adopt a preference that came from the server (no save-back) */
  syncPreference: (p: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Global theme state. The only place in the app that changes the theme. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readStoredPreference)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)
  const resolved = resolveTheme(preference, system)

  // Follow the device setting live (only matters while preference is "system").
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const on = () => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => applyTheme(resolved, { animate: true }), [resolved])

  const setPreference = useCallback((p: ThemePreference) => {
    storePreference(p)
    try {
      localStorage.setItem(THEME_DIRTY_KEY, '1')
    } catch {
      /* ignore */
    }
    setPref(p)
    window.dispatchEvent(new Event('dish-theme-changed'))
  }, [])

  const syncPreference = useCallback((p: ThemePreference) => {
    storePreference(p)
    setPref(p)
  }, [])

  const value = useMemo(() => ({ preference, resolved, setPreference, syncPreference }), [preference, resolved, setPreference, syncPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const v = useContext(ThemeContext)
  if (!v) throw new Error('useTheme outside ThemeProvider')
  return v
}
