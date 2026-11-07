import { useState } from 'react'
import { useNotificationPrefs, useUpdateNotificationPrefs } from '@/data/profile'
import type { NotificationPrefs } from '@/types/db'
import { notificationPermission, pushSupported, requestNotificationPermission, subscribePush, unsubscribePush, type PermissionState } from '@/platform/notifications'
import { WEEKDAY_ABBR } from '@domain/dates.ts'
import { PageHeader } from '@/components/ui/Layout'
import { Toggle } from '@/components/ui/Inputs'
import { Select } from '@/components/ui/Field'
import { ErrorState, Notice } from '@/components/ui/States'
import { GhostRegion, HeaderGhost, ListRowsGhost } from '@/components/ui/Ghost'
import { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'
import { TimeField } from '@/components/ui/TimePicker'

export function NotificationsPage() {
  const prefs = useNotificationPrefs()
  const update = useUpdateNotificationPrefs()
  const toast = useToast()
  const [perm, setPerm] = useState<PermissionState>(notificationPermission())

  async function set(patch: Partial<NotificationPrefs>) {
    const turningOn = Object.entries(patch).some(([k, v]) => k.endsWith('_reminders') && v === true)
    try {
      if (turningOn && perm !== 'granted') {
        if (perm === 'unsupported') return toast.error("This browser doesn't support notifications.")
        const r = await requestNotificationPermission()
        setPerm(r)
        if (r !== 'granted') return toast.show('Notifications are blocked. You can allow them in your browser settings.')
      }
      let push: unknown = undefined
      if (turningOn && pushSupported()) push = await subscribePush().catch(() => null)
      const next = { ...prefs.data!, ...patch }
      const anyOn = next.meal_reminders || next.prep_reminders || next.grocery_reminders || next.plan_reminders
      if (!anyOn) {
        await unsubscribePush().catch(() => {})
        push = null
      }
      await update.mutateAsync(push === undefined ? patch : { ...patch, push_subscription: push })
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  if (prefs.isPending) return <GhostRegion label="Loading reminders"><HeaderGhost /><ListRowsGhost rows={4} icon={false} /></GhostRegion>
  if (prefs.isError) return <ErrorState message={friendlyError(prefs.error)} onRetry={() => prefs.refetch()} />
  const p = prefs.data
  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="Reminders" />
      {perm === 'denied' && <Notice tone="warning">Notifications are blocked for DISH in your browser settings. Allow them there to get reminders.</Notice>}
      {perm === 'unsupported' && <Notice tone="warning">This browser doesn't support notifications.</Notice>}
      <div className="mt-4 divide-y divide-line rounded-lg bg-elevated px-4">
        <Toggle label="Meal reminders" description="At each planned meal time" checked={p.meal_reminders} onChange={(v) => void set({ meal_reminders: v })} />
        <Toggle label="Cooking reminders" description="Before meals you plan to cook" checked={p.prep_reminders} onChange={(v) => void set({ prep_reminders: v })} />
        <Toggle label="Shopping reminders" description="On your shopping day" checked={p.grocery_reminders} onChange={(v) => void set({ grocery_reminders: v })} />
        <Toggle label="Plan reminders" description="When your plan is about to run out" checked={p.plan_reminders} onChange={(v) => void set({ plan_reminders: v })} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Select label="Cooking lead time" value={String(p.lead_minutes)} onChange={(e) => void set({ lead_minutes: Number(e.target.value) })} options={[15, 30, 45, 60, 90].map((m) => ({ value: String(m), label: `${m} min before` }))} />
        <Select label="Shopping day" value={p.grocery_day == null ? '' : String(p.grocery_day)} onChange={(e) => void set({ grocery_day: e.target.value === '' ? null : Number(e.target.value) })} options={[{ value: '', label: 'None' }, ...WEEKDAY_ABBR.map((d, i) => ({ value: String(i), label: d }))]} />
        <TimeField label="Quiet from" optional fallback="22:00" value={p.quiet_start ?? null} onChange={(v) => void set({ quiet_start: v })} />
        <TimeField label="Quiet until" optional fallback="07:00" value={p.quiet_end ?? null} onChange={(v) => void set({ quiet_end: v })} />
      </div>
      <Notice icon="info">
        {pushSupported()
          ? 'Reminders can arrive even when DISH is closed, where your browser supports push. On iPhone, add DISH to your Home Screen first (iOS 16.4+).'
          : "Reminders show while DISH is open. Background push isn't configured on this server yet."}
      </Notice>
    </div>
  )
}
