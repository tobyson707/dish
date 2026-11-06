import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LEVELS, levelFor } from '@domain/gamification.ts'
import { addDays } from '@domain/dates.ts'
import { supabase } from '@/lib/supabase'
import { invokeFn } from '@/data/ai'
import { useAchievementDefinitions, useGamification } from '@/data/gamification'
import { useProfile } from '@/data/profile'
import { useUserId } from '@/features/auth/AuthProvider'
import { useToday } from '@/hooks/useToday'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/ui/Icon'
import { IconButton } from '@/components/ui/Button'
import { DateField } from '@/components/ui/DateField'
import { Sheet } from '@/components/ui/Sheet'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState, LoadingBlock } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { previewCelebration } from '@/gamification/Celebrations'
import { PlanProgress } from '@/features/plan/NewPlan'
import { useDev, setDev, simulateDate, clockSimulated } from './devStore'
import { useDevStatus, type DevAccess } from './access'
import { SCREENS, SCREEN_CATEGORIES, type RecordKind, type ScreenEntry } from './screens'

const SCENARIOS: { id: string; name: string; detail: string }[] = [
  { id: 'new_incomplete', name: 'New user, onboarding not finished', detail: 'Profile reset; the app sends you to onboarding.' },
  { id: 'onboarded', name: 'Onboarding complete, nothing else', detail: 'A clean slate: no plan, no diary, no progress.' },
  { id: 'no_plan', name: 'No meal plan', detail: 'Home shows the first-plan invitation.' },
  { id: 'weekly_plan', name: 'An existing weekly plan', detail: 'Built by the real planner from your saved preferences.' },
  { id: 'empty_diary', name: 'Empty diary', detail: 'Nothing logged.' },
  { id: 'logged_meals', name: 'Several logged meals', detail: 'Real diary entries over three days; XP and streak follow.' },
  { id: 'streak_7', name: 'Active seven-day streak', detail: 'Seven days replayed through the real streak logic.' },
  { id: 'achievement', name: 'An unlocked achievement', detail: 'One logged meal unlocks First Serving.' },
  { id: 'level_2', name: 'Level 2', detail: 'XP set to the Level 2 threshold.' },
  { id: 'grocery_incomplete', name: 'Incomplete shopping list', detail: 'Five items, two ticked off.' },
]
const STREAKS = [0, 3, 7, 14, 30]
const ADVANCE: [string, number][] = [
  ['+1 day', 1],
  ['+3 days', 3],
  ['+7 days', 7],
  ['+14 days', 14],
  ['+30 days', 30],
  ['+90 days', 90],
  ['+1 year', 365],
]
const ZONES = ['Africa/Lagos', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']

const match = (q: string, ...text: (string | undefined)[]) => !q || text.some((t) => t?.toLowerCase().includes(q))

/** The Developer Console: one implementation for desktop (right panel) and mobile (full screen). */
export function DevConsole({ closing, env, access }: { closing: boolean; env: string; access: DevAccess }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const status = useDevStatus(true)
  const canSimulate = !!status.data?.enabled && access.testAccount
  const close = () => setDev({ open: false })

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label="Developer Mode"
      data-closing={closing || undefined}
      className="dev-console fixed inset-0 z-[80] flex flex-col bg-bg text-ink shadow-[-24px_0_70px_-20px_var(--c-shadow)] sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(460px,100vw)] sm:border-l sm:border-line"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
    >
      <header className="shrink-0 border-b border-line px-5 pb-4 pt-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-on-ink" aria-hidden="true">
            <Icon name="wand" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-title-3">Developer Mode</h2>
            <p className="text-caption text-muted">Internal QA console. Not part of the app.</p>
          </div>
          <IconButton icon="x" label="Close Developer Mode" onClick={close} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone={env === 'Production' ? 'warn' : 'ok'}>{env}</Badge>
          <Badge tone={canSimulate ? 'accent' : 'plain'}>{canSimulate ? 'Simulation: test account' : 'Preview only'}</Badge>
        </div>
        <label className="relative mt-3 flex items-center">
          <span className="sr-only">Search tools and screens</span>
          <Icon name="search" size={17} className="pointer-events-none absolute left-3.5 text-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools and screens" className="h-11 w-full rounded-full bg-elevated pl-10 pr-4 text-[16px] outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-focus" />
        </label>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10">
        {!query && <QuickActions />}
        <Screens query={query} />
        {match(query, 'time date clock simulate advance timezone leap') && <TimeTools env={env} />}
        {match(query, 'streak level xp achievement badge progress celebration unlock') && <ProgressTools canSimulate={canSimulate} status={status.data} access={access} />}
        {match(query, 'overlay toast notification dialog empty loading confirmation error success meal added plan progress') && <OverlayTools />}
        {match(query, 'scenario test data sample reset') && <ScenarioTools canSimulate={canSimulate} status={status.data} access={access} />}
        {match(query, 'environment safety production preview isolation') && <Safety env={env} access={access} enabled={!!status.data?.enabled} />}
      </div>
    </section>
  )
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'accent' | 'plain'; children: ReactNode }) {
  return <span className={cn('rounded-full px-2.5 py-1 text-caption font-semibold ring-1 ring-inset', tone === 'accent' ? 'bg-accent-soft text-accent-strong ring-accent-border' : tone === 'warn' ? 'bg-error-soft text-error ring-error/30' : tone === 'ok' ? 'bg-elevated text-ink ring-line' : 'bg-elevated text-muted ring-line')}>{children}</span>
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section aria-label={title} className="mt-7">
      <h3 className="text-headline">{title}</h3>
      {hint && <p className="mt-1 text-footnote text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Tool({ children, onClick, disabled, tone = 'plain', label }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'plain' | 'accent'; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className={cn('press min-h-11 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-40', tone === 'accent' ? 'bg-ink text-on-ink' : 'bg-elevated text-ink ring-1 ring-inset ring-line hover:bg-surface')}>
      {children}
    </button>
  )
}

