import { cn } from '@/lib/cn'
import { useCoverUrl } from '@/data/planbook'
import { FoodImage } from '@/components/ui/FoodImage'

/**
 * A plan's cover: its own image (private, via a short-lived link), otherwise a collage
 * of up to four of its meals, otherwise its initial on a quiet block.
 */
export function PlanCover({ plan, className }: { plan: { title: string; cover_path?: string | null; collage?: { path: string | null; slug: string | null; name: string }[] }; className?: string }) {
  const cover = useCoverUrl(plan.cover_path)
  const tiles = plan.collage ?? []
  if (plan.cover_path && cover.data) return <img src={cover.data} alt="" className={cn('h-full w-full object-cover', className)} loading="lazy" decoding="async" />
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
      <span className="text-[3rem] font-extrabold leading-none tracking-tight">{plan.title.trim().charAt(0).toUpperCase() || 'D'}</span>
      <span className="text-[3rem] font-extrabold leading-none text-accent">.</span>
    </div>
  )
}
