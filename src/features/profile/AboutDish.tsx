import { useState } from 'react'
import { checkForUpdates, currentPlatform, RELEASE, type UpdateCheck } from '@/lib/release'
import { cn } from '@/lib/cn'
import { Icon } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { play } from '@/lib/uiSound'

type State = { s: 'idle' } | { s: 'checking' } | { s: 'done'; r: UpdateCheck } | { s: 'failed' }

/** Load the newest deployment: let a waiting service worker take over, then reload. */
async function applyWebUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
    const waiting = reg?.waiting
    if (waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
      waiting.postMessage({ type: 'SKIP_WAITING' })
      setTimeout(() => window.location.reload(), 3000) // in case the new worker never takes control
      return
    }
  } catch {
    /* no service worker: a plain reload fetches the new version */
  }
  window.location.reload()
}

/**
 * About DISH: name, release channel, the installed version, and a real update check against
 * what is published (/version.json from the live deployment). It never claims an update was
 * installed: on the web it offers to reload into the new version; in the store apps it opens
 * the listing (once one is configured in release.json).
 */
export function AboutDish() {
  const [st, setSt] = useState<State>({ s: 'idle' })
  const busy = st.s === 'checking'
  const check = async () => {
    if (busy) return // one check at a time
    setSt({ s: 'checking' })
    try {
      const r = await checkForUpdates()
      setSt({ s: 'done', r })
      if (r.status === 'available') play('confirm')
    } catch {
      setSt({ s: 'failed' })
      play('error')
    }
  }
  const platform = currentPlatform()
  return (
    <section aria-labelledby="about-title" className="mt-10">
      <h2 id="about-title" className="text-title-3">About DISH</h2>
      <div className="mt-3 rounded-lg bg-elevated p-5">
        <div className="flex items-center gap-3">
          <p className="text-title-2 font-extrabold leading-none tracking-tight">
            DISH<span className="text-accent">.</span>
          </p>
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-micro font-bold uppercase tracking-[0.14em] text-accent-strong ring-1 ring-inset ring-accent-border">{RELEASE.channel === 'beta' ? 'Beta' : 'Stable'}</span>
        </div>
        <p className="num mt-2 text-sm text-ink-2">
          Version <span className="font-semibold text-ink" data-testid="app-version">{RELEASE.version}</span>
          {RELEASE.releasedAt && <span className="text-muted"> · released {new Date(`${RELEASE.releasedAt}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>}
        </p>
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy}
          aria-busy={busy || undefined}
          className={cn('press mt-4 inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-bold disabled:cursor-default', busy ? 'bg-ink/80 text-on-ink' : 'bg-ink text-on-ink')}
        >
          {busy ? <span className="state-in inline-flex"><Spinner size={16} /></span> : <Icon name="refresh" size={16} />}
          {busy ? 'Checking for updates...' : 'Check for updates'}
        </button>
        <div aria-live="polite" className="mt-3 min-h-5 text-sm">
          {st.s === 'done' && st.r.status === 'current' && <p className="state-in text-ink-2">You're using the latest version of DISH.</p>}
          {st.s === 'failed' && (
            <p className="state-in text-error">Couldn't check for updates. Please try again.</p>
          )}
          {st.s === 'done' && st.r.status === 'available' && (
            <div className="state-in rounded-[16px] bg-accent-soft p-4 ring-1 ring-inset ring-accent-border">
              <p className="font-semibold text-ink">Update available</p>
              <p className="num mt-0.5 text-ink-2">
                Version {st.r.latest.version} is out. You have {RELEASE.version}.
                {st.r.latest.notes ? ` ${st.r.latest.notes}` : ''}
              </p>
              {st.r.action.kind === 'reload' && (
                <button type="button" onClick={() => void applyWebUpdate()} className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold text-accent-ink">
                  <Icon name="refresh" size={16} /> Reload to update
                </button>
              )}
              {st.r.action.kind === 'store' && (
                <a href={st.r.action.url} target="_blank" rel="noopener noreferrer" className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-bold text-accent-ink">
                  Open {platform === 'ios' ? 'the App Store' : 'Google Play'} <Icon name="arrow" size={16} />
                </a>
              )}
              {st.r.action.kind === 'unavailable' && <p className="mt-2 text-footnote text-muted">{st.r.action.reason}</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
