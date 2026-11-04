import { useState } from 'react'
import { cn } from '@/lib/cn'
import { mealImageUrl } from '@/lib/supabase'

/**
 * Meal image with a fixed aspect ratio (no layout shift), lazy loading and a
 * typographic fallback when no licensed photo exists yet.
 */
export function FoodImage({ path, alt, name, shape = 'rounded', className, width = 640, priority }: { path: string | null | undefined; alt?: string | null; name: string; shape?: 'circle' | 'rounded' | 'square'; className?: string; width?: number; priority?: boolean }) {
  const [failed, setFailed] = useState(false)
  const url = !failed ? mealImageUrl(path, width) : null
  const radius = shape === 'circle' ? 'rounded-full' : shape === 'rounded' ? 'rounded-lg' : 'rounded-none'
  return (
    <div className={cn('relative overflow-hidden bg-surface', radius, className)}>
      {url ? (
        <img
          src={url}
          alt={alt || name}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <Fallback name={name} />
      )}
    </div>
  )
}

function Fallback({ name }: { name: string }) {
  const initials = name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !['and', 'with', 'of', 'the'].includes(w.toLowerCase()))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
  // deterministic warm tone per dish
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const tones = ['var(--c-dot)', 'var(--c-dot-soft)', 'var(--c-accent-soft)']
  return (
    <div role="img" aria-label={`${name} (no photo yet)`} className="absolute inset-0 flex items-center justify-center" style={{ background: tones[h % tones.length], containerType: 'size' }}>
      <span className="display select-none text-ink/70" style={{ fontSize: initials.length > 1 ? '34cqw' : '46cqw', lineHeight: 1 }} aria-hidden="true">
        {initials || '•'}
      </span>
      <span className="absolute right-[14%] top-[14%] aspect-square w-[9%] min-w-2 max-w-6 rounded-full bg-accent" aria-hidden="true" />
    </div>
  )
}
