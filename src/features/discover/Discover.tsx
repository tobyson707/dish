import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { SLOT_LABEL } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { useFavourites, useToggleFavourite } from '@/data/favourites'
import { usePreferences } from '@/data/profile'
import { searchText, toCatalogueMeal, useCatalogue } from '@/data/catalogue'
import { checkAllergy } from '@domain/allergens.ts'
import { isIncomplete } from '@/features/recipes/RecordStatus'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/Layout'
import { SearchInput } from '@/components/ui/Field'
import { FoodImage } from '@/components/ui/FoodImage'
import { Icon } from '@/components/ui/Icon'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { RecipePreviewWorkspace } from '@/components/canvas/RecipePreviewWorkspace'
import { CATEGORIES, type Category } from '@/components/canvas/categories'
import { useAddToToday } from '@/components/canvas/useAddToToday'
import { slotFor, useRankedMeals } from '@/components/canvas/useRankedMeals'
import { SaveToggle } from '@/components/ui/ActionButton'
import { CommunityPlans } from '@/features/plans/CommunityPage'
import { MealFeedGhost, REVEAL } from '@/components/ui/Ghost'
import { SavedMeals } from '@/features/saved/SavedPage'
import { enabled } from '@/lib/v1'

const PAGE = 8

/** Deterministic shuffle so a session's order is stable but not alphabetical. */
function shuffled<T extends { id: string }>(items: T[], seed: number): T[] {
  const score = (id: string) => {
    let h = seed >>> 0
    for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0
    return h
  }
  return [...items].sort((a, b) => score(a.id) - score(b.id))
}

type Tab = 'foryou' | 'recipes' | 'saved' | 'plans'
// v1: browse and search recipes, and your saved ones. For You (a ranked feed) and community
// plans stay built but hidden; Home carries today's suggestions.
const TABS: { id: Tab; label: string }[] = [
  ...(enabled('community') ? [{ id: 'foryou' as Tab, label: 'For You' }] : []),
  { id: 'recipes', label: 'Recipes' },
  { id: 'saved', label: 'Saved' },
  ...(enabled('community') ? [{ id: 'plans' as Tab, label: 'Meal plans' }] : []),
]
const DEFAULT_TAB: Tab = enabled('community') ? 'foryou' : 'recipes'

/**
 * Discover: For You (food picked for you), Recipes (every recipe that fits you, A to Z),
 * Saved (meals you hearted) and Meal plans (plans people published, kept secondary).
 */
export function Discover() {
  const [params, setParams] = useSearchParams()
  const t = params.get('tab')
  const tab: Tab = TABS.find((x) => x.id === t)?.id ?? DEFAULT_TAB
  const favCount = useFavourites().data?.length
  return (
    <div>
      <PageHeader title="Discover" large />
      <div role="tablist" aria-label="Discover" style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }} className="mb-4 grid gap-1 rounded-full bg-elevated p-1 ring-1 ring-inset ring-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams((p) => (t.id === DEFAULT_TAB ? p.delete('tab') : p.set('tab', t.id), p), { replace: true })}
            className={cn('press h-10 rounded-full text-sm font-bold', tab === t.id ? 'bg-ink text-on-ink shadow-[0_6px_16px_-10px_var(--c-shadow)]' : 'text-ink-2 hover:text-ink')}
          >
            {t.label}
            {t.id === 'saved' && favCount != null && <span className={cn('num ml-1', tab === t.id ? 'opacity-70' : 'text-muted')}>{favCount}</span>}
          </button>
        ))}
      </div>
      <div key={tab} className="animate-[fade_var(--dur-standard)_var(--ease-enter)_both]">
        {tab === 'plans' ? <CommunityPlans /> : tab === 'saved' ? <SavedMeals /> : <FoodFeed mode={tab} />}
      </div>
    </div>
  )
}

