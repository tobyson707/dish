import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { levelFor, XP_EVENT_LABEL } from '@domain/gamification.ts'
import { gamKeys, useAchievementDefinitions, useGamification, type GamificationSummary } from '@/data/gamification'
import { useUserId } from '@/features/auth/AuthProvider'
import { Icon } from '@/components/ui/Icon'
import { AchievementBadge } from '@/components/gamification/Achievements'
import { onGamificationCheck } from './bus'

type Notice =
  | { id: string; kind: 'xp'; amount: number; label: string }
  | { id: string; kind: 'achievement'; achievementId: string }
  | { id: string; kind: 'level'; title: string }
  | { id: string; kind: 'streak'; days: number }

const seenKey = (uid: string) => `dish-gam-seen:${uid}`
interface Seen {
  tx: string[]
  ach: string[]
}
function readSeen(uid: string): Seen | null {
  try {
    const raw = localStorage.getItem(seenKey(uid))
    return raw ? (JSON.parse(raw) as Seen) : null
  } catch {
    return null
  }
}
function writeSeen(uid: string, s: Seen) {
  try {
    localStorage.setItem(seenKey(uid), JSON.stringify({ tx: s.tx.slice(-80), ach: s.ach }))
  } catch {
    /* storage unavailable: feedback may repeat at most once */
  }
}

/** Pure diff used by the notifier (exported for tests). */
export function diffAwards(summary: GamificationSummary, seen: Seen): { notices: Notice[]; seen: Seen } {
  const newTx = summary.recent.filter((t) => !seen.tx.includes(t.id))
  const newAch = summary.achievements.filter((a) => !seen.ach.includes(a.id))
  const notices: Notice[] = []
  if (newTx.length) {
    const amount = newTx.reduce((s, t) => s + t.xp_amount, 0)
    const labels = [...new Set(newTx.map((t) => XP_EVENT_LABEL[t.event_type] ?? t.description))]
    notices.push({ id: `xp-${newTx[0]!.id}`, kind: 'xp', amount, label: labels.length > 1 ? `${labels[0]} & more` : labels[0]! })
    const before = levelFor(summary.total_xp - amount)
    const after = levelFor(summary.total_xp)
    if (after.current.level > before.current.level) notices.push({ id: `lvl-${after.current.level}`, kind: 'level', title: after.current.title })
    const milestone = newTx.find((t) => t.event_type === 'streak_milestone')
    if (milestone) notices.push({ id: `streak-${milestone.id}`, kind: 'streak', days: summary.current_streak })
  }
  for (const a of newAch) notices.push({ id: `ach-${a.id}`, kind: 'achievement', achievementId: a.id })
  return { notices, seen: { tx: [...seen.tx, ...newTx.map((t) => t.id)], ach: [...seen.ach, ...newAch.map((a) => a.id)] } }
}

/**
 * Listens for confirmed actions, fetches the server's progress and shows quiet
 * feedback for awards that are NEW since the last time this user saw them.
 */
export function GamificationNotifier() {
  const uid = useUserId()
  const qc = useQueryClient()
  useGamification() // keeps the summary query active so refetches happen
  const defs = useAchievementDefinitions()
  const [notices, setNotices] = useState<Notice[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Confirmed action → refetch server progress (debounced to coalesce bursts).
  useEffect(
    () =>
      onGamificationCheck(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: gamKeys.summary(uid) }), 350)
      }),
    [qc, uid],
  )

  // Diff each successful server response against what this user has already seen.
  useEffect(() => {
    const key = JSON.stringify(gamKeys.summary(uid))
    const handle = (s: GamificationSummary | undefined) => {
      if (!s) return
      const seen = readSeen(uid)
      if (!seen) {
        // first run on this device: remember history silently, never replay old awards
        writeSeen(uid, { tx: s.recent.map((t) => t.id), ach: s.achievements.map((a) => a.id) })
        return
      }
      const { notices: fresh, seen: next } = diffAwards(s, seen)
      writeSeen(uid, next)
      if (fresh.length && s.feedback_enabled) setNotices((n) => [...n, ...fresh].slice(-3))
    }
    return qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'success' && JSON.stringify(e.query.queryKey) === key) handle(e.query.state.data as GamificationSummary)
    })
  }, [qc, uid])

  useEffect(() => {
    if (!notices.length) return
    const t = setTimeout(() => setNotices((n) => n.slice(1)), 3600)
    return () => clearTimeout(t)
  }, [notices])

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[65] flex flex-col items-center gap-2 px-4" style={{ top: 'calc(var(--safe-top) + 12px)' }}>
      {notices.map((n) => {
        if (n.kind === 'xp')
          return (
            <div key={n.id} role="status" className="flex items-center gap-2 rounded-full bg-ink px-3.5 py-2 text-sm text-on-ink shadow-lg animate-[xp-rise_420ms_var(--ease-out)_both]">
              <span className="num font-extrabold text-accent">+{n.amount} XP</span>
              <span className="opacity-80">— {n.label}</span>
            </div>
          )
        if (n.kind === 'level')
          return (
            <div key={n.id} role="status" className="flex items-center gap-3 rounded-lg bg-elevated px-4 py-3 text-sm shadow-lg ring-1 ring-line animate-[badge-in_380ms_var(--ease-out)_both]">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-ink"><Icon name="medal" size={18} /></span>
              <span>
                <span className="label-caps block">New level</span>
                <span className="font-bold">You've reached {n.title}.</span>
              </span>
            </div>
          )
        if (n.kind === 'streak')
          return (
            <div key={n.id} role="status" className="flex items-center gap-2 rounded-full bg-elevated px-3.5 py-2 text-sm font-semibold shadow-lg ring-1 ring-line animate-[xp-rise_420ms_var(--ease-out)_both]">
              <Icon name="flame" size={16} className="text-accent" /> You're on a {n.days}-day streak.
            </div>
          )
        const def = defs.data?.find((d) => d.id === n.achievementId)
        if (!def) return null
        return (
          <div key={n.id} role="status" className="flex max-w-sm items-center gap-3 rounded-lg bg-elevated px-4 py-3 text-sm shadow-lg ring-1 ring-line animate-[badge-in_380ms_var(--ease-out)_both]">
            <AchievementBadge def={def} unlockedAt="now" size={40} />
            <span>
              <span className="label-caps block">Achievement unlocked</span>
              <span className="font-bold">{def.name}</span>
              <span className="block text-[13px] text-muted">{def.description}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
