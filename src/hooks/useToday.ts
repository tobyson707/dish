import { DEFAULT_CURRENCY } from '@/lib/geo'
import { useEffect, useState } from 'react'
import { todayInTimeZone } from '@domain/dates.ts'
import { useProfile } from '@/data/profile'

/** Today's ISO date in the user's timezone. Updates after midnight and on refocus. */
export function useToday(): string {
  const tz = useProfile().data?.timezone
  const [today, setToday] = useState(() => todayInTimeZone(tz))
  useEffect(() => {
    const update = () => setToday(todayInTimeZone(tz))
    update()
    const t = setInterval(update, 60_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', update)
    }
  }, [tz])
  return today
}

export function useCurrency(): string {
  return useProfile().data?.currency ?? DEFAULT_CURRENCY
}
