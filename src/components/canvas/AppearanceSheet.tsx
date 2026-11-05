import { Link } from 'react-router'
import { useTheme } from '@/theme/ThemeProvider'
import type { ThemePreference } from '@/theme/theme'
import { Sheet } from '@/components/ui/Sheet'
import { Icon, type IconName } from '@/components/ui/Icon'
import { cn } from '@/lib/cn'
import { useUiSounds } from '@/lib/uiSound'

const OPTIONS: { value: ThemePreference; label: string; hint: string; icon: IconName }[] = [
  { value: 'light', label: 'Light', hint: 'Always use the light appearance.', icon: 'sun' },
  { value: 'dark', label: 'Dark', hint: 'Always use the dark appearance.', icon: 'moon' },
  { value: 'system', label: 'System Default', hint: "Follow your device's appearance setting.", icon: 'monitor' },
]

/** Rising Appearance panel over the current screen. Uses the global theme provider (saved to the account). */
export function AppearanceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { preference, setPreference } = useTheme()
  return (
    <Sheet open={open} onClose={onClose} title="Appearance" description="Choose how DISH looks on your device." tone="glass">
      <div role="radiogroup" aria-label="Appearance" className="flex flex-col gap-3 pt-2">
        {OPTIONS.map((o) => {
          const on = preference === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPreference(o.value)}
              className={cn(
                'press flex items-center gap-4 rounded-[26px] px-5 py-4 text-left transition-[background-color,box-shadow,color] duration-300',
                on ? 'bg-accent text-accent-ink' : 'bg-white/6 text-on-glass-dark ring-1 ring-inset ring-white/12 hover:bg-white/10',
              )}
            >
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', on ? 'bg-white/35' : 'bg-white/8')}>
                <Icon name={o.icon} size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{o.label}</span>
                <span className={cn('block text-[13px]', on ? 'opacity-80' : 'text-on-glass-dark-muted')}>{o.hint}</span>
              </span>
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-[opacity,transform] duration-300', on ? 'scale-100 bg-ink text-on-ink opacity-100' : 'scale-75 opacity-0')} aria-hidden="true">
                <Icon name="check" size={15} />
              </span>
            </button>
          )
        })}
      </div>
      <SoundRow />
      <Link to="/profile/settings" onClick={onClose} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-on-glass-dark-muted underline-offset-2 hover:text-on-glass-dark hover:underline">
        All settings <Icon name="right" size={14} />
      </Link>
    </Sheet>
  )
}

/** Dial sounds on/off — same persistent preference as Settings → Sounds. */
function SoundRow() {
  const [on, setOn] = useUiSounds()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setOn(!on)}
      className="press mt-3 flex w-full items-center gap-4 rounded-[26px] px-5 py-3.5 text-left ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.06]"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-on-glass-dark">Interface sounds</span>
        <span className="block text-[13px] text-on-glass-dark-muted">A quiet click when you turn the category dial.</span>
      </span>
      <span aria-hidden="true" className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300', on ? 'bg-accent' : 'bg-white/15')}>
        <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-on-glass-dark shadow transition-transform duration-300 [transition-timing-function:var(--ease-spring)]', on ? 'translate-x-6' : 'translate-x-1')} />
      </span>
    </button>
  )
}
