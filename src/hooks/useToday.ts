import { DEFAULT_CURRENCY } from '@/lib/geo'
import { useEffect, useState } from 'react'
import { useProfile } from '@/data/profile'
import { appToday, useDev } from '@/dev/devStore'

/**
 * Today's ISO date in the user's timezone. Updates after midnight and on refocus.
 * In Developer Mode (never in production) this follows the simulated clock.
 */
export function useToday(): string {
  const tz = useProfile().data?.timezone
  const dev = useDev()
  const [today, setToday] = useState(() => appToday(tz, dev))
  useEffect(() => {
    const update = () => setToday(appToday(tz, dev))
    update()
    const t = setInterval(update, 60_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', update)
    }
  }, [tz, dev])
  return today
}

export function useCurrency(): string {
  return useProfile().data?.currency ?? DEFAULT_CURRENCY
}
