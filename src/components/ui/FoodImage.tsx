import { useState } from 'react'
import { cn } from '@/lib/cn'
import { mealImageOriginalUrl, mealImageUrl } from '@/lib/supabase'
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

type Resolved = { src: string; srcSet?: string; alt: string; credit?: string }

/**
 * Image sources in order of preference: the approved catalogue photo in
 * Supabase Storage (resized, with a 2× source), the stored original (when
 * resizing isn't available on the project), then a bundled licensed photo.
 */
export function mealImageCandidates(path: string | null | undefined, name: string, slug?: string | null, width = 640): Resolved[] {
  const out: Resolved[] = []
  const resized = mealImageUrl(path, width)
  if (resized) out.push({ src: resized, srcSet: `${resized} 1x, ${mealImageUrl(path, Math.min(width * 2, 1536))} 2x`, alt: name })
  const original = mealImageOriginalUrl(path)
  if (original) out.push({ src: original, alt: name })
  const local = photoFor(slug, name)
  if (local) out.push({ src: local.src, alt: local.alt, credit: local.credit })
  return out
}

/** Best available image (first candidate). */
export function resolveMealImage(path: string | null | undefined, name: string, slug?: string | null, width = 640): Resolved | null {
  return mealImageCandidates(path, name, slug, width)[0] ?? null
}

/** Moves to the next candidate when one fails to load; resets when the path changes. */
function useCandidate(path: string | null | undefined, name: string, slug: string | null | undefined, width: number) {
  const [state, setState] = useState({ key: `${path}|${slug}`, stage: 0 })
  const key = `${path}|${slug}`
  const stage = state.key === key ? state.stage : 0
  const img = mealImageCandidates(path, name, slug, width)[stage] ?? null
  return { img, next: () => setState({ key, stage: stage + 1 }) }
}

/**
 * Meal image with a fixed aspect ratio (no layout shift), lazy loading and a
 * refined fallback when no licensed photo exists yet. Photos are never filtered.
 */
export function FoodImage({ path, alt, name, slug, shape = 'rounded', className, width = 640, priority }: { path: string | null | undefined; alt?: string | null; name: string; slug?: string | null; shape?: 'circle' | 'rounded' | 'square'; className?: string; width?: number; priority?: boolean }) {
  const { img, next } = useCandidate(path, name, slug, width)
  const radius = shape === 'circle' ? 'rounded-full' : shape === 'rounded' ? 'rounded-lg' : 'rounded-none'
  return (
    <div className={cn('relative overflow-hidden bg-surface', radius, className)}>
      {img ? (
        <img key={img.src} src={img.src} srcSet={img.srcSet} alt={alt || img.alt} loading={priority ? 'eager' : 'lazy'} decoding="async" onError={next} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Fallback name={name} />
      )}
      {/* hairline that separates photos from dark surfaces; transparent in light */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-[var(--c-image-ring)]" />
    </div>
  )
}

// neutral tones only (monochrome identity); slight variation keeps lists readable
const TONES = [
  ['var(--g-cream)', 'var(--g-leaf)'],
  ['var(--g-peach)', 'var(--g-sage)'],
  ['var(--g-sage)', 'var(--g-leaf)'],
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
  const { img, next } = useCandidate(path, name, slug, 1100)
  const [a, b] = TONES[toneIndex(name, TONES.length)]!
  if (img)
    return (
      <div className={cn('relative', className)}>
        <img
          key={img.src}
          src={img.src}
          srcSet={img.srcSet}
          alt={img.alt}
          decoding="async"
          onError={next}
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
