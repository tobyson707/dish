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
      <nav aria-label="Profile" className="mt-8 flex flex-col gap-6">
        <Group title="Your food">
          <Item to="/profile/preferences" icon="leaf" title="Food preferences" sub="Diet, allergies, cuisines, dislikes, spice, meal times" />
          <Item to="/profile/goals" icon="flame" title="Goals & targets" sub="Meal-planning goals, optional calorie target" />
          <Item to="/saved" icon="heart" title="Saved" sub="Meals and meal plans you saved" />
          <Item to="/history" icon="history" title="History" sub="Eaten meals and leftovers" />
          <Item to="/budget" icon="wallet" title="Food budget" sub="Estimated vs actual spending" />
        </Group>
        <Group title="Settings">
          <Item to="/profile/account" icon="user" title="Account" sub="Email, password, sign out" />
          <Item to="/profile/settings" icon="settings" title="App preferences" sub={`${preference === 'dark' ? 'Dark' : preference === 'light' ? 'Light' : 'System'} appearance, sounds, reminders, about DISH`} />
          <Item to="/profile/privacy" icon="shield" title="Privacy & security" sub="Your data, export, delete account" />
          {sync.pending + sync.failed + sync.conflicts > 0 && <Item to="/profile/sync" icon="cloud" title="Offline & sync" sub={`${sync.pending + sync.failed + sync.conflicts} change(s) need attention`} />}
          {isAdmin.data && <Item to="/admin/images" icon="image" title="Image studio" sub="DISH team · generate and review catalogue photos" />}
        </Group>
      </nav>
      <div className="mt-4"><InstallCard /></div>
      <Button variant="secondary" icon="logout" block className="mt-6" onClick={() => void signOut()}>Sign out</Button>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="label-caps mb-2 px-1">{title}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-lg bg-elevated">{children}</ul>
    </section>
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
