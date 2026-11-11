import { Link, useLocation } from 'react-router'
import { useDeletionRequest } from '@/data/accountDeletion'
import { Icon } from '@/components/ui/Icon'

/** While the account is scheduled for deletion, every screen says so, with the way to cancel. */
export function DeletionBanner() {
  const req = useDeletionRequest()
  const loc = useLocation()
  if (!req.data || loc.pathname === '/profile/privacy') return null
  const date = new Date(req.data.delete_after).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
  return (
    <div role="status" className="fixed inset-x-0 z-[70] flex justify-center px-4" style={{ top: 'calc(var(--safe-top) + 8px)' }}>
      <Link to="/profile/privacy" className="press inline-flex max-w-full items-center gap-2 rounded-full bg-ink px-4 py-2 text-footnote font-semibold text-on-ink shadow-[0_12px_30px_-12px_var(--c-shadow)]">
        <Icon name="alert" size={15} className="shrink-0 text-accent" />
        <span className="truncate">Account deletion scheduled for {date}</span>
        <span className="shrink-0 text-accent">Cancel</span>
      </Link>
    </div>
  )
}
