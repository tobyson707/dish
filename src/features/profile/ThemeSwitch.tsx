import { useEffect, useState } from 'react'
import { Segmented } from '@/components/ui/Inputs'

type Theme = 'system' | 'light' | 'dark'
const KEY = 'dish-theme'

export function applyStoredTheme() {
  try {
    const t = localStorage.getItem(KEY) as Theme | null
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
  } catch {
    /* storage unavailable */
  }
}

export function ThemeSwitch() {
  const [t, setT] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(KEY) as Theme) || 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    if (t === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = t
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* ignore */
    }
  }, [t])
  return <Segmented label="Appearance" value={t} onChange={setT} options={[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
}