/**
 * The food feeds: an endless-feeling feed of food inspiration. Photo first, minimal
 * text, personalised by the shared planner (allergies, diet and exclusions are
 * hard filters). Loads incrementally as you scroll; each meal appears once per
 * session. Detail lives in the meal preview, not in the feed.
 */
function FoodFeed({ mode }: { mode: 'foryou' | 'recipes' }) {
  const [category, setCategory] = useState<Category>('all')
  const [q, setQ] = useState('')
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [shown, setShown] = useState(PAGE)
  const [preview, setPreview] = useState<FoodItem | null>(null)
  const cat = useCatalogue()
  const ranked = useRankedMeals(category)
  const favs = useFavourites()
  const prefs = usePreferences()
  const sentinel = useRef<HTMLDivElement>(null)

  const feed = useMemo(() => {
    const t = q.trim().toLowerCase()
    // Recipes: only meals with a recorded method, A to Z; For You: ranked for this person
    let list = mode === 'recipes' ? ranked.items.filter((f) => f.can_cook && !isIncomplete(f)).sort((a, b) => a.name.localeCompare(b.name)) : ranked.items
    if (t) {
      // search reaches the whole catalogue (any country, and dishes whose recipe isn't recorded yet),
      // but never past a known allergy
      const ids = new Set(list.map((f) => f.id))
      const extra = (cat.data ?? []).filter((f) => !ids.has(f.id) && (!prefs.data || checkAllergy(toCatalogueMeal(f), prefs.data).status !== 'conflict'))
      list = [...list, ...extra].filter((f) => searchText(f).includes(t))
    }
    if (mode === 'recipes') return list
    // keep the best matches near the top, but vary the order between sessions
    const head = list.slice(0, 6)
    const unique = new Map<string, FoodItem>()
    for (const f of [...shuffled(head, seed), ...shuffled(list.slice(6), seed)]) unique.set(f.id, f)
    return [...unique.values()]
  }, [ranked.items, q, seed, cat.data, prefs.data, mode])

  // reset paging when the feed's inputs change
  const key = `${category}|${q}|${seed}`
  const [pagedFor, setPagedFor] = useState(key)
  if (pagedFor !== key) {
    setPagedFor(key)
    setShown(PAGE)
  }

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE)
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [feed.length])

  const visible = feed.slice(0, shown)
  const done = shown >= feed.length

  return (
    <div>
      {mode === 'foryou' && (enabled('recipeSuggestions') || enabled('surprise')) && <CreateLink />}
      <div className="sticky top-0 z-20 -mx-4 bg-bg/95 px-4 pb-3 pt-2 backdrop-blur" style={{ top: 'var(--safe-top)' }}>
        <SearchInput value={q} onChange={setQ} placeholder={mode === 'recipes' ? 'Search recipes' : 'Search meals'} label={mode === 'recipes' ? 'Search recipes' : 'Search meals'} />
        <div className="mt-3 flex items-center gap-1.5">
          <div role="tablist" aria-label="Meal category" className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={category === c.id} onClick={() => setCategory(c.id)} className={cn('press h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors', category === c.id ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent-border' : 'bg-elevated text-ink-2 hover:text-ink')}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3">
        {cat.isPending || ranked.pending ? (
          <MealFeedGhost label={mode === 'recipes' ? 'Loading recipes' : 'Loading meal ideas'} />
        ) : cat.isError && !cat.data ? (
          <ErrorState message={friendlyError(cat.error)} onRetry={() => cat.refetch()} />
        ) : feed.length === 0 ? (
           <EmptyState title="Nothing matches" message={q ? 'Try another word.' : 'Try another category.'} />
        ) : (
          <>
            <ul className={cn('grid gap-x-5 gap-y-7 sm:grid-cols-2', REVEAL)} aria-label="Meal ideas">
              {visible.map((f, i) => (
                <FeedItem key={f.id} index={i % PAGE} food={f} category={category} favourite={!!favs.data?.includes(f.id)} onOpen={() => setPreview(f)} />
              ))}
            </ul>
            <div ref={sentinel} aria-hidden="true" className="h-4" />
            {done ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted">{mode === 'recipes' ? 'That’s every recipe that fits you.' : 'That’s every idea that fits you right now.'}</p>
                {mode === 'foryou' && <button type="button" onClick={() => { setSeed((s) => s + 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="press mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-elevated px-4 text-sm font-semibold ring-1 ring-inset ring-line">
                  <Icon name="refresh" size={16} /> Shuffle
                </button>}
              </div>
            ) : (
              <div className="pt-7" aria-hidden="true">
                <MealFeedGhost count={2} label="Loading more" />
              </div>
            )}
          </>
        )}
      </div>
      <RecipePreviewWorkspace food={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

function FeedItem({ food: f, index, category, favourite, onOpen }: { food: FoodItem; index: number; category: Category; favourite: boolean; onOpen: () => void }) {
  const toggle = useToggleFavourite()
  const prefs = usePreferences()
  const { add, busy } = useAddToToday()
  const [added, setAdded] = useState(false)
  const mins = f.can_cook ? f.prep_minutes + f.cook_minutes : null
  const slot = category === 'all' ? slotFor(f, prefs.data?.meal_slots ?? ['breakfast', 'lunch', 'dinner']) : category
  return (
    <li className="enter-item" style={{ ['--i' as string]: index }}>
      <div className="relative">
        <button type="button" onClick={onOpen} className="press block w-full" aria-label={`Open ${f.name}`}>
          <FoodImage path={f.image_path} alt={f.image_alt} name={f.name} slug={f.slug} className="aspect-[4/3] w-full rounded-[28px]" width={720} />
        </button>
        <SaveToggle
          on={favourite}
          onToggle={(on) => toggle.mutateAsync({ foodItemId: f.id, on })}
          label={{ save: `Save ${f.name}`, remove: `Remove ${f.name} from saved` }}
          className="absolute right-3 top-3 bg-glass ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-md"
        />
      </div>
      <div className="mt-3 flex items-start gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <h3 className="text-title-3 leading-snug">{f.name}</h3>
          <p className="num mt-0.5 text-footnote text-muted">
            {isIncomplete(f) ? `${f.cuisine} · recipe not recorded yet` : <>{mins != null ? `${mins} min` : 'Ready to buy'} · {SLOT_LABEL[slot]}</>}
          </p>
        </button>
        <button
          type="button"
          disabled={busy || added}
          aria-label={added ? `${f.name} added` : `Add ${f.name} to today's ${SLOT_LABEL[slot].toLowerCase()}`}
          onClick={async () => {
            if (await add(f, slot)) setAdded(true)
          }}
          className={cn('press flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors', added ? 'pulse-once bg-accent text-accent-ink' : 'bg-ink text-on-ink')}
        >
          <span key={added ? 'done' : 'add'} className="icon-swap flex"><Icon name={added ? 'check' : 'plus'} size={18} /></span>
        </button>
      </div>
    </li>
  )
}

/** Two quiet ways to something new: a recipe made for your request, or a pick from the catalogue. */
function CreateLink() {
  const links = [
    { to: '/create', icon: 'wand' as const, label: 'Create a recipe', hint: 'From ingredients or a cuisine' },
    { to: '/surprise', icon: 'sparkle' as const, label: 'Surprise me', hint: 'A pick that fits you' },
  ]
  return (
    <nav aria-label="Something new" className="grid grid-cols-2 gap-2">
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="press flex items-center gap-3 rounded-lg bg-elevated px-3.5 py-3 ring-1 ring-inset ring-line hover:ring-accent-border">
          <Icon name={l.icon} size={18} className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{l.label}</span>
            <span className="block truncate text-micro text-muted">{l.hint}</span>
          </span>
        </Link>
      ))}
    </nav>
  )
}
