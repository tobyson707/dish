import { useTheme } from '@/theme/ThemeProvider'
import type { ThemePreference } from '@/theme/theme'
import { useGamification, useSetGamificationFeedback } from '@/data/gamification'
import { PageHeader, Section } from '@/components/ui/Layout'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Toggle } from '@/components/ui/Inputs'
import { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { setSoundPrefs, useSoundPrefs } from '@/lib/uiSound'
import { Link } from 'react-router'
import { AboutDish } from './AboutDish'
import { formatTime, localeClock, useClockPreference, type ClockPreference } from '@/lib/time'
import { Segmented } from '@/components/ui/Inputs'

const OPTIONS: { value: ThemePreference; label: string; hint: string; icon: IconName }[] = [
  { value: 'light', label: 'Light', hint: 'Always use light appearance.', icon: 'sun' },
  { value: 'dark', label: 'Dark', hint: 'Always use dark appearance.', icon: 'moon' },
  { value: 'system', label: 'System default', hint: 'Follow your device settings.', icon: 'monitor' },
]

export function SettingsPage() {
  const { preference, resolved, setPreference } = useTheme()
  const g = useGamification()
  const setFeedback = useSetGamificationFeedback()
  const toast = useToast()
  const sound = useSoundPrefs()
  const [clock, setClock] = useClockPreference()
  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="App preferences" />
      <Section title="Appearance" className="mt-0">
        <div role="radiogroup" aria-label="Appearance" className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((o) => {
            const on = preference === o.value
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPreference(o.value)}
                className={cn('press flex items-center gap-3 rounded-lg p-4 text-left transition-colors sm:flex-col sm:items-start', on ? 'bg-ink text-on-ink' : 'bg-elevated text-ink ring-1 ring-inset ring-line')}
              >
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', on ? 'bg-accent text-accent-ink' : 'bg-surface')}>
                  <Icon name={o.icon} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-bold">
                    {o.label}
                    {on && <Icon name="check" size={16} aria-label="Selected" />}
                  </span>
                  <span className={cn('block text-footnote', on ? 'opacity-75' : 'text-muted')}>{o.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-sm text-muted" aria-live="polite">
          {preference === 'system' ? `Following your device, currently ${resolved}.` : `Using ${resolved} appearance on every screen.`} Saved to your account.
        </p>
      </Section>
      <Section title="Progress">
        <div className="rounded-lg bg-elevated px-4">
          <Toggle
            label="Progress feedback"
            description="Show small XP, level and achievement notes after you plan or log meals."
            checked={g.data?.feedback_enabled ?? true}
            disabled={!g.data}
            onChange={(v) => setFeedback.mutate(v, { onError: (e) => toast.error(friendlyError(e)) })}
          />
        </div>
        <p className="mt-2 text-sm text-muted">Your XP and achievements are still recorded when feedback is off.</p>
      </Section>
      <Section title="Time format">
        <Segmented<ClockPreference>
          label="Time format"
          hideLabel
          value={clock}
          onChange={setClock}
          options={[
            { value: 'auto', label: `Automatic (${localeClock() === '12h' ? '12-hour' : '24-hour'})` },
            { value: '12h', label: '12-hour' },
            { value: '24h', label: '24-hour' },
          ]}
        />
        <p className="mt-2 text-sm text-muted">Times show as {formatTime('19:30', clock === 'auto' ? localeClock() : clock)}. Saved on this device; your meal times don’t change.</p>
      </Section>
      <Section title="Sounds">
        <div className="rounded-lg bg-elevated px-4">
          <Toggle label="Interface sounds" description="Soft, short sounds when you press, choose, save or finish something. Never while you type or scroll." checked={sound.on} onChange={(on) => setSoundPrefs({ on })} />
          <div className={cn('border-t border-line py-4', !sound.on && 'opacity-45')}>
            <label htmlFor="ui-volume" className="flex items-center justify-between text-sm font-semibold">
              Volume <span className="num font-normal text-muted">{Math.round(sound.volume * 100)}%</span>
            </label>
            <input
              id="ui-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sound.volume}
              disabled={!sound.on}
              onChange={(e) => setSoundPrefs({ volume: Number(e.target.value) })}
              className="mt-3 w-full accent-[var(--c-accent)]"
            />
          </div>
        </div>
        <p className="mt-2 text-sm text-muted">Saved to your account. Everything works the same with sounds off.</p>
      </Section>
      <Section title="More">
        <ul className="divide-y divide-line overflow-hidden rounded-lg bg-elevated">
          <MoreLink to="/profile/notifications" icon="bell" title="Reminders" sub="Meal, prep and shopping reminders" />
          <MoreLink to="/profile/sync" icon="cloud" title="Offline & sync" sub="Changes waiting to sync, and what's saved on this device" />
        </ul>
      </Section>
      <Section title="Support">
        <ul className="divide-y divide-line overflow-hidden rounded-lg bg-elevated">
          {SUPPORT_EMAIL && <MoreLink href={`mailto:${SUPPORT_EMAIL}`} icon="info" title="Contact support" sub={SUPPORT_EMAIL} />}
          <MoreLink to="/terms" icon="diary" title="Terms" sub="The terms of using DISH" />
          <MoreLink to="/privacy" icon="shield" title="Privacy policy" sub="What DISH stores and why" />
        </ul>
        <p className="mt-2 text-sm text-muted">DISH gives general food information, not medical advice.</p>
      </Section>
      <AboutDish />
    </div>
  )
}

/** Shown only when a support address is configured (VITE_SUPPORT_EMAIL); none is invented. */
const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || null

function MoreLink({ to, href, icon, title, sub }: { to?: string; href?: string; icon: IconName; title: string; sub: string }) {
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface"><Icon name={icon} size={20} /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-footnote text-muted">{sub}</span>
      </span>
      <Icon name="right" size={18} className="text-muted" />
    </>
  )
  const cls = 'press flex items-center gap-4 px-4 py-3.5 hover:bg-ink/5'
  return <li>{to ? <Link to={to} className={cls}>{body}</Link> : <a href={href} className={cls}>{body}</a>}</li>
}
