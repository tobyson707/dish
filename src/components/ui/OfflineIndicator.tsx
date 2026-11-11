import { useState } from 'react'
import { Link } from 'react-router'
import { useSyncState } from '@/offline/useSync'
import { listProblems, retryProblem } from '@/offline/outbox'
import { Icon } from './Icon'
import { Spinner } from './Spinner'

/**
 * Connection status, only when it matters. Online and syncing normally: nothing at all (no
 * "syncing…", no "saved"). Offline: one small note, and how many changes are safely kept on
 * this device (they are, in its local database). Changes that keep failing: a discreet
 * warning with Retry; the changes are kept until they go through or you decide.
 */
export function OfflineIndicator() {
  const s = useSyncState()
  const [retrying, setRetrying] = useState(false)
  const problems = s.failed + s.conflicts
  if (s.online && problems === 0) return null
  if (!s.online)
    return (
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[65] flex justify-center px-4" style={{ top: 'calc(var(--safe-top) + 8px)' }}>
        <div className="state-in pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-[18px] bg-ink px-4 py-2.5 text-on-ink shadow-[0_12px_30px_-12px_var(--c-shadow)]">
          <Icon name="offline" size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-footnote font-bold">You're offline</span>
            <span className="block text-micro text-on-ink/75">
              {s.pending ? `${s.pending} change${s.pending > 1 ? 's' : ''} saved on this device. ` : ''}Your changes will sync when you're back online.
            </span>
          </span>
        </div>
      </div>
    )
  return (
    <div role="alert" className="fixed inset-x-0 z-[65] flex justify-center px-4" style={{ top: 'calc(var(--safe-top) + 8px)' }}>
      <div className="state-in flex max-w-sm items-center gap-2.5 rounded-[18px] bg-ink px-4 py-2 text-on-ink shadow-[0_12px_30px_-12px_var(--c-shadow)]">
        <Icon name="alert" size={16} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 text-footnote">
          <span className="font-bold">{problems} change{problems > 1 ? 's' : ''} couldn't sync.</span> <span className="text-on-ink/75">They're kept on this device.</span>
        </span>
        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true)
            try {
              const { failed } = await listProblems()
              for (const f of failed) await retryProblem(f.id)
            } finally {
              setRetrying(false)
            }
          }}
          className="press inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-micro font-bold text-accent-ink"
        >
          {retrying ? <Spinner size={13} /> : <Icon name="refresh" size={13} />} Retry
        </button>
        <Link to="/profile/sync" className="shrink-0 text-micro font-semibold underline underline-offset-2">Review</Link>
      </div>
    </div>
  )
}
