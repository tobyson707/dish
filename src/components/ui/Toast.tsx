import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'

type Tone = 'info' | 'success' | 'error'
interface ToastItem {
  id: number
  message: string
  tone: Tone
  action?: { label: string; onClick: () => void }
}

interface ToastApi {
  show: (message: string, opts?: { tone?: Tone; action?: ToastItem['action']; duration?: number }) => void
  success: (message: string) => void
  error: (message: string) => void
}

const Ctx = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const show = useCallback<ToastApi['show']>(
    (message, opts = {}) => {
      const id = ++seq.current
      setItems((xs) => [...xs.slice(-2), { id, message, tone: opts.tone ?? 'info', action: opts.action }])
      setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 6000 : 3500))
    },
    [dismiss],
  )
  const api = useMemo<ToastApi>(() => ({ show, success: (m) => show(m, { tone: 'success' }), error: (m) => show(m, { tone: 'error', duration: 6000 }) }), [show])
  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(var(--nav-h) + var(--safe-bottom) + 16px)' }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg',
              'animate-[rise_var(--dur-standard)_var(--ease-enter)]',
              t.tone === 'error' ? 'bg-error text-on-error' : 'bg-ink text-on-ink',
            )}
          >
            {t.tone === 'success' && <Icon name="check" size={18} className="text-accent-on-ink" />}
            {t.tone === 'error' && <Icon name="alert" size={18} />}
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="rounded-full px-2 py-1 font-semibold text-accent-on-ink underline-offset-2 hover:underline"
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast outside ToastProvider')
  return v
}
