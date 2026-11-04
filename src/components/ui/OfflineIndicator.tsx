import { Link } from 'react-router'
import { useSyncState } from '@/offline/useSync'
import { Icon } from './Icon'

/** Slim status bar: offline, pending changes, or sync problems. Hidden when all is well. */
export function OfflineIndicator() {
  const s = useSyncState()
  if (s.online && s.pending === 0 && s.failed === 0 && s.conflicts === 0) return null
  let text: string
  let icon: 'offline' | 'cloud' | 'alert' = 'cloud'
  if (!s.online) {
    icon = 'offline'
    text = s.pending ? `Offline · ${s.pending} change${s.pending > 1 ? 's' : ''} waiting to sync` : "You're offline · showing saved data"
  } else if (s.failed || s.conflicts) {
    icon = 'alert'
    text = `${s.failed + s.conflicts} change${s.failed + s.conflicts > 1 ? 's need' : ' needs'} your attention`
  } else {
    text = s.syncing ? `Syncing ${s.pending} change${s.pending > 1 ? 's' : ''}…` : `${s.pending} change${s.pending > 1 ? 's' : ''} waiting to sync`
  }
  return (
    <div role="status" aria-live="polite" className="sticky top-0 z-40 bg-ink text-on-ink" style={{ paddingTop: 'var(--safe-top)' }}>
      <Link to="/profile/sync" className="mx-auto flex max-w-3xl items-center justify-center gap-2 px-4 py-2 text-[13px] font-medium">
        <Icon name={icon} size={16} className={icon === 'alert' ? 'text-accent' : undefined} />
        {text}
      </Link>
    </div>
  )
}
