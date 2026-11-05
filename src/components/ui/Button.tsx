import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cn } from '@/lib/cn'
import { Icon, type IconName } from './Icon'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const base =
  'press inline-flex items-center justify-center gap-2 font-semibold select-none whitespace-nowrap disabled:opacity-45 rounded-full transition-colors'
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-on-ink hover:opacity-90',
  accent: 'bg-accent text-accent-ink hover:brightness-105',
  secondary: 'bg-transparent text-ink ring-1 ring-inset ring-ink/25 hover:bg-ink/5',
  ghost: 'bg-transparent text-ink hover:bg-ink/6',
  danger: 'bg-error text-on-error hover:opacity-90',
}
const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-12 px-5 text-[15px]',
  lg: 'h-14 px-7 text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: IconName
  iconRight?: IconName
  loading?: boolean
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], block && 'w-full', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={18} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} /> : null}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 16 : 20} />}
    </button>
  )
})

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  block,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: IconName; iconRight?: IconName; block?: boolean; children: ReactNode }) {
  return (
    <Link className={cn(base, variants[variant], sizes[size], block && 'w-full', className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 20} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 16 : 20} />}
    </Link>
  )
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; tone?: 'plain' | 'filled' | 'accent'; size?: number }>(
  function IconButton({ icon, label, tone = 'plain', size = 44, className, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          'press inline-flex shrink-0 items-center justify-center rounded-full disabled:opacity-40',
          tone === 'plain' && 'text-ink hover:bg-ink/6',
          tone === 'filled' && 'bg-elevated text-ink shadow-[0_1px_0_var(--c-shadow)]',
          tone === 'accent' && 'bg-accent text-accent-ink',
          className,
        )}
        style={{ width: size, height: size }}
        {...rest}
      >
        <Icon name={icon} size={Math.round(size * 0.46)} />
      </button>
    )
  },
)
