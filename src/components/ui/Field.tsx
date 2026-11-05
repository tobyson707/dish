import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { Icon } from './Icon'

const inputCls =
  'w-full h-12 rounded-md bg-input px-4 text-ink placeholder:text-muted ring-1 ring-inset ring-input-border focus:ring-2 focus:ring-ink outline-none transition-shadow disabled:opacity-50 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-error'

interface FieldWrapProps {
  label: string
  hint?: ReactNode
  error?: string | null
  hideLabel?: boolean
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
  className?: string
}

export function FieldWrap({ label, hint, error, hideLabel, children, className }: FieldWrapProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-sm font-semibold text-ink', hideLabel && 'sr-only')}>
        {label}
      </label>
      {children({ id, describedBy: [hintId, errId].filter(Boolean).join(' ') || undefined, invalid: !!error })}
      {hint && !error && (
        <p id={hintId} className="text-footnote text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="flex items-center gap-1 text-footnote font-medium text-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; hideLabel?: boolean; suffix?: ReactNode }

export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField({ label, hint, error, hideLabel, suffix, className, ...rest }, ref) {
  return (
    <FieldWrap label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input ref={ref} id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn(inputCls, suffix ? 'pr-14' : undefined)} {...rest} />
          {suffix && <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted">{suffix}</span>}
        </div>
      )}
    </FieldWrap>
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode; error?: string | null }>(
  function TextArea({ label, hint, error, className, ...rest }, ref) {
    return (
      <FieldWrap label={label} hint={hint} error={error} className={className}>
        {({ id, describedBy, invalid }) => (
          <textarea ref={ref} id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn(inputCls, 'h-auto min-h-24 py-3')} {...rest} />
        )}
      </FieldWrap>
    )
  },
)

export function Select({ label, hint, error, options, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode; error?: string | null; options: { value: string; label: string }[] }) {
  return (
    <FieldWrap label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <select id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn(inputCls, 'appearance-none pr-10')} {...rest}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="down" size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        </div>
      )}
    </FieldWrap>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search', label = 'Search', className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputCls, 'rounded-full pl-11 pr-10')}
        {...rest}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-ink">
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  )
}

/**
 * Password input with a visibility toggle inside the field. Toggling only swaps
 * the input type (the value and caret are kept); the button is labelled and
 * keyboard reachable. Use for every password field.
 */
export const PasswordField = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'suffix'>>(function PasswordField({ label, hint, error, hideLabel, className, ...rest }, ref) {
  const [shown, setShown] = useState(false)
  return (
    <FieldWrap label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input ref={ref} id={id} type={shown ? 'text' : 'password'} aria-describedby={describedBy} aria-invalid={invalid || undefined} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cn(inputCls, 'pr-14')} {...rest} />
          <button
            type="button"
            aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={shown}
            aria-controls={id}
            onMouseDown={(e) => e.preventDefault()} // keep focus (and the caret) in the field
            onClick={() => setShown((v) => !v)}
            className="absolute inset-y-0 right-1.5 my-auto flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:text-ink focus-visible:text-ink"
          >
            <Icon name={shown ? 'eyeOff' : 'eye'} size={20} />
          </button>
        </div>
      )}
    </FieldWrap>
  )
})
