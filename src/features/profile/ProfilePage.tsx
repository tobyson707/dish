import { useState } from 'react'
import { Link } from 'react-router'
import { usePreferences, useProfile } from '@/data/profile'
import { countryByCode } from '@/lib/geo'
import { DevTapTarget } from '@/dev/DevTapTarget'
import { PLANNING_GOAL_LABEL } from '@/types/db'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSyncState } from '@/offline/useSync'
import { PageHeader } from '@/components/ui/Layout'
import { GhostRegion, HeaderGhost, ProfileCardGhost } from '@/components/ui/Ghost'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { InstallCard } from './InstallCard'
import { MyProgress } from '@/components/gamification/MyProgress'
import { AppearanceSheet } from '@/components/canvas/AppearanceSheet'
import { useTheme } from '@/theme/ThemeProvider'
import { useIsAdmin } from '@/data/foodImages'

export function ProfilePage() {
  const profile = useProfile()
  const p = profile.data
  const prefs = usePreferences()
  const goals = prefs.data?.planning_goals ?? []
  const country = countryByCode(p?.country_code ?? null)
  const { user, signOut } = useAuth()
  const sync = useSyncState()
  const { preference } = useTheme()
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const isAdmin = useIsAdmin()
  return (
    <div>
      {profile.isPending ? (
        <GhostRegion label="Loading your profile">
          <HeaderGhost large />
          <ProfileCardGhost />
        </GhostRegion>
      ) : (
        <>
      <PageHeader eyebrow={user?.email ?? ''} title={p?.display_name || 'Profile'} large />
      <div className="ghost-reveal flex items-center gap-4 rounded-[28px] bg-[var(--c-nav)] p-5 text-on-glass-dark">
        {/* the avatar has no other job, so it hosts the hidden five-tap Developer Mode gesture */}
        <DevTapTarget className="shrink-0">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-on-glass-dark text-title-2 font-extrabold text-on-glass-dark-ink">{(p?.display_name?.[0] ?? '•').toUpperCase()}</span>
        </DevTapTarget>
        <div className="min-w-0">
          <p className="truncate text-sm opacity-70">{country ? `${country.flag} ${country.name}` : 'Country not set'} · {p?.currency}</p>
          <p className="truncate font-bold">{goals.length ? PLANNING_GOAL_LABEL[goals[0]!] + (goals.length > 1 ? ` +${goals.length - 1}` : '') : 'No goals chosen yet'}</p>
        </div>
      </div>
        </>
      )}
      <MyProgress />
      <nav aria-label="Profile settings" className="mt-8">
        <ul className="divide-y divide-line overflow-hidden rounded-lg bg-elevated">
          <Item to="/profile/settings" icon="settings" title="Settings" sub="Appearance, sounds and progress feedback" />
          <Item to="/profile/preferences" icon="leaf" title="Food preferences" sub="Cuisines, allergies, dislikes, budget, planning" />
          <Item to="/profile/goals" icon="flame" title="Goals & targets" sub="Meal-planning goals, optional calorie target" />
          <Item to="/budget" icon="wallet" title="Food budget" sub="Estimated vs actual spending" />
          <Item to="/history" icon="history" title="History & favourites" sub="Eaten meals, favourites, leftovers" />
          <Item to="/profile/notifications" icon="bell" title="Reminders" sub="Meal, prep and shopping reminders" />
          <Item to="/profile/sync" icon="cloud" title="Offline & sync" sub={sync.pending + sync.failed + sync.conflicts ? `${sync.pending + sync.failed + sync.conflicts} change(s) need attention` : 'Everything is synced'} />
          <li>
            <button type="button" onClick={() => setAppearanceOpen(true)} className="press flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-ink/5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface"><Icon name={preference === 'dark' ? 'moon' : preference === 'light' ? 'sun' : 'monitor'} size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Appearance</span>
                <span className="block truncate text-footnote text-muted">{preference === 'dark' ? 'Dark' : preference === 'light' ? 'Light' : 'System default'}</span>
              </span>
              <Icon name="right" size={18} className="text-muted" />
            </button>
          </li>
          <Item to="/profile/account" icon="shield" title="Account & privacy" sub="Password, export, delete account" />
          {isAdmin.data && <Item to="/admin/images" icon="image" title="Image studio" sub="DISH team · generate and review catalogue photos" />}
        </ul>
      </nav>
      <div className="mt-4"><InstallCard /></div>
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
        <Link to="/privacy" className="underline">Privacy</Link>
        <Link to="/terms" className="underline">Terms</Link>
        <span>DISH gives general food information, not medical advice.</span>
      </div>
      <Button variant="secondary" icon="logout" block className="mt-6" onClick={() => void signOut()}>Sign out</Button>
      <AppearanceSheet open={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </div>
  )
}

function Item({ to, icon, title, sub }: { to: string; icon: IconName; title: string; sub: string }) {
  return (
    <li>
      <Link to={to} className="press flex items-center gap-4 px-4 py-3.5 hover:bg-ink/5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface"><Icon name={icon} size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate text-footnote text-muted">{sub}</span>
        </span>
        <Icon name="right" size={18} className="text-muted" />
      </Link>
    </li>
  )
}
