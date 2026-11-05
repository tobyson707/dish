import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import { useProfile } from '@/data/profile'
import { gamKeys, useAchievementDefinitions, useGamification, type GamificationSummary } from '@/data/gamification'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { achievementIcon } from '@/components/gamification/Achievements'
import { shareOrDownload } from '@/features/plan/export/share'
import { renderShareCard } from './shareCard'

// ── level-ups are detected client-side by the notifier and queued here ──
interface LevelEvent {
  id: string
  title: string
  at: string
}
let levelQueue: LevelEvent[] = []
const listeners = new Set<() => void>()
export function queueLevelCelebration(e: LevelEvent) {
  if (levelQueue.some((x) => x.id === e.id)) return
  levelQueue = [...levelQueue, e]
  listeners.forEach((l) => l())
}
const useLevelQueue = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => levelQueue,
  )

type Item = { key: string; kind: 'achievement'; id: string; at: string } | { key: string; kind: 'level'; id: string; title: string; at: string }

/** Another layer is open (a sheet, the category drawer): never interrupt it. */
const busy = () => !!document.querySelector('dialog:modal:not([data-celebration])') || !!document.documentElement.dataset.overlay

/**
 * Milestone celebrations. Achievements come from the server (unlocking is
 * idempotent; `celebrated_at` makes each show once on any device); level-ups
 * from the notifier. One at a time, never over another open layer, respecting
 * the user's "Progress feedback" setting.
 */
export function Celebrations() {
  const uid = useUserId()
  const qc = useQueryClient()
  const g = useGamification()
  const defs = useAchievementDefinitions()
  const profile = useProfile()
  const toast = useToast()
  const levels = useLevelQueue()
  const ref = useRef<HTMLDialogElement>(null)
  const [current, setCurrent] = useState<Item | null>(null)
  const [sharing, setSharing] = useState(false)

  const pending = useMemo<Item[]>(() => {
    const ach = (g.data?.achievements ?? []).filter((a) => !a.celebrated_at).map((a) => ({ key: `a:${a.id}`, kind: 'achievement' as const, id: a.id, at: a.unlocked_at }))
    const lv = levels.map((l) => ({ key: `l:${l.id}`, kind: 'level' as const, id: l.id, title: l.title, at: l.at }))
    return [...ach, ...lv].sort((a, b) => a.at.localeCompare(b.at))
  }, [g.data, levels])

  async function markDone(item: Item) {
    if (item.kind === 'level') {
      levelQueue = levelQueue.filter((l) => l.id !== item.id)
      listeners.forEach((l) => l())
      return
    }
    // optimistic: stop it showing again right away, then record it on the server
    qc.setQueryData<GamificationSummary>(gamKeys.summary(uid), (s) => (s ? { ...s, achievements: s.achievements.map((a) => (a.id === item.id ? { ...a, celebrated_at: new Date().toISOString() } : a)) } : s))
    await supabase.rpc('mark_achievements_celebrated', { p_ids: [item.id] })
  }

  // pick the next item when idle; wait (poll gently) while another layer is open
  useEffect(() => {
    if (current || !pending.length || !defs.data) return
    if (g.data && !g.data.feedback_enabled) {
      pending.forEach((p) => void markDone(p)) // feedback off: record silently
      return
    }
    let t: ReturnType<typeof setTimeout>
    const tryShow = () => {
      if (busy()) t = setTimeout(tryShow, 1200)
      else setCurrent(pending[0]!)
    }
    t = setTimeout(tryShow, 700) // let the action that unlocked it finish first
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, pending, defs.data, g.data])

  useEffect(() => {
    const d = ref.current
    if (current && d && !d.open) d.showModal()
  }, [current])

  const close = () => {
    const item = current
    ref.current?.close()
    setCurrent(null)
    if (item) void markDone(item)
  }

  if (!current) return null
  const def = current.kind === 'achievement' ? defs.data?.find((d) => d.id === current.id) : null
  const title = current.kind === 'level' ? current.title : (def?.name ?? 'Achievement')
  const line = current.kind === 'level' ? 'You reached a new level.' : (def?.description ?? '')
  const icon = current.kind === 'level' ? 'medal' : achievementIcon(def?.icon ?? 'medal')
  const label = current.kind === 'level' ? 'New level' : 'Achievement unlocked'
  const name = profile.data?.display_name?.trim() || null

  async function share() {
    setSharing(true)
    try {
      const blob = await renderShareCard({ label, title, line, icon, name, date: current!.at })
      const file = new File([blob], `DISH-${title.replace(/[^A-Za-z0-9]+/g, '-')}.png`, { type: 'image/png' })
      const r = await shareOrDownload([file], { title, text: `${title} on DISH` })
      if (r === 'downloaded') toast.show('Saved the card to your device.')
    } catch {
      toast.error("We couldn't create the card. Please try again.")
    } finally {
      setSharing(false)
    }
  }

  return (
    <dialog
      ref={ref}
      data-celebration
      aria-labelledby="celebration-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      className="celebration m-auto w-[min(92vw,400px)] overflow-visible bg-transparent p-0 backdrop:bg-[var(--c-scrim)] backdrop:backdrop-blur-sm"
    >
      <div className="celebration-card relative overflow-hidden rounded-[32px] bg-[var(--c-glass-dark)] px-7 pb-7 pt-10 text-center text-on-glass-dark ring-1 ring-white/10 backdrop-blur-2xl">
        <span aria-hidden="true" className="celebration-glow pointer-events-none absolute left-1/2 top-10 h-48 w-48 -translate-x-1/2 rounded-full bg-accent/30 blur-3xl" />
        <span aria-hidden="true" className="relative mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-white/[0.08] ring-1 ring-white/10">
          <span className="celebration-badge flex h-20 w-20 items-center justify-center rounded-full bg-accent text-accent-ink">
            <Icon name={icon} size={38} />
          </span>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="celebration-spark absolute h-1.5 w-1.5 rounded-full bg-accent" style={{ ['--i' as string]: i }} />
          ))}
        </span>
        <p className="relative mt-6 text-caption font-bold uppercase tracking-[0.18em] text-accent">{label}</p>
        <h2 id="celebration-title" className="relative mt-2 text-title-2 leading-tight">
          {title}
        </h2>
        {line && <p className="relative mt-2 text-callout text-on-glass-dark-muted">{line}</p>}
        <div className="relative mt-7 flex flex-col gap-2">
          <button type="button" onClick={share} disabled={sharing} className="press inline-flex h-12 items-center justify-center gap-2 rounded-full bg-on-glass-dark font-semibold text-on-glass-dark-ink disabled:opacity-60">
            <Icon name="arrow" size={18} /> {sharing ? 'Preparing…' : 'Share'}
          </button>
          <button type="button" onClick={close} className="press h-12 rounded-full font-semibold text-on-glass-dark ring-1 ring-inset ring-white/15 hover:bg-white/10">
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}
