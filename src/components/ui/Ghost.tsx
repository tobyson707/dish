import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Ghost loading: quiet placeholders shaped like the content they stand in for, shown only
 * while that content is first loading. Built from three pieces:
 *
 * - `Ghost`: one rounded surface (monochrome, one slow shimmer shared by every ghost on
 *   screen, still under reduced motion).
 * - `GhostText`: a text line exactly as tall as the real text style (so nothing moves when
 *   the words arrive), with a bar the size of the letters.
 * - `GhostRegion`: the loading semantics: one polite "Loading …" for assistive tech, the
 *   shapes themselves hidden from it. It appears after a beat, so a fast load never
 *   flashes a skeleton.
 *
 * Screen ghosts below mirror the real layouts (same radii, aspect ratios and spacing).
 */
type Tone = 'default' | 'glass'

export function Ghost({ className, style, tone }: { className?: string; style?: CSSProperties; tone?: Tone }) {
  return <span aria-hidden="true" data-tone={tone === 'glass' ? 'glass' : undefined} className={cn('ghost block', className)} style={style} />
}

type TextSize = 'micro' | 'caption' | 'footnote' | 'sm' | 'body' | 'callout' | 'headline' | 'title3' | 'title2' | 'title1' | 'display'
const TEXT: Record<TextSize, string> = {
  micro: 'text-micro',
  caption: 'text-caption',
  footnote: 'text-footnote',
  sm: 'text-sm',
  body: 'text-base',
  callout: 'text-callout',
  headline: 'text-headline',
  title3: 'text-title-3',
  title2: 'text-title-2',
  title1: 'text-title-1',
  display: 'text-display',
}

export function GhostText({ size = 'body', width = '60%', className, tone }: { size?: TextSize; width?: string | number; className?: string; tone?: Tone }) {
  return (
    <span aria-hidden="true" className={cn('relative block', TEXT[size], className)} style={{ width }}>
      <span className="invisible">&nbsp;</span>
      <span data-tone={tone === 'glass' ? 'glass' : undefined} className="ghost absolute inset-x-0 top-1/2 h-[0.62em] -translate-y-1/2 rounded-[0.32em]" />
    </span>
  )
}

export function GhostRegion({ label, children, className, as: As = 'div' }: { label: string; children: ReactNode; className?: string; as?: 'div' | 'ul' }) {
  return (
    <As role="status" aria-live="polite" aria-busy="true" aria-label={label} className={cn('ghost-region', className)}>
      <span className="sr-only">{label}…</span>
      {children}
    </As>
  )
}

/** Real content arriving after a ghost: a short fade, no movement, nothing replays on refresh. */
export const REVEAL = 'ghost-reveal'

const times = (n: number) => Array.from({ length: n }, (_, i) => i)

// ── Page shell ──────────────────────────────────────────────────────────────
/** A page header as PageHeader draws it: the action row, an eyebrow and a title. */
export function HeaderGhost({ eyebrow = true, large, actions = 0 }: { eyebrow?: boolean; large?: boolean; actions?: number }) {
  return (
    <div className="flex flex-col gap-2 pb-4 pt-2">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <Ghost className="h-9 w-9 rounded-full" />
        <span className="flex gap-2">{times(actions).map((i) => <Ghost key={i} className="h-9 w-9 rounded-full" />)}</span>
      </div>
      {eyebrow && <GhostText size="micro" width="28%" />}
      <GhostText size={large ? 'display' : 'title1'} width={large ? '55%' : '70%'} />
    </div>
  )
}

/** Any screen while who-you-are is still being confirmed: header and a few rows. */
export function PageGhost({ label = 'Loading' }: { label?: string }) {
  return (
    <GhostRegion label={label} className="mx-auto w-full max-w-3xl px-4 sm:px-6" >
      <div style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
        <HeaderGhost />
        <ListRowsGhost rows={4} />
      </div>
    </GhostRegion>
  )
}

