import { useEffect } from 'react'
import { useNotificationPrefs } from '@/data/profile'
import { usePlannedMeals } from '@/data/plans'
import { useToday } from '@/hooks/useToday'
import { notificationPermission, showLocalNotification } from '@/platform/notifications'
import { SLOT_LABEL } from '@domain/types.ts'

/**
 * In-app reminders while DISH is open (works without a push server). Server
 * push via the send-reminders Edge Function covers the app-closed case where
 * the browser supports Web Push.
 */
export function ReminderScheduler() {
  const today = useToday()
  const prefs = useNotificationPrefs()
  const meals = usePlannedMeals(today, today)
  useEffect(() => {
    const p = prefs.data
    if (!p || (!p.meal_reminders && !p.prep_reminders) || notificationPermission() !== 'granted') return
    const timers: ReturnType<typeof setTimeout>[] = []
    const now = Date.now()
    for (const m of meals.data ?? []) {
      if (m.status !== 'planned' || !m.scheduled_time) continue
      const [h, min] = m.scheduled_time.split(':').map(Number)
      const at = new Date()
      at.setHours(h ?? 0, min ?? 0, 0, 0)
      const schedule = (when: number, body: string, tag: string) => {
        const delay = when - now
        if (delay > 0 && delay < 24 * 3600_000) timers.push(setTimeout(() => void showLocalNotification('DISH', body, tag), delay))
      }
      if (p.meal_reminders) schedule(at.getTime(), `${m.name} is on the menu for ${SLOT_LABEL[m.slot].toLowerCase()}.`, `meal-${m.id}`)
      if (p.prep_reminders && m.method === 'cook') schedule(at.getTime() - p.lead_minutes * 60_000, `Time to start cooking ${m.name}.`, `prep-${m.id}`)
    }
    return () => timers.forEach(clearTimeout)
  }, [prefs.data, meals.data])
  return null
}
