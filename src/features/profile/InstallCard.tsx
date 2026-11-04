import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
  })
}

/** Install guidance: native prompt where supported (Chromium), instructions on iOS. */
export function InstallCard() {
  const [canPrompt, setCanPrompt] = useState(!!deferred)
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone)
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  useEffect(() => {
    const on = () => setCanPrompt(true)
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  if (standalone) return null
  return (
    <div className="flex items-start gap-3 rounded-lg bg-surface p-4">
      <Icon name="download" size={22} className="mt-0.5" />
      <div className="flex-1 text-sm">
        <p className="font-semibold">Install DISH</p>
        {canPrompt ? (
          <>
            <p className="text-muted">Add DISH to your home screen for quick access and offline use.</p>
            <Button size="sm" className="mt-2" onClick={async () => { await deferred?.prompt(); deferred = null; setCanPrompt(false) }}>Install</Button>
          </>
        ) : ios ? (
          <p className="text-muted">In Safari, tap Share, then “Add to Home Screen”.</p>
        ) : (
          <p className="text-muted">Use your browser menu → “Install app” or “Add to Home screen”, if available.</p>
        )}
      </div>
    </div>
  )
}
