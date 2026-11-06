import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import type { CoverCrop } from '@/types/db'
import { useCoverUrl } from '@/data/planbook'
import { FoodImage } from '@/components/ui/FoodImage'

/**
 * The one way a cover's framing is drawn, in every size and shape: the image covers the
 * frame with its focal point aligned to the same point of the frame, then zooms about
 * that point. The stored image is never changed.
 */
export function cropStyle(crop: CoverCrop | null | undefined): CSSProperties {
  const c = crop ?? { x: 0.5, y: 0.5, zoom: 1 }
  const at = `${(c.x * 100).toFixed(2)}% ${(c.y * 100).toFixed(2)}%`
  return { objectFit: 'cover', objectPosition: at, transformOrigin: at, transform: c.zoom > 1 ? `scale(${c.zoom})` : undefined }
}

/**
 * A plan's cover: its own image (private, via a short-lived link), otherwise a collage
 * of up to four of its meals, otherwise its initial on a quiet block.
 */
export function PlanCover({ plan, className }: { plan: { title: string | null; cover_path?: string | null; cover_crop?: CoverCrop | null; collage?: { path: string | null; slug: string | null; name: string }[] }; className?: string }) {
  const cover = useCoverUrl(plan.cover_path)
  const tiles = plan.collage ?? []
  if (plan.cover_path && cover.data)
    return (
      <div className={cn('h-full w-full overflow-hidden', className)}>
        <img src={cover.data} alt="" className="h-full w-full animate-[fade_var(--dur-standard)_var(--ease-enter)]" style={cropStyle(plan.cover_crop)} loading="lazy" decoding="async" />
      </div>
    )
  if (plan.cover_path && cover.isPending) return <div aria-hidden="true" className={cn('skeleton h-full w-full', className)} />
  if (tiles.length >= 1)
    return (
      <div aria-hidden="true" className={cn('grid h-full w-full gap-0.5 bg-line', tiles.length >= 4 ? 'grid-cols-2 grid-rows-2' : tiles.length >= 2 ? 'grid-cols-2' : 'grid-cols-1', className)}>
        {tiles.slice(0, tiles.length >= 4 ? 4 : tiles.length >= 2 ? 2 : 1).map((t) => (
          <FoodImage key={t.name} path={t.path} slug={t.slug} name={t.name} className="h-full w-full" width={360} />
        ))}
      </div>
    )
  return (
    <div aria-hidden="true" className={cn('flex h-full w-full items-center justify-center bg-ink text-on-ink', className)}>
      <span className="text-[3rem] font-extrabold leading-none tracking-tight">{(plan.title ?? '').trim().charAt(0).toUpperCase() || 'D'}</span>
      <span className="text-[3rem] font-extrabold leading-none text-accent">.</span>
    </div>
  )
}
