import { useEffect, useState } from 'react'

/** A short wait after a temporary restriction, shown as a countdown. Cleared when it ends. */
export function useCooldown() {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  const label = left >= 60 ? `${Math.ceil(left / 60)} min` : `${left}s`
  return {
    left,
    label,
    start: (seconds: number) => {
      setNow(Date.now())
      setUntil(Date.now() + seconds * 1000)
    },
  }
}
