import { Link, useLocation } from 'react-router'
import { cn } from '@/lib/cn'

export interface PillarSection {
  to: string
  label: string
  /** paths (prefixes) that count as this section, besides `to` itself */
  also?: string[]
}

/**
 * The sections of one pillar (Kitchen, Diary, …) as a quiet segmented row. Each section
 * keeps its own route, so deep links and Back work as before; this only shows that they
 * belong to one place.
 */
export function PillarTabs({ label, sections, className }: { label: string; sections: PillarSection[]; className?: string }) {
  const { pathname } = useLocation()
  const path = (to: string) => to.split('?')[0]!
  const current = sections.find((s) => [path(s.to), ...(s.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`)))
  return (
    <nav aria-label={label} className={cn('mb-5 grid gap-1 rounded-full bg-elevated p-1 ring-1 ring-inset ring-line', className)} style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}>
      {sections.map((s) => {
        const on = s === current
        return (
          <Link
            key={s.to}
            to={s.to}
            replace
            aria-current={on ? 'page' : undefined}
            className={cn('press flex h-10 items-center justify-center rounded-full px-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent', on ? 'bg-ink text-on-ink' : 'text-ink-2 hover:text-ink')}
          >
            <span className="truncate">{s.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export const KITCHEN_SECTIONS: PillarSection[] = [
  { to: '/kitchen', label: 'Kitchen' },
  { to: '/grocery', label: 'Shopping' },
  { to: '/scan', label: 'Scan' },
]

export const DIARY_SECTIONS: PillarSection[] = [
  { to: '/diary', label: 'Diary' },
  { to: '/budget', label: 'Spending' },
  { to: '/history', label: 'History' },
]
