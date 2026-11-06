import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { friendlyError } from '@/lib/errors'
import { Icon, type IconName } from './Icon'
import { Spinner } from './Spinner'
import { useToast } from './Toast'

export type ActionPhase = 'idle' | 'busy' | 'done' | 'error'

/**
 * One action's honest state: idle → busy while the request runs → done only once it has
 * succeeded (briefly, then idle again), or error (the previous state stays, the message
 * says what happened, and Retry runs it again). A second press while busy is ignored.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string | ((r: R) => string | null) | null; doneMs?: number; retry?: boolean } = {}) {
  const [phase, setPhase] = useState<ActionPhase>('idle')
  const toast = useToast()
  const running = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const run = async (...args: A): Promise<{ value: R } | null> => {
    if (running.current) return null
    running.current = true
    if (timer.current) clearTimeout(timer.current)
    setPhase('busy')
    try {
      const r = await fn(...args)
      setPhase('done')
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success
      if (msg) toast.show(msg, { tone: 'success', duration: 2200 })
      timer.current = setTimeout(() => setPhase('idle'), opts.doneMs ?? 1600)
      return { value: r }
    } catch (e) {
      setPhase('error')
      const message = friendlyError(e)
      if (opts.retry === false) toast.error(message)
      else toast.show(message, { tone: 'error', duration: 6000, action: { label: 'Retry', onClick: () => void run(...args) } })
      timer.current = setTimeout(() => setPhase('idle'), 2400)
      return null
    } finally {
      running.current = false
    }
  }
  return { phase, busy: phase === 'busy', run }
}

/** The icon for an action's state: its own icon, a spinner while busy, a tick once done. Each change cross-fades. */
export function StateIcon({ phase, icon, doneIcon = 'check', filled, size = 18 }: { phase: ActionPhase; icon: IconName; doneIcon?: IconName; filled?: boolean; size?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {phase === 'busy' ? (
        <span key="busy" className="state-in inline-flex"><Spinner size={size} /></span>
      ) : (
        <Icon name={phase === 'done' ? doneIcon : phase === 'error' ? 'alert' : icon} filled={phase === 'done' ? filled ?? false : filled} size={size} />
      )}
    </span>
  )
}

type Tone = 'ink' | 'accent' | 'soft' | 'glass' | 'danger'
const TONES: Record<Tone, string> = {
  ink: 'bg-ink text-on-ink',
  accent: 'bg-accent text-accent-ink',
  soft: 'bg-elevated text-ink ring-1 ring-inset ring-line',
  glass: 'bg-glass text-ink ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-md',
  danger: 'bg-error text-on-error',
}

/**
 * A button that runs an async action and shows each step: pressed → working (spinner) →
 * done (tick, its "done" label) or error (alert; the toast offers Retry).
 */
export function ActionButton({ action, icon, doneIcon = 'check', children, doneLabel, busyLabel, success, tone = 'soft', size = 'md', className, iconOnly, label, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> & {
  action: () => Promise<unknown>
  icon: IconName
  doneIcon?: IconName
  children?: ReactNode
  doneLabel?: ReactNode
  busyLabel?: ReactNode
  success?: string | null
  tone?: Tone
  size?: 'sm' | 'md'
  iconOnly?: boolean
  label?: string
}) {
  const { phase, run } = useAction(action, { success })
  const text = phase === 'busy' && busyLabel ? busyLabel : phase === 'done' && doneLabel ? doneLabel : children
  return (
    <button
      type="button"
      onClick={() => void run()}
      aria-busy={phase === 'busy' || undefined}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      data-phase={phase}
      className={cn(
        'press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold disabled:opacity-45',
        size === 'sm' ? 'h-9 text-sm' : 'h-11 text-sm',
        iconOnly ? (size === 'sm' ? 'w-9' : 'w-11') : size === 'sm' ? 'px-3.5' : 'px-4',
        phase === 'done' && tone !== 'danger' ? TONES.accent : TONES[tone],
        phase === 'done' && 'pulse-once',
        className,
      )}
      {...rest}
    >
      <StateIcon phase={phase} icon={icon} doneIcon={doneIcon} size={size === 'sm' ? 16 : 18} />
      {!iconOnly && text && <span key={phase === 'done' ? 'done' : 'idle'} className="state-in">{text}</span>}
      {iconOnly && <span className="sr-only" aria-live="polite">{phase === 'busy' ? 'Working' : phase === 'done' ? 'Done' : ''}</span>}
    </button>
  )
}

/**
 * Save / favourite: the heart (or bookmark) shows the stored state. A press shows a spinner
 * while the change is saved, then the icon fills (or empties) once the server confirms.
 * On failure nothing changes, the reason is shown, and Retry tries again.
 */
export function SaveToggle({ on, onToggle, label, savedMessage = 'Saved', removedMessage = 'Removed from saved', icon = 'heart', className, size = 40, withText }: {
  on: boolean
  onToggle: (next: boolean) => Promise<unknown>
  label: { save: string; remove: string }
  savedMessage?: string | null
  removedMessage?: string | null
  icon?: IconName
  className?: string
  size?: number
  withText?: boolean
}) {
  const { phase, run } = useAction((next: boolean) => onToggle(next), { success: null })
  const toast = useToast()
  const press = async () => {
    const next = !on
    const ok = await run(next)
    if (ok) {
      const msg = next ? savedMessage : removedMessage
      if (msg) toast.show(msg, { tone: 'success', duration: 1800 })
    }
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-busy={phase === 'busy' || undefined}
      aria-label={on ? label.remove : label.save}
      title={on ? label.remove : label.save}
      onClick={() => void press()}
      data-phase={phase}
      className={cn('press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full', on ? 'text-accent-strong' : 'text-ink', withText && 'px-4 font-semibold', className)}
      style={withText ? { height: size } : { width: size, height: size }}
    >
      {phase === 'busy' ? <span key="busy" className="state-in inline-flex"><Spinner size={18} /></span> : <Icon name={icon} size={18} filled={on} />}
      {withText && <span>{on ? 'Saved' : 'Save'}</span>}
    </button>
  )
}
