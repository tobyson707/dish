import { useState } from 'react'
import { Link } from 'react-router'
import { GOAL_LABEL } from '@domain/types.ts'
import { useActiveGoal, useProfile } from '@/data/profile'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSyncState } from '@/offline/useSync'
import { PageHeader } from '@/components/ui/Layout'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { InstallCard } from './InstallCard'
import { MyProgress } from '@/components/gamification/MyProgress'
import { AppearanceSheet } from '@/components/canvas/AppearanceSheet'
import { useTheme } from '@/theme/ThemeProvider'
import { useIsAdmin } from '@/data/foodImages'

export function ProfilePage() {
  const profile = useProfile()
  const goal = useActiveGoal()
  const { user, signOut } = useAuth()
  const sync = useSyncState()
  const p = profile.data
  const { preference } = useTheme()
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const isAdmin = useIsAdmin()
  return (
    <div>
      <PageHeader eyebrow={user?.email ?? ''} title={p?.display_name || 'Profile'} large />
      <div className="flex items-center gap-4 rounded-[28px] bg-[var(--c-nav)] p-5 text-on-glass-dark">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-2xl font-extrabold text-accent-ink">{(p?.display_name?.[0] ?? '•').toUpperCase()}</span>
        <div>
          <p className="text-sm opacity-70">Goal</p>
          <p className="font-bold">{goal.data ? GOAL_LABEL[goal.data.goal] : 'Not set'}{goal.data?.calorie_target ? ` · ~${goal.data.calorie_target.toLocaleString()} kcal` : ''}</p>
        </div>
      </div>
      <MyProgress />
      <nav aria-label="Profile settings" className="mt-8">
        <ul className="divide-y divide-line overflow-hidden rounded-lg bg-elevated">
          <Item to="/profile/preferences" icon="leaf" title="Food preferences" sub="Cuisines, allergies, dislikes, budget, planning" />
          <Item to="/profile/goals" icon="flame" title="Goals & targets" sub="Goal, optional calorie estimate" />
          <Item to="/budget" icon="wallet" title="Food budget" sub="Estimated vs actual spending" />
          <Item to="/history" icon="history" title="History & favourites" sub="Eaten meals, favourites, leftovers" />
          <Item to="/profile/notifications" icon="bell" title="Reminders" sub="Meal, prep and shopping reminders" />
          <Item to="/profile/sync" icon="cloud" title="Offline & sync" sub={sync.pending + sync.failed + sync.conflicts ? `${sync.pending + sync.failed + sync.conflicts} change(s) need attention` : 'Everything is synced'} />
          <li>
            <button type="button" onClick={() => setAppearanceOpen(true)} className="press flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-ink/5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface"><Icon name={preference === 'dark' ? 'moon' : preference === 'light' ? 'sun' : 'monitor'} size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Appearance</span>
                <span className="block truncate text-[13px] text-muted">{preference === 'dark' ? 'Dark' : preference === 'light' ? 'Light' : 'System default'}</span>
              </span>
              <Icon name="right" size={18} className="text-muted" />
            </button>
          </li>
          <Item to="/profile/settings" icon="settings" title="Settings" sub="Appearance and progress feedback" />
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
          <span className="block truncate text-[13px] text-muted">{sub}</span>
        </span>
        <Icon name="right" size={18} className="text-muted" />
      </Link>
    </li>
  )
}
