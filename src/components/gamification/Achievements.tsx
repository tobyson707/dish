import { useState } from 'react'
import type { AchievementDef } from '@/data/gamification'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Sheet } from '@/components/ui/Sheet'

const ICONS: IconName[] = ['diary', 'plan', 'flame', 'sparkle', 'discover', 'fridge', 'cart', 'history', 'medal']
export const achievementIcon = (name: string): IconName => (ICONS.includes(name as IconName) ? (name as IconName) : 'medal')

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function AchievementBadge({ def, unlockedAt, size = 56 }: { def: AchievementDef; unlockedAt?: string; size?: number }) {
  const on = !!unlockedAt
  return (
    <span className="relative inline-flex shrink-0" aria-hidden="true">
      <span className={cn('flex items-center justify-center rounded-full transition-colors', on ? 'bg-ink text-on-ink' : 'bg-dot-soft text-muted')} style={{ width: size, height: size }}>
        <Icon name={achievementIcon(def.icon)} size={Math.round(size * 0.42)} />
      </span>
      {on ? (
        <span className="absolute right-0 top-0 h-3 w-3 rounded-full bg-accent ring-2 ring-bg" />
      ) : (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg text-muted ring-1 ring-line">
          <Icon name="lock" size={11} />
        </span>
      )}
    </span>
  )
}

export function AchievementGrid({ defs, unlocked }: { defs: AchievementDef[]; unlocked: Record<string, string> }) {
  const [open, setOpen] = useState<AchievementDef | null>(null)
  const count = defs.filter((d) => unlocked[d.id]).length
  return (
    <>
      <p className="mb-3 text-sm text-ink-2">
        <span className="num font-semibold text-ink">{count}</span> of {defs.length} unlocked
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {defs.map((d) => {
          const at = unlocked[d.id]
          return (
            <li key={d.id}>
              <button type="button" onClick={() => setOpen(d)} className={cn('press flex h-full w-full flex-col items-center gap-2 rounded-lg px-3 py-4 text-center', at ? 'bg-elevated' : 'bg-surface')} aria-label={`${d.name}, ${at ? 'unlocked' : 'locked'}. ${at ? d.description : d.requirement}`}>
                <AchievementBadge def={d} unlockedAt={at} />
                <span className={cn('text-sm font-bold leading-tight', !at && 'text-ink-2')}>{d.name}</span>
                <span className="text-[12px] leading-snug text-muted">{at ? d.description : d.requirement}</span>
                <span className={cn('mt-auto text-[11px] font-semibold uppercase tracking-wider', at ? 'text-ink' : 'text-muted')}>{at ? `Unlocked ${formatDate(at)}` : 'Locked'}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''}>
        {open && (
          <div className="flex flex-col items-center gap-4 pb-2 text-center">
            <AchievementBadge def={open} unlockedAt={unlocked[open.id]} size={84} />
            <p className="text-ink-2">{open.description}</p>
            <div className="w-full rounded-md bg-surface px-4 py-3 text-left text-sm">
              <p className="label-caps">How to unlock</p>
              <p className="mt-1">{open.requirement}</p>
            </div>
            <p className="text-sm font-semibold">{unlocked[open.id] ? `Unlocked on ${formatDate(unlocked[open.id]!)}` : 'Not unlocked yet'}</p>
          </div>
        )}
      </Sheet>
    </>
  )
}
