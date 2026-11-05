import { useTheme } from '@/theme/ThemeProvider'
import type { ThemePreference } from '@/theme/theme'
import { useGamification, useSetGamificationFeedback } from '@/data/gamification'
import { PageHeader, Section } from '@/components/ui/Layout'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Toggle } from '@/components/ui/Inputs'
import { useToast } from '@/components/ui/Toast'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { useUiSounds } from '@/lib/uiSound'

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
  const [sounds, setSounds] = useUiSounds()
  return (
    <div>
      <PageHeader back="/profile" eyebrow="Profile" title="Settings" />
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
                  <span className={cn('block text-[13px]', on ? 'opacity-75' : 'text-muted')}>{o.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-sm text-muted" aria-live="polite">
          {preference === 'system' ? `Following your device — currently ${resolved}.` : `Using ${resolved} appearance on every screen.`} Saved to your account.
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
      <Section title="Sounds">
        <div className="rounded-lg bg-elevated px-4">
          <Toggle label="Interface sounds" description="A quiet dial click (and a tiny vibration where supported) when you turn the category selector." checked={sounds} onChange={setSounds} />
        </div>
        <p className="mt-2 text-sm text-muted">Saved on this device. Everything works the same with sounds off.</p>
      </Section>
    </div>
  )
}