/** Rows like the settings and history lists: a round icon, a title and a line under it. */
export function ListRowsGhost({ rows = 3, icon = true }: { rows?: number; icon?: boolean }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-lg bg-elevated">
      {times(rows).map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          {icon && <Ghost className="h-10 w-10 shrink-0 rounded-full" />}
          <span className="min-w-0 flex-1">
            <GhostText width={`${46 + ((i * 17) % 30)}%`} />
            <GhostText size="footnote" width={`${60 + ((i * 11) % 25)}%`} />
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Food ───────────────────────────────────────────────────────────────────
/** Discover's feed: a 4:3 photo, the name, a meta line and the round add button. */
export function MealFeedGhost({ count = 4, label = 'Loading meals' }: { count?: number; label?: string }) {
  return (
    <GhostRegion as="ul" label={label} className="grid gap-x-5 gap-y-7 sm:grid-cols-2">
      {times(count).map((i) => (
        <li key={i} aria-hidden="true">
          <Ghost className="aspect-[4/3] w-full rounded-[28px]" />
          <div className="mt-3 flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <GhostText size="title3" width={`${62 + ((i * 13) % 25)}%`} />
              <GhostText size="footnote" width="38%" className="mt-0.5" />
            </span>
            <Ghost className="h-10 w-10 shrink-0 rounded-full" />
          </div>
        </li>
      ))}
    </GhostRegion>
  )
}

/** Saved meals: square photos in a grid, a name beneath. */
export function SquareMealsGhost({ count = 6, label = 'Loading saved meals' }: { count?: number; label?: string }) {
  return (
    <GhostRegion as="ul" label={label} className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
      {times(count).map((i) => (
        <li key={i} aria-hidden="true">
          <Ghost className="aspect-square w-full rounded-[24px]" />
          <GhostText size="callout" width={`${55 + ((i * 19) % 35)}%`} className="mt-2" />
        </li>
      ))}
    </GhostRegion>
  )
}

/** The category drawer's list (dark glass): thumbnail, name, time and calories, add button. */
export function DrawerMealsGhost({ count = 5, compact }: { count?: number; compact?: boolean }) {
  return (
    <GhostRegion as="ul" label="Loading ideas" className="flex flex-col gap-3">
      {times(count).map((i) => (
        <li key={i} aria-hidden="true" className={cn('flex items-center rounded-[24px] bg-white/[0.05] ring-1 ring-inset ring-white/10', compact ? 'gap-2.5 p-2 pr-2.5' : 'gap-3 p-2.5 pr-3')}>
          <Ghost tone="glass" className={compact ? 'h-[64px] w-[64px] shrink-0 rounded-[16px]' : 'h-[76px] w-[86px] shrink-0 rounded-[18px]'} />
          <span className="min-w-0 flex-1 pl-0.5">
            <GhostText tone="glass" size={compact ? 'callout' : 'headline'} width={`${60 + ((i * 17) % 30)}%`} />
            <GhostText tone="glass" size="caption" width="44%" className="mt-2" />
          </span>
          <Ghost tone="glass" className="h-9 w-9 shrink-0 rounded-full" />
        </li>
      ))}
    </GhostRegion>
  )
}

/** A meal or recipe page: header, the photo at its real shape, tags, two actions, text. */
export function MealDetailGhost({ aspect = 'aspect-[4/3]', label = 'Loading meal' }: { aspect?: string; label?: string }) {
  return (
    <GhostRegion label={label}>
      <HeaderGhost actions={1} />
      <Ghost className={cn(aspect, 'w-full rounded-xl')} />
      <div className="mt-4 flex gap-2">{[64, 88, 72].map((w) => <Ghost key={w} className="h-7 rounded-full" style={{ width: w }} />)}</div>
      <GhostText width="92%" className="mt-4" />
      <GhostText width="70%" />
      <div className="mt-6 grid grid-cols-2 gap-2">
        <Ghost className="h-12 rounded-full" />
        <Ghost className="h-12 rounded-full" />
      </div>
      <Ghost className="mt-8 h-40 rounded-lg" />
    </GhostRegion>
  )
}

/** Home's featured meal: the plate and the words beside it, in their real places. */
export function FeaturedGhost() {
  return (
    <>
      <div className="feat-hero absolute z-0" aria-hidden="true">
        <Ghost className="aspect-square w-full rounded-full" />
      </div>
      <GhostRegion label="Loading today's meals" className="feat-info absolute z-20">
        <GhostText size="footnote" width="9.5rem" />
        <GhostText size="title1" width="15rem" className="mt-1 max-w-full" />
        <GhostText size="footnote" width="8rem" className="mt-2" />
        <div className="mt-4 flex gap-2">
          <Ghost className="h-11 w-36 rounded-full" />
          <Ghost className="h-11 w-24 rounded-full" />
        </div>
      </GhostRegion>
    </>
  )
}

// ── Plans ──────────────────────────────────────────────────────────────────
/** Library cards: 16:10 cover with the status chip, title, dates, meta and sharing lines. */
export function PlanCardsGhost({ count = 3, label = 'Loading plans' }: { count?: number; label?: string }) {
  return (
    <GhostRegion as="ul" label={label} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {times(count).map((i) => (
        <li key={i} aria-hidden="true" className="overflow-hidden rounded-[24px] bg-elevated">
          <div className="relative aspect-[16/10]">
            <Ghost className="absolute inset-0 rounded-none" />
          </div>
          <div className="p-4 pr-14">
            <GhostText size="title3" width={`${55 + ((i * 19) % 30)}%`} />
            <GhostText size="footnote" width="58%" className="mt-0.5" />
            <GhostText size="footnote" width="46%" className="mt-2" />
            <GhostText size="footnote" width="30%" className="mt-2" />
          </div>
        </li>
      ))}
    </GhostRegion>
  )
}

/** Published plans in Discover: cover, title, creator, facts and two small tags, Remix. */
export function CommunityPlansGhost({ count = 2 }: { count?: number }) {
  return (
    <GhostRegion as="ul" label="Loading meal plans" className="grid gap-x-5 gap-y-7 sm:grid-cols-2">
      {times(count).map((i) => (
        <li key={i} aria-hidden="true">
          <Ghost className="aspect-[16/10] w-full rounded-[26px]" />
          <div className="mt-3 flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <GhostText size="title3" width={`${60 + ((i * 21) % 30)}%`} />
              <GhostText size="footnote" width="32%" className="mt-0.5" />
              <GhostText size="footnote" width="44%" className="mt-1" />
              <span className="mt-2 flex gap-1.5"><Ghost className="h-5 w-16 rounded-full" /><Ghost className="h-5 w-20 rounded-full" /></span>
            </span>
            <Ghost className="h-10 w-24 shrink-0 rounded-full" />
          </div>
        </li>
      ))}
    </GhostRegion>
  )
}

/** A published plan's page: header, its cover, the description, the actions and the first days. */
export function PublishedPlanGhost() {
  return (
    <GhostRegion label="Loading meal plan">
      <HeaderGhost />
      <Ghost className="mb-4 aspect-[16/10] w-full rounded-[24px]" />
      <GhostText width="85%" />
      <GhostText size="footnote" width="55%" className="mt-2" />
      <div className="mt-4 flex gap-2"><Ghost className="h-12 w-28 rounded-full" /><Ghost className="h-12 w-28 rounded-full" /></div>
      <div className="mt-6"><DayListGhost /></div>
    </GhostRegion>
  )
}

/** The day-by-day list on a published plan: a day label, then slot and meal name rows. */
export function DayListGhost({ days = 2 }: { days?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      {times(days).map((d) => (
        <div key={d}>
          <GhostText size="micro" width="3.5rem" className="mb-1" />
          <div className="divide-y divide-line rounded-lg bg-elevated px-4">
            {times(3).map((r) => (
              <div key={r} className="flex gap-3 py-2">
                <GhostText size="sm" width="4.5rem" className="shrink-0" />
                <GhostText size="sm" width={`${40 + ((d * 3 + r) * 17) % 40}%`} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Saved plans: a card with its cover and three lines. */
export function SavedPlansGhost({ count = 2 }: { count?: number }) {
  return (
    <GhostRegion as="ul" label="Loading saved plans" className="grid gap-4 sm:grid-cols-2">
      {times(count).map((i) => (
        <li key={i} aria-hidden="true" className="overflow-hidden rounded-[24px] bg-elevated">
          <Ghost className="aspect-[16/10] w-full rounded-none" />
          <div className="p-4">
            <GhostText size="title3" width="64%" />
            <GhostText size="footnote" width="30%" className="mt-0.5" />
            <GhostText size="footnote" width="40%" className="mt-1.5" />
          </div>
        </li>
      ))}
    </GhostRegion>
  )
}

/** Day blocks with meal rows, as DayBlock and MealRow draw them. */
export function DayBlocksGhost({ days = 2, rows = 3, compact = true, label = 'Loading meals' }: { days?: number; rows?: number; compact?: boolean; label?: string }) {
  return (
    <GhostRegion label={label} className="flex flex-col">
      {times(days).map((d) => (
        <div key={d} className={compact ? 'border-b border-line py-3' : ''}>
          <GhostText size={compact ? 'micro' : 'title3'} width={compact ? '5.5rem' : '8rem'} className="mb-1" />
          {times(rows).map((r) => <MealRowGhost key={r} seed={d * 3 + r} />)}
        </div>
      ))}
    </GhostRegion>
  )
}

export function MealRowGhost({ seed = 0 }: { seed?: number }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 py-2.5">
      <Ghost className="h-14 w-14 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1">
        <GhostText size="micro" width="4.5rem" />
        <GhostText width={`${48 + ((seed * 17) % 36)}%`} />
        <GhostText size="footnote" width="5.5rem" />
      </span>
      <Ghost className="mr-3 h-1.5 w-5 rounded-full" />
    </div>
  )
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEK2 = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** The week band: real weekday letters, date and meal-mark placeholders. */
export function WeekStripGhost() {
  return (
    <div aria-hidden="true">
      <div className="mb-2 flex items-center gap-1">
        <span className="min-w-0 flex-1">
          <GhostText size="headline" width="11rem" />
          <GhostText size="micro" width="4.5rem" />
        </span>
        <Ghost className="h-10 w-10 rounded-full" />
        <Ghost className="h-10 w-10 rounded-full" />
      </div>
      <div className="grid grid-cols-7 gap-1 rounded-[22px] bg-elevated p-1.5 ring-1 ring-inset ring-line">
        {WEEK.map((w, i) => (
          <div key={i} className="flex flex-col items-center gap-1 py-2">
            <span className="text-micro font-semibold text-muted">{w}</span>
            <GhostText size="callout" width="1.4rem" className="leading-none" />
            <span className="flex h-1.5 items-center gap-0.5">{times(3).map((k) => <Ghost key={k} className="h-1 w-1.5 rounded-full" />)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The month grid: real weekday headings, date cells in their places. */
export function MonthGhost({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={className}>
      <div className="mb-3 flex items-center gap-1">
        <GhostText size="title3" width="9rem" className="flex-1" />
        <Ghost className="h-9 w-16 rounded-full" />
        <Ghost className="h-10 w-10 rounded-full" />
        <Ghost className="h-10 w-10 rounded-full" />
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEK2.map((w) => <span key={w} className="py-1 text-center text-caption font-semibold text-muted">{w}</span>)}
        {times(35).map((i) => <Ghost key={i} className="h-11 rounded-[14px] opacity-70 sm:h-10" />)}
      </div>
    </div>
  )
}

/** A plan workspace before it loads: header with actions, dates line, section tabs, the week and its days. */
export function PlanWorkspaceGhost() {
  return (
    <GhostRegion label="Loading plan">
      <HeaderGhost actions={3} />
      <GhostText size="footnote" width="62%" />
      <div className="mt-5 flex gap-1.5">{[74, 82, 88, 92].map((w) => <Ghost key={w} className="h-9 rounded-full" style={{ width: w }} />)}</div>
      <Ghost className="mt-4 h-11 rounded-full" />
      <div className="mt-4"><WeekStripGhost /></div>
      <div className="mt-4"><DayBlocksGhost days={2} rows={3} label="Loading meals" /></div>
    </GhostRegion>
  )
}

// ── Lists ──────────────────────────────────────────────────────────────────
/** A shopping list: progress, the actions, category headings and rows with their checkboxes. */
export function ShoppingListGhost({ withHeader, rowsOnly }: { withHeader?: boolean; rowsOnly?: boolean }) {
  return (
    <GhostRegion label="Loading shopping list">
      {withHeader && <HeaderGhost actions={1} />}
      {!rowsOnly && (
        <>
          <GhostText size="sm" width="9rem" />
          <Ghost className="mt-2 h-1.5 rounded-full" />
          <div className="mt-4 flex gap-2"><Ghost className="h-9 w-40 rounded-full" /><Ghost className="h-9 w-24 rounded-full" /></div>
        </>
      )}
      {[4, 3].map((n, s) => (
        <div key={s} className="mt-8">
          <GhostText size="title3" width={s ? '6rem' : '7.5rem'} className="mb-3" />
          <div className="divide-y divide-line rounded-lg bg-elevated px-3">
            {times(n).map((i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <Ghost className="h-8 w-8 shrink-0 rounded-full" />
                <span className="min-w-0 flex-1">
                  <GhostText width={`${36 + ((i * 23 + s * 11) % 40)}%`} />
                  <GhostText size="caption" width="42%" />
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </GhostRegion>
  )
}

/** My Kitchen's ingredient list: rows with a name, a note and the two small actions. */
export function KitchenGhost() {
  return (
    <GhostRegion label="Loading your kitchen" className="mt-8">
      <GhostText size="title3" width="8.5rem" className="mb-3" />
      <div className="divide-y divide-line rounded-lg bg-elevated px-3">
        {times(4).map((i) => (
          <div key={i} className="flex items-center gap-2 py-2.5">
            <span className="min-w-0 flex-1">
              <GhostText width={`${34 + ((i * 19) % 36)}%`} />
              <GhostText size="caption" width="38%" />
            </span>
            <Ghost className="h-9 w-14 rounded-full" />
            <Ghost className="h-10 w-10 rounded-full" />
          </div>
        ))}
      </div>
    </GhostRegion>
  )
}

/** The profile card: avatar, place and goal lines. */
export function ProfileCardGhost() {
  return (
    <div aria-hidden="true" className="flex items-center gap-4 rounded-[28px] bg-[var(--c-nav)] p-5">
      <Ghost tone="glass" className="h-14 w-14 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1">
        <GhostText tone="glass" size="sm" width="52%" />
        <GhostText tone="glass" width="38%" />
      </span>
    </div>
  )
}

/** People with access, or activity lines: a round avatar and two lines. */
export function PeopleGhost({ rows = 3, label = 'Loading people' }: { rows?: number; label?: string }) {
  return (
    <GhostRegion label={label} className="mt-4">
      <ListRowsGhost rows={rows} />
    </GhostRegion>
  )
}

/** Picker and suggestion rows: a round photo and two lines (optionally on a card). */
export function CircleRowsGhost({ rows = 4, size = 48, card, label = 'Loading' }: { rows?: number; size?: number; card?: boolean; label?: string }) {
  return (
    <GhostRegion as="ul" label={label} className={cn('flex flex-col', card && 'gap-2')}>
      {times(rows).map((i) => (
        <li key={i} aria-hidden="true" className={cn('flex items-center gap-3', card ? 'rounded-lg bg-elevated p-3 ring-1 ring-inset ring-line' : 'px-1 py-2')}>
          <Ghost className="shrink-0 rounded-full" style={{ width: size, height: size }} />
          <span className="min-w-0 flex-1">
            <GhostText width={`${44 + ((i * 19) % 38)}%`} />
            <GhostText size="footnote" width="36%" />
          </span>
        </li>
      ))}
    </GhostRegion>
  )
}

/** The diary: the nutrition card, then a meal group with its entries. */
export function DiaryGhost() {
  return (
    <GhostRegion label="Loading your diary" className="mt-6">
      <div className="rounded-xl bg-elevated p-5" aria-hidden="true">
        <div className="flex items-center gap-5">
          <Ghost className="h-24 w-24 shrink-0 rounded-full" />
          <span className="flex-1">
            <GhostText size="title2" width="50%" />
            <GhostText size="footnote" width="70%" />
            <Ghost className="mt-3 h-2 rounded-full" />
          </span>
        </div>
      </div>
      {[0, 1].map((g) => (
        <div key={g} className="mt-8" aria-hidden="true">
          <GhostText size="title3" width="6rem" className="mb-3" />
          <ListRowsGhost rows={2} />
        </div>
      ))}
    </GhostRegion>
  )
}

/** The budget: the dark summary card, then recent spending rows. */
export function BudgetGhost() {
  return (
    <GhostRegion label="Loading your budget" className="mt-4">
      <div className="rounded-[28px] bg-ink p-6" aria-hidden="true">
        <GhostText tone="glass" size="micro" width="30%" />
        <GhostText tone="glass" size="display" width="55%" className="mt-2" />
        <Ghost tone="glass" className="mt-4 h-2 rounded-full" />
        <GhostText tone="glass" size="footnote" width="48%" className="mt-3" />
      </div>
      <div className="mt-8" aria-hidden="true">
        <GhostText size="title3" width="8rem" className="mb-3" />
        <ListRowsGhost rows={3} />
      </div>
    </GhostRegion>
  )
}
