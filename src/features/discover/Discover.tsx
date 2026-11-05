import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { MEAL_SLOTS, SLOT_LABEL, type MealSlot } from '@domain/types.ts'
import { checkAllergy } from '@domain/allergens.ts'
import { fitsDiet } from '@domain/planner.ts'
import { useCatalogue, toCatalogueMeal, CUISINES } from '@/data/catalogue'
import { useFavourites } from '@/data/favourites'
import { usePreferences } from '@/data/profile'
import { useCurrency } from '@/hooks/useToday'
import { formatCostRange, formatKcal, formatMinutes } from '@/lib/format'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { PageHeader, Section } from '@/components/ui/Layout'
import { SearchInput, Select } from '@/components/ui/Field'
import { Chip } from '@/components/ui/Chip'
import { FoodImage, HeroFood } from '@/components/ui/FoodImage'
import { Icon, type IconName } from '@/components/ui/Icon'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { RecipePreviewWorkspace } from '@/components/canvas/RecipePreviewWorkspace'
import { slotForNow, useRankedMeals } from '@/components/canvas/useRankedMeals'
import type { FoodItem } from '@/types/db'

const TIME = [
  { value: '', label: 'Any time' },
  { value: '15', label: '15 min or less' },
  { value: '30', label: '30 min or less' },
  { value: '60', label: 'An hour or less' },
]

