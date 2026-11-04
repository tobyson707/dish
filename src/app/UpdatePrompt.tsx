import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '@/components/ui/Button'

/** Shows a safe "update available" prompt; the new service worker activates only when the user agrees. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000)
    },
  })
  if (!needRefresh && !offlineReady) return null
  return (
    <div role="status" className="fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-lg bg-ink px-4 py-3 text-sm text-on-ink shadow-lg animate-[rise_220ms_var(--ease-out)]" style={{ marginTop: 'var(--safe-top)' }}>
      <span className="flex-1">{needRefresh ? 'A new version of DISH is ready.' : 'DISH is ready to work offline.'}</span>
      {needRefresh && (
        <Button size="sm" variant="accent" onClick={() => void updateServiceWorker(true)}>
          Update
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="text-on-ink"
        onClick={() => {
          setNeedRefresh(false)
          setOfflineReady(false)
        }}
      >
        {needRefresh ? 'Later' : 'OK'}
      </Button>
    </div>
  )
}
