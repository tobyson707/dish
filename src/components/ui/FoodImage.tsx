import { useState } from 'react'
import { cn } from '@/lib/cn'
import { mealImageUrl } from '@/lib/supabase'
import { photoFor } from '@/data/mealPhotos'

function initialsOf(name: string) {
  return name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !['and', 'with', 'of', 'the'].includes(w.toLowerCase()))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
function toneIndex(name: string, n: number) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % n
}

/** Resolve the best available image: Supabase storage path, then bundled licensed photo. */
export function resolveMealImage(path: string | null | undefined, name: string, slug?: string | null, width = 640): { src: string; alt: string; credit?: string } | null {
  const remote = mealImageUrl(path, width)
  if (remote) return { src: remote, alt: name }
  const local = photoFor(slug, name)
  return local ? { src: local.src, alt: local.alt, credit: local.credit } : null
}

/**
 * Meal image with a fixed aspect ratio (no layout shift), lazy loading and a
 * refined fallback when no licensed photo exists yet. Photos are never filtered.
 */
export function FoodImage({ path, alt, name, slug, shape = 'rounded', className, width = 640, priority }: { path: string | null | undefined; alt?: string | null; name: string; slug?: string | null; shape?: 'circle' | 'rounded' | 'square'; className?: string; width?: number; priority?: boolean }) {
  const [failed, setFailed] = useState(false)
  const img = !failed ? resolveMealImage(path, name, slug, width) : null
  const radius = shape === 'circle' ? 'rounded-full' : shape === 'rounded' ? 'rounded-lg' : 'rounded-none'
  return (
    <div className={cn('relative overflow-hidden bg-surface', radius, className)}>
      {img ? (
        <img src={img.src} alt={alt || img.alt} loading={priority ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Fallback name={name} />
      )}
      {/* hairline that separates photos from dark surfaces; transparent in light */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-[var(--c-image-ring)]" />
    </div>
  )
}

const TONES = [
  ['var(--g-peach)', 'var(--c-accent-soft)'],
  ['var(--g-sage)', 'var(--g-leaf)'],
  ['var(--g-cream)', 'var(--g-peach)'],
] as const

function Fallback({ name }: { name: string }) {
  const initials = initialsOf(name)
  const [a, b] = TONES[toneIndex(name, TONES.length)]!
  return (
    <div role="img" aria-label={`${name} (no photo yet)`} className="absolute inset-0 flex items-center justify-center" style={{ background: `radial-gradient(120% 90% at 30% 20%, ${a}, ${b})`, containerType: 'size' }}>
      <span className="select-none font-serif text-ink/65" style={{ fontSize: initials.length > 1 ? '36cqw' : '48cqw', lineHeight: 1 }} aria-hidden="true">
        {initials || '•'}
      </span>
    </div>
  )
}

/**
 * Large editorial food image for the immersive canvas. Real photos fade softly
 * into the canvas; without a photo, an abstract plate composition (no cartoons)
 * carries the dish name so the composition stays intact.
 */
export function HeroFood({ path, name, slug, className }: { path?: string | null; name: string; slug?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false)
  const img = !failed ? resolveMealImage(path, name, slug, 1100) : null
  const [a, b] = TONES[toneIndex(name, TONES.length)]!
  if (img)
    return (
      <div className={cn('relative', className)}>
        <img
          src={img.src}
          alt={img.alt}
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full rounded-full object-cover"
          style={{ maskImage: 'radial-gradient(closest-side, #000 78%, transparent 100%)', WebkitMaskImage: 'radial-gradient(closest-side, #000 78%, transparent 100%)' }}
        />
      </div>
    )
  return (
    <div role="img" aria-label={`${name} (no photo yet)`} className={cn('relative', className)} style={{ containerType: 'inline-size' }}>
      {/* plate: soft rim, inner well, gentle shadow */}
      <div className="absolute inset-[4%] rounded-full shadow-[0_40px_80px_-30px_var(--c-shadow)]" style={{ background: 'radial-gradient(closest-side, var(--c-elevated) 72%, var(--c-surface) 86%, var(--c-elevated) 100%)' }} />
      <div className="absolute inset-[16%] rounded-full" style={{ background: `radial-gradient(70% 70% at 35% 30%, ${a}, ${b})` }} />
      <div className="absolute inset-[16%] flex items-center justify-center rounded-full">
        <span className="select-none font-serif italic text-ink/55" style={{ fontSize: '17cqw', lineHeight: 1 }} aria-hidden="true">
          {initialsOf(name) || '•'}
        </span>
      </div>
    </div>
  )
}