export function Discover() {
  const cat = useCatalogue()
  const favs = useFavourites()
  const prefs = usePreferences()
  const currency = useCurrency()
  const [q, setQ] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [slot, setSlot] = useState<MealSlot | ''>('')
  const [time, setTime] = useState('')
  const [suitable, setSuitable] = useState(true)
  const [onlyFavs, setOnlyFavs] = useState(false)

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (cat.data ?? []).filter((f) => {
      if (t && !`${f.name} ${f.description} ${f.cuisine}`.toLowerCase().includes(t)) return false
      if (cuisine && f.cuisine !== cuisine) return false
      if (slot && !f.meal_types.includes(slot)) return false
      if (time && f.prep_minutes + f.cook_minutes > Number(time)) return false
      if (onlyFavs && !favs.data?.includes(f.id)) return false
      if (suitable && prefs.data) {
        const m = toCatalogueMeal(f)
        if (!fitsDiet(m, prefs.data.diet_pattern)) return false
        if (checkAllergy(m, prefs.data).status === 'conflict') return false
      }
      return true
    })
  }, [cat.data, q, cuisine, slot, time, onlyFavs, favs.data, suitable, prefs.data])

  const featureSlot = slotForNow()
  const ranked = useRankedMeals(featureSlot)
  const feature = ranked.items[0] ?? null
  const [preview, setPreview] = useState<FoodItem | null>(null)

  return (
    <div>
      <div className="recede-target">
        <PageHeader eyebrow="Recipes & ideas" title="Discover" large />
        {feature ? <FeatureHero food={feature} slot={featureSlot} onOpen={() => setPreview(feature)} /> : ranked.pending ? <Skeleton className="mb-5 h-64 rounded-[32px]" /> : null}
        <div className="grid grid-cols-2 gap-3">
          <Tile to="/surprise" icon="sparkle" title="Surprise me" sub="A few ideas, right now" dark />
          <Tile to="/kitchen" icon="fridge" title="What's in my kitchen?" sub="Cook with what you have" />
          <Tile to="/budget" icon="wallet" title="Food budget" sub="Estimated vs actual" />
          <Tile to="/history" icon="history" title="History" sub="Eaten, favourites, leftovers" />
        </div>

        <Section title="Recipe library">
          <div className="flex flex-col gap-3">
            <SearchInput value={q} onChange={setQ} placeholder="Search recipes" label="Search recipes" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Select label="Cuisine" hint={undefined} value={cuisine} onChange={(e) => setCuisine(e.target.value)} options={[{ value: '', label: 'All cuisines' }, ...CUISINES.map((c) => ({ value: c, label: c }))]} />
              <Select
                label="Meal"
                value={slot}
                onChange={(e) => setSlot(e.target.value as MealSlot | '')}
                options={[
                  { value: '', label: 'Any meal' },
                  ...MEAL_SLOTS.map((s) => ({
                    value: s,
                    label: SLOT_LABEL[s],
                  })),
                ]}
              />
              <Select label="Time" value={time} onChange={(e) => setTime(e.target.value)} options={TIME} className="col-span-2 sm:col-span-1" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip selected={suitable} onClick={() => setSuitable(!suitable)}>
                Suits my diet & allergies
              </Chip>
              <Chip selected={onlyFavs} onClick={() => setOnlyFavs(!onlyFavs)}>
                Favourites
              </Chip>
            </div>
          </div>
          <div className="mt-5">
            {cat.isPending ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[3/4] rounded-lg" />
                ))}
              </div>
            ) : cat.isError && !cat.data ? (
              <ErrorState message={friendlyError(cat.error)} onRetry={() => cat.refetch()} />
            ) : list.length === 0 ? (
              <EmptyState title="No recipes match" message="Try fewer filters." />
            ) : (
              <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
                {list.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => setPreview(f)} className="press group block w-full text-left">
                      <div className="relative">
                        <FoodImage path={f.image_path} alt={f.image_alt} name={f.name} className="aspect-square w-full rounded-lg" width={400} />
                        {favs.data?.includes(f.id) && (
                          <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-elevated text-accent">
                            <Icon name="heart" size={16} filled />
                          </span>
                        )}
                      </div>
                      <p className="label-caps mt-2">{f.cuisine}</p>
                      <h3 className="mt-0.5 font-serif text-[1.1rem] leading-snug">{f.name}</h3>
                      <p className="num mt-1 text-[12px] text-muted">
                        {f.can_cook ? formatMinutes(f.prep_minutes + f.cook_minutes) : 'Buy'} · {f.calories != null ? `≈ ${formatKcal(f.calories)}` : '—'}
                      </p>
                      <p className="num text-[12px] text-muted">{formatCostRange(f.est_cost_min, f.est_cost_max, f.cost_currency || currency)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      </div>
      <RecipePreviewWorkspace food={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

/** Editorial feature: today's top match for the current meal time, from the real catalogue. */
function FeatureHero({ food, slot, onOpen }: { food: FoodItem; slot: MealSlot; onOpen: () => void }) {
  const mins = food.can_cook ? food.prep_minutes + food.cook_minutes : null
  return (
    <section
      aria-label="Featured for you"
      className="relative mb-5 min-h-[260px] overflow-hidden rounded-[32px] p-6 sm:p-8"
      style={{
        background: 'radial-gradient(120% 100% at 85% 20%, var(--g-peach), var(--g-cream) 55%, var(--c-surface))',
      }}
    >
      <div className="relative z-10 max-w-[58%] sm:max-w-[55%]">
        <p className="label-caps">For your {SLOT_LABEL[slot].toLowerCase()}</p>
        <h2 className="mt-2 font-serif text-[2rem] leading-[1.02] sm:text-[2.6rem]">{food.name}</h2>
        <p className="num mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-1">
            <Icon name="clock" size={14} /> {mins != null ? `${mins} min` : 'Buy'}
          </span>
          {food.calories != null && (
            <span className="inline-flex items-center gap-1">
              <Icon name="flame" size={14} /> ≈ {food.calories} kcal
            </span>
          )}
        </p>
        <button type="button" onClick={onOpen} className="press mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-on-ink">
          Take a look <Icon name="arrow" size={16} />
        </button>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -right-12 top-1/2 aspect-square w-[60%] max-w-[320px] -translate-y-1/2 sm:right-6">
        <HeroFood path={food.image_path} name={food.name} slug={food.slug} className="h-full w-full" />
      </div>
    </section>
  )
}

function Tile({ to, icon, title, sub, dark }: { to: string; icon: IconName; title: string; sub: string; dark?: boolean }) {
  return (
    <Link to={to} className={cn('press flex min-h-32 flex-col justify-between rounded-lg p-4', dark ? 'bg-ink text-on-ink' : 'bg-elevated')}>
      <Icon name={icon} size={24} className={dark ? 'text-accent' : undefined} />
      <span>
        <span className="block font-bold leading-tight">{title}</span>
        <span className={cn('mt-0.5 block text-[12px]', dark ? 'opacity-70' : 'text-muted')}>{sub}</span>
      </span>
    </Link>
  )
}
