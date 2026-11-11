import { useMemo } from 'react'
import { Link } from 'react-router'
import { addDays } from '@domain/dates.ts'
import { useDiary } from '@/data/diary'
import { usePlannedMeals } from '@/data/plans'
import { useFavourites } from '@/data/favourites'
import { useCatalogue } from '@/data/catalogue'
import { useToday } from '@/hooks/useToday'
import { dayLabel } from '@/lib/format'
import { PageHeader, Section } from '@/components/ui/Layout'
import { FoodImage } from '@/components/ui/FoodImage'
import { ButtonLink } from '@/components/ui/Button'
import { GhostRegion, ListRowsGhost } from '@/components/ui/Ghost'

export function HistoryPage() {
  const today = useToday()
  const from = addDays(today, -30)
  const diary = useDiary(from, today)
  const planned = usePlannedMeals(from, today)
  const favs = useFavourites()
  const cat = useCatalogue()
  const byId = useMemo(() => new Map((cat.data ?? []).map((f) => [f.id, f])), [cat.data])
  const recentRecipes = useMemo(() => {
    const seen = new Set<string>()
    return [...(diary.data ?? []), ...(planned.data ?? []).filter((p) => p.method === 'cook')]
      .map((x) => x.food_item_id)
      .filter((id): id is string => !!id && !seen.has(id) && !!seen.add(id) && !!byId.get(id)?.recipe?.steps.length)
      .slice(0, 10)
  }, [diary.data, planned.data, byId])
  const generated = useMemo(() => {
    const seen = new Set<string>()
    return (planned.data ?? []).filter((p) => p.food_item_id && !seen.has(p.food_item_id) && seen.add(p.food_item_id)).slice(-12).reverse()
  }, [planned.data])

  return (
    <div>
      <PageHeader back eyebrow="Last 30 days" title="History" />
      <Section title="Recently eaten" className="mt-0">
        {diary.isPending ? <GhostRegion label="Loading history"><ListRowsGhost rows={3} /></GhostRegion> : (diary.data ?? []).length === 0 ? <p className="text-sm text-muted">Nothing logged in the last 30 days.</p> : (
          <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
            {diary.data!.slice(0, 15).map((e) => (
              <li key={e.id} className="flex justify-between gap-3 py-2.5 text-sm">
                <span className="truncate font-semibold">{e.name}</span>
                <span className="shrink-0 text-muted">{dayLabel(e.local_date, today)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Favourites">
        {(favs.data ?? []).length === 0 ? <p className="text-sm text-muted">Tap the heart on any recipe to save it here.</p> : (
          <ul className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {favs.data!.map((id) => byId.get(id)).filter(Boolean).map((f) => (
              <li key={f!.id} className="w-28 shrink-0">
                <Link to={`/recipes/${f!.slug}`} className="press block">
                  <FoodImage path={f!.image_path} name={f!.name} shape="circle" className="h-28 w-28" width={240} />
                  <p className="mt-2 text-sm font-semibold leading-tight">{f!.name}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Recently used recipes">
        {recentRecipes.length === 0 ? <p className="text-sm text-muted">Recipes you cook will appear here.</p> : (
          <ul className="flex flex-wrap gap-2">{recentRecipes.map((id) => <li key={id}><Link to={`/recipes/${byId.get(id)!.slug}`} className="inline-block rounded-full bg-elevated px-3 py-1.5 text-sm font-medium ring-1 ring-inset ring-line">{byId.get(id)!.name}</Link></li>)}</ul>
        )}
      </Section>
      <Section title="Previously planned">
        {generated.length === 0 ? <p className="text-sm text-muted">No past plans yet.</p> : (
          <ul className="flex flex-wrap gap-2">{generated.map((p) => <li key={p.id}><Link to={`/meal/${p.id}`} className="inline-block rounded-full bg-surface px-3 py-1.5 text-sm">{p.name}</Link></li>)}</ul>
        )}
      </Section>
      <Section title="Leftovers">
        <p className="mb-3 text-sm text-ink-2">Got food left from a previous meal? Log it in your kitchen and DISH will suggest how to use it.</p>
        <ButtonLink to="/kitchen" variant="secondary" icon="pot">Manage leftovers</ButtonLink>
      </Section>
    </div>
  )
}