function QuickActions() {
  const nav = useNavigate()
  const profile = useProfile()
  const today = useToday()
  return (
    <Section title="Quick actions">
      <div className="flex flex-wrap gap-2">
        <Tool onClick={() => simulateDate(addDays(today, 1), profile.data?.timezone)}>Advance one day</Tool>
        <Tool onClick={() => { setDev({ open: false }); previewCelebration('level', LEVELS[1]!.title) }}>Preview Level 2</Tool>
        <Tool onClick={() => { setDev({ open: false }); previewCelebration('achievement', 'one_week_strong') }}>Preview 7-day streak</Tool>
        <Tool onClick={() => { setDev({ open: false }); nav('/') }}>Go to Home</Tool>
      </div>
    </Section>
  )
}

// ── Screen navigator ────────────────────────────────────────────────────────
function Screens({ query }: { query: string }) {
  const list = SCREENS.filter((s) => match(query, s.name, s.category, s.keywords, s.path))
  if (!list.length) return query && !match(query, 'time streak level xp achievement overlay scenario environment') ? <p className="mt-7 text-sm text-muted">Nothing matches “{query}”.</p> : null
  return (
    <Section title="Screens" hint="Real app screens. Jumping never repeats onboarding.">
      <div className="flex flex-col gap-5">
        {SCREEN_CATEGORIES.map((cat) => {
          const items = list.filter((s) => s.category === cat)
          if (!items.length) return null
          return (
            <div key={cat}>
              <p className="label-caps">{cat}</p>
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[18px] bg-elevated ring-1 ring-inset ring-line">
                {items.map((s) => (
                  <ScreenRow key={s.id} s={s} />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function ScreenRow({ s }: { s: ScreenEntry }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const go = (path: string) => {
    setDev({ open: false })
    nav(path)
  }
  return (
    <li>
      <button type="button" onClick={() => (s.needs ? setOpen(!open) : go(s.path))} aria-expanded={s.needs ? open : undefined} className="press flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{s.name}</span>
          {s.note && <span className="mt-0.5 block text-caption text-warning">{s.note}</span>}
        </span>
        <Icon name={s.needs ? 'down' : 'right'} size={16} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && s.needs && <RecordPicker kind={s.needs} onPick={(v) => go(s.path.replace(/:[a-zA-Z]+/, encodeURIComponent(v)))} />}
    </li>
  )
}

const RECORD_LABEL: Record<RecordKind, string> = { planned_meal: 'planned meals', diary_entry: 'diary entries', grocery_list: 'shopping lists', recipe: 'catalogue meals', meal_plan: 'plans', published_plan: 'community plans' }

/** Pick an existing record of yours for a detail screen (read-only). */
function RecordPicker({ kind, onPick }: { kind: RecordKind; onPick: (value: string) => void }) {
  const uid = useUserId()
  const rows = useQuery({
    queryKey: ['dev-records', kind, uid],
    queryFn: async (): Promise<{ value: string; label: string }[]> => {
      if (kind === 'recipe') {
        const { data } = await supabase.from('food_items').select('slug, name').order('name').limit(200)
        return (data ?? []).map((r) => ({ value: r.slug as string, label: r.name as string }))
      }
      if (kind === 'planned_meal') {
        const { data } = await supabase.from('planned_meals').select('id, name, date, slot').eq('user_id', uid).eq('on_calendar', true).order('date', { ascending: false }).limit(30)
        return (data ?? []).map((r) => ({ value: r.id as string, label: `${r.date} · ${r.slot} · ${r.name}` }))
      }
      if (kind === 'meal_plan') {
        const { data } = await supabase.from('meal_plans').select('id, title, status').eq('user_id', uid).order('updated_at', { ascending: false }).limit(30)
        return (data ?? []).map((r) => ({ value: r.id as string, label: `${r.title} · ${r.status}` }))
      }
      if (kind === 'published_plan') {
        const { data } = await supabase.from('meal_plans').select('id, title').eq('visibility', 'published').order('published_at', { ascending: false }).limit(30)
        return (data ?? []).map((r) => ({ value: r.id as string, label: r.title as string }))
      }
      if (kind === 'diary_entry') {
        const { data } = await supabase.from('food_diary_entries').select('id, name, local_date').eq('user_id', uid).order('local_date', { ascending: false }).limit(30)
        return (data ?? []).map((r) => ({ value: r.id as string, label: `${r.local_date} · ${r.name}` }))
      }
      const { data } = await supabase.from('grocery_lists').select('id, name, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(20)
      return (data ?? []).map((r) => ({ value: r.id as string, label: r.name as string }))
    },
  })
  if (rows.isPending) return <div className="px-4 pb-3"><LoadingBlock /></div>
  if (!rows.data?.length)
    return <p className="px-4 pb-3 text-footnote text-warning">You have no {RECORD_LABEL[kind]} yet. Create one in the app, or load a test scenario below on a test account.</p>
  return (
    <div className="px-4 pb-3">
      <label className="text-caption font-semibold text-muted" htmlFor={`pick-${kind}`}>Choose one of your {RECORD_LABEL[kind]}</label>
      <select id={`pick-${kind}`} className="mt-1 h-11 w-full rounded-md bg-input px-3 ring-1 ring-inset ring-input-border" defaultValue="" onChange={(e) => e.target.value && onPick(e.target.value)}>
        <option value="" disabled>Select…</option>
        {rows.data.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── Time ────────────────────────────────────────────────────────────────────
function TimeTools({ env }: { env: string }) {
  const dev = useDev()
  const profile = useProfile()
  const today = useToday()
  const tz = profile.data?.timezone
  if (env === 'Production')
    return (
      <Section title="Simulated time">
        <p className="text-sm text-muted">Not available in production: the app always uses the real date here, so nothing is ever saved against a simulated day.</p>
      </Section>
    )
  return (
    <Section title="Simulated time" hint="An app-level clock. The device clock is never touched; reload keeps it for this tab only.">
      <p className="text-sm">
        App date: <strong className="num">{today}</strong> {clockSimulated(dev) ? <span className="text-accent-strong">(simulated, {dev.dayOffset >= 0 ? '+' : ''}{dev.dayOffset} days{dev.tz ? `, ${dev.tz}` : ''})</span> : <span className="text-muted">(real time)</span>}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ADVANCE.map(([label, n]) => (
          <Tool key={label} onClick={() => simulateDate(addDays(today, n), tz)} label={`Advance ${label.replace('+', '')}`}>{label}</Tool>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <DateField label="Set simulated date" value={today} onChange={(d) => d && simulateDate(d, tz)} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Simulated time zone</span>
          <select className="h-12 rounded-md bg-input px-3 ring-1 ring-inset ring-input-border" value={dev.tz ?? ''} onChange={(e) => setDev({ tz: e.target.value || null })}>
            <option value="">Profile ({tz ?? 'device'})</option>
            {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Tool onClick={() => simulateDate('2028-02-28', tz)}>Leap-year test (28 Feb 2028)</Tool>
        <Tool onClick={() => simulateDate(`${today.slice(0, 4)}-12-31`, tz)}>Year end</Tool>
        <Tool tone="accent" onClick={() => setDev({ dayOffset: 0, tz: null })} disabled={!clockSimulated(dev)}>Back to real time</Tool>
      </div>
    </Section>
  )
}

// ── Streak, XP, levels, achievements ────────────────────────────────────────
function useSimulate() {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true)
    try {
      const r = await invokeFn<{ already?: boolean }>('dev-tools', body)
      await qc.invalidateQueries()
      toast.show(r.already ? 'Already unlocked: duplicate prevented.' : done, { tone: 'success' })
      return true
    } catch (e) {
      toast.error(friendlyError(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { run, busy }
}

function NeedsTestAccount({ enabled, access }: { enabled: boolean; access: DevAccess }) {
  const toast = useToast()
  const [making, setMaking] = useState(false)
  if (!enabled) return <p className="rounded-[14px] bg-elevated p-3 text-footnote text-muted">Simulation is switched off for this environment, so only previews are available. Nothing here can change saved progress.</p>
  if (access.testAccount) return null
  return (
    <div className="rounded-[14px] bg-accent-soft p-3 ring-1 ring-inset ring-accent-border">
      <p className="text-footnote">Simulation only runs on a test account, so your own account is never changed. Create one and switch to it (you'll be signed out of this account).</p>
      <button
        type="button"
        disabled={making}
        className="press mt-2 h-10 rounded-full bg-ink px-4 text-sm font-semibold text-on-ink disabled:opacity-50"
        onClick={async () => {
          setMaking(true)
          try {
            const r = await invokeFn<{ email: string; password: string }>('dev-tools', { action: 'create_test_account' })
            await supabase.auth.signOut()
            const { error } = await supabase.auth.signInWithPassword({ email: r.email, password: r.password })
            if (error) throw error
            toast.show(`Signed in as test account ${r.email}`, { tone: 'success' })
            setDev({ revealed: true, open: false })
            location.assign('/')
          } catch (e) {
            toast.error(friendlyError(e))
            setMaking(false)
          }
        }}
      >
        Create a test account and switch
      </button>
    </div>
  )
}

function ProgressTools({ canSimulate, status, access }: { canSimulate: boolean; status?: { enabled: boolean }; access: DevAccess }) {
  const g = useGamification()
  const defs = useAchievementDefinitions()
  const today = useToday()
  const { run, busy } = useSimulate()
  const [custom, setCustom] = useState('10')
  const [xp, setXp] = useState('50')
  const lvl = levelFor(g.data?.total_xp ?? 0)
  const unlocked = new Set((g.data?.achievements ?? []).map((a) => a.id))
  const close = () => setDev({ open: false })
  return (
    <>
      <Section title="Streak, level and XP" hint="Current values come from the server, exactly as the app shows them.">
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            ['Level', `${lvl.current.level} · ${lvl.current.title}`],
            ['XP', String(g.data?.total_xp ?? 0)],
            ['Streak', `${g.data?.current_streak ?? 0} days`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[14px] bg-elevated p-2.5">
              <dt className="text-caption text-muted">{k}</dt>
              <dd className="num mt-0.5 text-sm font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-footnote font-semibold">Preview (nothing is saved)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {LEVELS.slice(1).map((l) => (
            <Tool key={l.level} onClick={() => { close(); previewCelebration('level', l.title) }}>Level {l.level} celebration</Tool>
          ))}
        </div>
        <p className="mt-5 text-footnote font-semibold">Simulate (test account)</p>
        <div className="mt-2"><NeedsTestAccount enabled={!!status?.enabled} access={access} /></div>
        {canSimulate && (
          <div className="mt-2 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {STREAKS.map((n) => (
                <Tool key={n} disabled={busy} onClick={() => run({ action: 'set_streak', days: n, today }, `Streak set to ${n}.`)}>Streak {n}</Tool>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="Custom streak length" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} className="h-11 w-20 rounded-full bg-input px-4 text-center ring-1 ring-inset ring-input-border" />
              <Tool disabled={busy || !custom} onClick={() => run({ action: 'set_streak', days: Number(custom), today }, `Streak set to ${custom}.`)}>Set streak</Tool>
              <Tool disabled={busy} onClick={() => run({ action: 'set_streak', days: Number(custom) || 5, today, mode: 'broken' }, 'Streak broken (yesterday missed).')}>Break it</Tool>
              <Tool disabled={busy} onClick={() => run({ action: 'set_streak', days: Number(custom) || 5, today, mode: 'resume' }, 'Resumed after a break.')}>Resume after break</Tool>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="XP amount" inputMode="numeric" value={xp} onChange={(e) => setXp(e.target.value.replace(/\D/g, ''))} className="h-11 w-24 rounded-full bg-input px-4 text-center ring-1 ring-inset ring-input-border" />
              <Tool disabled={busy || !xp} onClick={() => run({ action: 'add_xp', amount: Number(xp) }, `Added ${xp} XP.`)}>Add XP</Tool>
              <Tool disabled={busy || !xp} onClick={() => run({ action: 'add_xp', amount: -Number(xp) }, `Removed ${xp} XP.`)}>Remove XP</Tool>
              <Tool disabled={busy || !xp} onClick={() => run({ action: 'set_xp', total: Number(xp) }, `XP set to ${xp}.`)}>Set exactly</Tool>
            </div>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((l) => (
                <Tool key={l.level} disabled={busy} onClick={() => run({ action: 'set_xp', total: l.min }, `Jumped to Level ${l.level}.`)}>Jump to Level {l.level}</Tool>
              ))}
              <Tool disabled={busy} onClick={() => run({ action: 'reset_progress' }, 'Progress reset.')}>Reset progress</Tool>
            </div>
          </div>
        )}
      </Section>
      <Section title="Achievements" hint="Every achievement defined in the app. Preview shows the real overlay without saving; Simulate runs the real unlock.">
        <ul className="flex flex-col gap-2">
          {(defs.data ?? []).map((d) => (
            <li key={d.id} className="rounded-[16px] bg-elevated p-3 ring-1 ring-inset ring-line">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{d.name}</p>
                  <p className="text-caption text-muted">{d.description}</p>
                </div>
                {unlocked.has(d.id) && <Badge tone="accent">Unlocked</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Tool onClick={() => { close(); previewCelebration('achievement', d.id) }} label={`Preview ${d.name}`}>Preview</Tool>
                {canSimulate && <Tool disabled={busy} onClick={() => void run({ action: 'unlock', achievement_id: d.id }, `${d.name} unlocked.`).then((ok) => ok && close())} label={`Simulate unlock ${d.name}`}>Simulate unlock</Tool>}
                {canSimulate && unlocked.has(d.id) && <Tool disabled={busy} onClick={() => run({ action: 'reset_achievement', achievement_id: d.id }, `${d.name} reset.`)} label={`Reset ${d.name}`}>Reset</Tool>}
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

// ── Overlays ────────────────────────────────────────────────────────────────
function OverlayTools() {
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [sheet, setSheet] = useState<null | 'empty' | 'loading' | 'progress'>(null)
  const close = () => setDev({ open: false })
  return (
    <Section title="Notifications and overlays" hint="The app's own components with sample text. Nothing is saved.">
      <div className="flex flex-wrap gap-2">
        <Tool onClick={() => toast.show('Saved.', { tone: 'success' })}>Success message</Tool>
        <Tool onClick={() => toast.error("We couldn't save that. Check your connection and try again.")}>Error message</Tool>
        <Tool onClick={() => toast.show("Added Jollof rice with chicken to today's lunch.", { tone: 'success' })}>Meal added</Tool>
        <Tool onClick={() => toast.show('Your one week plan is ready.', { tone: 'success' })}>Plan saved</Tool>
        <Tool onClick={() => setConfirm(true)}>Confirmation dialog</Tool>
        <Tool onClick={() => setSheet('empty')}>Empty state</Tool>
        <Tool onClick={() => setSheet('loading')}>Loading</Tool>
        <Tool onClick={() => setSheet('progress')}>Plan generation progress</Tool>
        <Tool onClick={() => { close(); previewCelebration('achievement', 'first_serving') }}>Achievement celebration</Tool>
        <Tool onClick={() => { close(); previewCelebration('achievement', 'one_week_strong') }}>Streak celebration</Tool>
        <Tool onClick={() => { close(); previewCelebration('level', LEVELS[2]!.title) }}>Level-up</Tool>
      </div>
      <ConfirmDialog open={confirm} title="Regenerate this week?" message="Planned meals will be swapped for fresh picks. Locked meals stay. (Preview: nothing happens.)" confirmLabel="Regenerate" onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} />
      <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet === 'empty' ? 'Empty state' : sheet === 'loading' ? 'Loading' : 'Plan generation'}>
        {sheet === 'empty' && <EmptyState title="Nothing logged yet" message="Let's see what's on your plate. Add what you ate, or snap a photo." />}
        {sheet === 'loading' && <LoadingBlock />}
        {sheet === 'progress' && <PlanProgress phase="fill" done={84} total={365} />}
      </Sheet>
    </Section>
  )
}

// ── Scenarios ───────────────────────────────────────────────────────────────
function ScenarioTools({ canSimulate, status, access }: { canSimulate: boolean; status?: { enabled: boolean }; access: DevAccess }) {
  const { run, busy } = useSimulate()
  const today = useToday()
  const toast = useToast()
  const nav = useNavigate()
  const [ran, setRan] = useState<string | null>(null)
  const list = useMemo(() => SCENARIOS, [])
  async function apply(id: string) {
    const ok = await run({ action: 'scenario', name: id, today }, 'Scenario loaded.')
    if (!ok) return
    if (id === 'weekly_plan') {
      try {
        await invokeFn('plan-generate', { create: { duration: 'week', start_date: today, replace_active: true }, today })
        toast.show('Weekly plan created by the real planner.', { tone: 'success' })
      } catch (e) {
        toast.error(friendlyError(e))
      }
    }
    setRan(id)
    setDev({ open: false })
    nav(id === 'new_incomplete' ? '/onboarding' : id === 'grocery_incomplete' ? '/grocery' : '/')
    location.reload() // start every screen from the scenario's data
  }
  return (
    <Section title="Test scenarios" hint="Each replaces the test account's data with a known starting point. Real accounts can't run these.">
      <NeedsTestAccount enabled={!!status?.enabled} access={access} />
      <ul className="mt-2 flex flex-col gap-2">
        {list.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-[16px] bg-elevated p-3 ring-1 ring-inset ring-line">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{s.name}</p>
              <p className="text-caption text-muted">{s.detail}</p>
            </div>
            <Tool disabled={!canSimulate || busy} onClick={() => void apply(s.id)} label={`Load scenario ${s.name}`}>{ran === s.id ? 'Loaded' : 'Load'}</Tool>
          </li>
        ))}
      </ul>
      {canSimulate && (
        <div className="mt-3">
          <Tool tone="accent" disabled={busy} onClick={() => void apply('onboarded')}>Reset test scenario</Tool>
        </div>
      )}
    </Section>
  )
}

function Safety({ env, access, enabled }: { env: string; access: DevAccess; enabled: boolean }) {
  return (
    <Section title="Environment and safety">
      <ul className="flex flex-col gap-1.5 text-footnote text-ink-2">
        <li>Environment: <strong>{env}</strong>. Simulation on the server: <strong>{enabled ? 'on' : 'off'}</strong>.</li>
        <li>Account: <strong>{access.testAccount ? 'test account (simulation allowed)' : 'regular account (previews only)'}</strong>.</li>
        <li>Preview tools show real components with temporary data and never save anything.</li>
        <li>Simulation runs the app's real logic, only on test accounts created here, and only where the server allows it. It is never available against real accounts.</li>
        <li>In production the simulated clock is off and destructive tools are hidden.</li>
      </ul>
    </Section>
  )
}
