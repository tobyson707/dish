import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { IconButton } from '@/components/ui/Button'
import { useNavigate } from 'react-router'

export function AuthLayout({ title, subtitle, children, back = '/welcome', footer }: { title: string; subtitle?: ReactNode; children: ReactNode; back?: string | false; footer?: ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
      <div className="flex h-12 items-center justify-between">
        {back ? <IconButton icon="left" label="Back" className="-ml-2.5" onClick={() => nav(back)} /> : <span />}
        <Link to="/welcome" className="display text-title-3" aria-label="DISH home">
          DISH<span className="text-accent-strong">.</span>
        </Link>
      </div>
      <main className="page-enter mt-8 flex flex-1 flex-col">
        <h1 className="text-display">{title}</h1>
        {subtitle && <p className="mt-3 text-ink-2">{subtitle}</p>}
        <div className="mt-8 flex flex-1 flex-col">{children}</div>
      </main>
      {footer && <div className="mt-6 text-center text-sm text-ink-2">{footer}</div>}
    </div>
  )
}

export function GoogleButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} className="press flex h-12 w-full items-center justify-center gap-3 rounded-full bg-elevated font-semibold ring-1 ring-inset ring-line disabled:opacity-50">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Continue with Google
    </button>
  )
}

export const redirectUrl = (next = '/') => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
