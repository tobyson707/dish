// Sends Web Push meal reminders. Invoke on a schedule (e.g. every 15 minutes
// via pg_cron + pg_net, see PWA_OFFLINE.md) with the SERVICE ROLE key.
// Requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT secrets.
import webpush from 'web-push'
import { handler, json, HttpError } from '../_shared/http.ts'
import { admin } from '../_shared/supabase.ts'
import { todayInTimeZone } from '../_shared/domain/dates.ts'

const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function localHM(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
}
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

Deno.serve(
  handler(async (req) => {
    if ((req.headers.get('authorization') ?? '') !== `Bearer ${SERVICE}`) throw new HttpError(401, 'Service role required', 'unauthorized')
    const pub = Deno.env.get('VAPID_PUBLIC_KEY')
    const priv = Deno.env.get('VAPID_PRIVATE_KEY')
    if (!pub || !priv) return json({ sent: 0, skipped: 'VAPID keys not configured' })
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@example.com', pub, priv)

    const svc = admin()
    const { data: prefs, error } = await svc.from('notification_preferences').select('user_id, meal_reminders, prep_reminders, lead_minutes, push_subscription, quiet_start, quiet_end').not('push_subscription', 'is', null).or('meal_reminders.eq.true,prep_reminders.eq.true').limit(1000)
    if (error) throw error
    let sent = 0
    const WINDOW = 15 // minutes between scheduled runs
    for (const p of prefs ?? []) {
      const { data: prof } = await svc.from('profiles').select('timezone').eq('id', p.user_id).single()
      const tz = prof?.timezone ?? 'UTC'
      const today = todayInTimeZone(tz)
      const nowMin = toMin(localHM(tz))
      if (p.quiet_start && p.quiet_end) {
        const qs = toMin(p.quiet_start), qe = toMin(p.quiet_end)
        if (qs < qe ? nowMin >= qs && nowMin < qe : nowMin >= qs || nowMin < qe) continue
      }
      const { data: meals } = await svc.from('planned_meals').select('id, name, slot, scheduled_time, method').eq('user_id', p.user_id).eq('date', today).eq('status', 'planned').not('scheduled_time', 'is', null)
      for (const m of meals ?? []) {
        const at = toMin(String(m.scheduled_time))
        const lead = p.prep_reminders && m.method === 'cook' ? p.lead_minutes : 0
        const due = at - lead
        if (due < nowMin || due >= nowMin + WINDOW) continue
        const body = lead ? `Time to start cooking ${m.name} for ${m.slot}.` : `${m.name} is on the menu for ${m.slot}.`
        try {
          await webpush.sendNotification(p.push_subscription, JSON.stringify({ title: 'DISH', body, tag: `meal-${m.id}`, url: `/meal/${m.id}` }))
          sent++
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) await svc.from('notification_preferences').update({ push_subscription: null }).eq('user_id', p.user_id)
        }
      }
    }
    return json({ sent })
  }),
)
