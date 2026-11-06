import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { SLOT_LABEL } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { useFavourites, useToggleFavourite } from '@/data/favourites'
import { usePreferences } from '@/data/profile'
import { useCatalogue } from '@/data/catalogue'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/Layout'
import { SearchInput } from '@/components/ui/Field'
import { FoodImage } from '@/components/ui/FoodImage'
import { Icon, type IconName } from '@/components/ui/Icon'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { RecipePreviewWorkspace } from '@/components/canvas/RecipePreviewWorkspace'
import { CATEGORIES, type Category } from '@/components/canvas/categories'
import { useAddToToday } from '@/components/canvas/useAddToToday'
import { slotFor, useRankedMeals } from '@/components/canvas/useRankedMeals'

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

/**
 * Discover: an endless-feeling feed of food inspiration. Photo first, minimal
 * text, personalised by the shared planner (allergies, diet and exclusions are
 * hard filters). Loads incrementally as you scroll; each meal appears once per
 * session. Detail lives in the meal preview, not in the feed.
 */
export function Discover() {
  const [category, setCategory] = useState<Category>('all')
  const [q, setQ] = useState('')
  const [onlyFavs, setOnlyFavs] = useState(false)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [shown, setShown] = useState(PAGE)
  const [preview, setPreview] = useState<FoodItem | null>(null)
  const cat = useCatalogue()
  const ranked = useRankedMeals(category)
  const favs = useFavourites()
  const sentinel = useRef<HTMLDivElement>(null)

  const feed = useMemo(() => {
    const t = q.trim().toLowerCase()
    let list = ranked.items
    if (t) list = list.filter((f) => `${f.name} ${f.cuisine} ${f.description}`.toLowerCase().includes(t))
    if (onlyFavs) list = list.filter((f) => favs.data?.includes(f.id))
    // keep the best matches near the top, but vary the order between sessions
    const head = list.slice(0, 6)
    const unique = new Map<string, FoodItem>()
    for (const f of [...shuffled(head, seed), ...shuffled(list.slice(6), seed)]) unique.set(f.id, f)
    return [...unique.values()]
  }, [ranked.items, q, onlyFavs, favs.data, seed])

  // reset paging when the feed's inputs change
  const key = `${category}|${q}|${onlyFavs}|${seed}`
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
      <PageHeader title="Discover" large />
      <nav aria-label="More ideas" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Shortcut to="/surprise" icon="sparkle" label="Surprise me" />
        <Shortcut to="/kitchen" icon="fridge" label="My kitchen" />
        <Shortcut to="/budget" icon="wallet" label="Budget" />
        <Shortcut to="/history" icon="history" label="History" />
      </nav>

      <div className="sticky top-0 z-20 -mx-4 mt-4 bg-bg/95 px-4 pb-3 pt-2 backdrop-blur" style={{ top: 'var(--safe-top)' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Search meals" label="Search meals" />
        <div className="mt-3 flex items-center gap-1.5">
          <div role="tablist" aria-label="Meal category" className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={category === c.id} onClick={() => setCategory(c.id)} className={cn('press h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors', category === c.id ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent-border' : 'bg-elevated text-ink-2 hover:text-ink')}>
                {c.label}
              </button>
            ))}
          </div>
          <button type="button" aria-pressed={onlyFavs} aria-label="Favourites only" title="Favourites only" onClick={() => setOnlyFavs(!onlyFavs)} className={cn('press flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors', onlyFavs ? 'bg-accent text-accent-ink' : 'bg-elevated text-ink-2')}>
            <Icon name="heart" size={17} filled={onlyFavs} />
          </button>
        </div>
      </div>

      <div className="mt-3">
        {cat.isPending || ranked.pending ? (
          <div className="grid gap-6 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[4/3] rounded-[28px]" />)}</div>
        ) : cat.isError && !cat.data ? (
          <ErrorState message={friendlyError(cat.error)} onRetry={() => cat.refetch()} />
        ) : feed.length === 0 ? (
          <EmptyState title={onlyFavs ? 'No favourites here yet' : 'Nothing matches'} message={onlyFavs ? 'Tap the heart on any meal to save it.' : q ? 'Try another word.' : 'Try another category.'} />
        ) : (
          <>
            <ul className="grid gap-x-5 gap-y-7 sm:grid-cols-2" aria-label="Meal ideas">
              {visible.map((f, i) => (
                <FeedItem key={f.id} index={i % PAGE} food={f} category={category} favourite={!!favs.data?.includes(f.id)} onOpen={() => setPreview(f)} />
              ))}
            </ul>
            <div ref={sentinel} aria-hidden="true" className="h-4" />
            {done ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted">That's every idea that fits you right now.</p>
                <button type="button" onClick={() => { setSeed((s) => s + 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="press mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-elevated px-4 text-sm font-semibold ring-1 ring-inset ring-line">
                  <Icon name="refresh" size={16} /> Shuffle
                </button>
              </div>
            ) : (
              <div className="grid gap-6 pt-2 sm:grid-cols-2" aria-hidden="true">
                <Skeleton className="aspect-[4/3] rounded-[28px]" />
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
  const toast = useToast()
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
        <button
          type="button"
          aria-pressed={favourite}
          aria-label={favourite ? `Remove ${f.name} from favourites` : `Save ${f.name} to favourites`}
          onClick={() => toggle.mutate({ foodItemId: f.id, on: !favourite }, { onError: (e) => toast.error(friendlyError(e)) })}
          className={cn('press absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-glass ring-1 ring-inset ring-[var(--c-glass-line)] backdrop-blur-md', favourite ? 'text-accent-strong' : 'text-ink')}
        >
          <Icon name="heart" size={18} filled={favourite} />
        </button>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <h3 className="text-title-3 leading-snug">{f.name}</h3>
          <p className="num mt-0.5 text-footnote text-muted">
            {mins != null ? `${mins} min` : 'Ready to buy'} · {SLOT_LABEL[slot]}
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

function Shortcut({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <Link to={to} className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-elevated px-4 text-sm font-semibold ring-1 ring-inset ring-line">
      <Icon name={icon} size={16} /> {label}
    </Link>
  )
}
