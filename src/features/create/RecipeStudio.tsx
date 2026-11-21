import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ALLERGEN_LABEL, DIET_LABEL, DIET_PATTERNS, MEAL_SLOTS, SLOT_LABEL, type Allergen, type DietPattern, type MealSlot } from '@domain/types.ts'
import { useAIStatus } from '@/data/ai'
import { useAiRecipes, useFoods, useGenerateRecipes, useRecipeGeneration, useRecipeGenerations, type RecipeGeneration, type RecipeMode, type RecipeRequest } from '@/data/aiRecipes'
import { CUISINES } from '@/data/catalogue'
import { useKitchen } from '@/data/kitchen'
import { safetyScreen } from '@domain/kitchen.ts'
import { usePreferences } from '@/data/profile'
import { useUserId } from '@/features/auth/AuthProvider'
import { useToday } from '@/hooks/useToday'
import { COUNTRIES } from '@/lib/geo'
import { friendlyError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { play } from '@/lib/uiSound'
import { Button } from '@/components/ui/Button'
import { PageHeader, Section } from '@/components/ui/Layout'
import { Select, TextField } from '@/components/ui/Field'
import { Segmented, Stepper, TagInput } from '@/components/ui/Inputs'
import { Icon, type IconName } from '@/components/ui/Icon'
import { EmptyState, Notice } from '@/components/ui/States'
import { Ghost, GhostRegion, GhostText, REVEAL } from '@/components/ui/Ghost'
import { GeneratedRecipeCard } from './GeneratedRecipeCard'

const MODES: { id: Exclude<RecipeMode, 'alternatives' | 'variation'>; label: string; icon: IconName }[] = [
  { id: 'generate', label: 'Create', icon: 'wand' },
  { id: 'use_ingredients', label: 'My kitchen', icon: 'fridge' },
  { id: 'cuisine', label: 'Cuisine', icon: 'globe' },
  { id: 'surprise', label: 'Surprise', icon: 'sparkle' },
]
const TITLE: Record<RecipeMode, string> = {
  generate: 'Create a recipe',
  use_ingredients: 'Cook from your kitchen',
  cuisine: 'Explore a cuisine',
  surprise: 'Surprise me',
  alternatives: 'Find alternatives',
  variation: 'Make a variation',
}
const MODE_LABEL: Record<RecipeMode, string> = { generate: 'Created', use_ingredients: 'From your kitchen', cuisine: 'Cuisine', surprise: 'Surprise', alternatives: 'Alternatives', variation: 'Variation' }
const VARIATIONS = ['Vegetarian', 'Vegan', 'Quicker', 'Spicier', 'Milder', 'Lighter', 'Budget-friendly', 'Different cuisine']
const TIMES = [0, 15, 30, 45, 60, 90]
const isMode = (m: string | null): m is RecipeMode => !!m && ['generate', 'use_ingredients', 'cuisine', 'surprise', 'alternatives', 'variation'].includes(m)

/**
 * AI recipe studio: structured requests in, structured recipes out (no chat). Each result
 * is checked by DISH on the server before it is shown, and is stored as the person's own
 * private recipe only once they save it, plan it or add it to a list.
 */
export function RecipeStudio() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const uid = useUserId()
  const today = useToday()
  const mode: RecipeMode = isMode(params.get('mode')) ? (params.get('mode') as RecipeMode) : 'generate'
  const parentId = params.get('parent')
  const shownId = params.get('g')
  const status = useAIStatus()
  const prefs = usePreferences()
  const kitchen = useKitchen()
  const foods = useFoods()
  const generate = useGenerateRecipes()
  const shown = useRecipeGeneration(shownId)
  const parent = useMemo(() => (parentId ? foods.data?.find((f) => f.id === parentId) ?? null : null), [foods.data, parentId])

  const [ingredients, setIngredients] = useState<string[]>([])
  const [cuisine, setCuisine] = useState(params.get('cuisine') ?? '')
  const [country, setCountry] = useState('')
  const [category, setCategory] = useState<MealSlot | null>((params.get('category') as MealSlot) || null)
  const [time, setTime] = useState(0)
  const [difficulty, setDifficulty] = useState<'any' | 'easy' | 'medium' | 'hard'>('any')
  const [servings, setServings] = useState(2)
  const [budget, setBudget] = useState<'any' | 'thrifty' | 'moderate'>('any')
  const [diet, setDiet] = useState<DietPattern>('none')
  const [avoid, setAvoid] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [count, setCount] = useState(mode === 'alternatives' ? 3 : 1)
  const [variation, setVariation] = useState(params.get('variation') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  const reveal = () => requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))

  const configured = !!status.data?.recipes_configured
  // the same food-safety screen the server applies: what is offered, and what is left out
  const screened = useMemo(() => safetyScreen((kitchen.data ?? []).filter((k) => !k.used_at).map((k) => ({ ...k, quantity: k.quantity == null ? null : Number(k.quantity) })), today), [kitchen.data, today])
  const kitchenItems = screened.usable
  const leftOut = screened.notes.filter((n) => n.level === 'exclude')
  const profileAllergies = [...(prefs.data?.allergies ?? []).map((a) => ALLERGEN_LABEL[a as Allergen] ?? a), ...(prefs.data?.custom_allergies ?? [])]
  const profileDiet = prefs.data?.diet_pattern ?? 'none'
  const needsCuisine = mode === 'cuisine' && !cuisine && !country
  const needsParent = (mode === 'alternatives' || mode === 'variation') && !parent
  const needsVariation = mode === 'variation' && !variation.trim()
  const needsIngredients = mode === 'generate' && ingredients.length === 0 && !cuisine && !category && !notes.trim()
  const disabled = !configured || needsCuisine || needsParent || needsVariation || needsIngredients || (mode === 'use_ingredients' && kitchenItems.length === 0 && ingredients.length === 0)

  const setMode = (m: RecipeMode) => setParams((p) => { p.set('mode', m); p.delete('g'); return p }, { replace: true })
  const showGeneration = (id: string | null) => setParams((p) => { if (id) p.set('g', id); else p.delete('g'); return p }, { replace: true })

  async function run(fresh = false) {
    setError(null)
    const input: RecipeRequest = {
      ingredients: mode === 'surprise' ? [] : ingredients,
      cuisine: cuisine || null,
      country: country || null,
      category,
      diet: diet === 'none' ? null : diet,
      avoid,
      max_minutes: time || null,
      difficulty: difficulty === 'any' ? null : difficulty,
      servings,
      budget: budget === 'any' ? null : budget,
      use_kitchen: mode === 'use_ingredients',
      notes: notes.trim() || null,
      parent_id: parent?.id ?? null,
      variation: mode === 'variation' ? variation.trim() : null,
      count,
    }
    try {
      const r = await generate.mutateAsync({ mode, input, fresh: fresh || mode === 'surprise', today })
      setCached(r.cached)
      showGeneration(r.generation.id)
      play(r.generation.recipes.length ? 'success' : 'tap')
      reveal()
    } catch (e) {
      setError(friendlyError(e))
      reveal()
    }
  }

  const current = generate.isPending ? null : shownId ? shown.data ?? null : null

  return (
    <div>
      <PageHeader back eyebrow="Discover" title={mode === 'alternatives' && parent ? `Instead of ${parent.name}` : mode === 'variation' && parent ? `A twist on ${parent.name}` : TITLE[mode]} />

      {status.isPending ? (
        <GhostRegion label="Checking AI"><Ghost className="h-12 rounded-md" /></GhostRegion>
      ) : !configured ? (
        <Notice tone="warning" icon="sparkle">
          <p className="font-semibold">AI recipes aren't available on this DISH server yet.</p>
          <p className="mt-1">Whoever runs it needs to add an AI provider key on the server. Everything else in DISH works without it, including every curated recipe.</p>
        </Notice>
      ) : status.data?.recipes_provider === 'fixture' ? (
        <Notice icon="info">Local test mode: recipes come from DISH's built-in test provider, not a real AI.</Notice>
      ) : null}

      {mode !== 'alternatives' && mode !== 'variation' && (
        <div role="tablist" aria-label="How to start" className="mt-4 grid grid-cols-4 gap-1 rounded-full bg-elevated p-1 ring-1 ring-inset ring-line">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)} className={cn('press flex h-10 items-center justify-center gap-1.5 rounded-full text-sm font-bold', mode === m.id ? 'bg-ink text-on-ink' : 'text-ink-2 hover:text-ink')}>
              <Icon name={m.icon} size={15} className="hidden sm:block" /> {m.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="mt-5 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!disabled && !generate.isPending) void run()
        }}
      >
        {(mode === 'alternatives' || mode === 'variation') && (
          parent ? (
            <p className="text-sm text-ink-2">{mode === 'alternatives' ? 'Different dishes for the same kind of meal, checked against your profile.' : 'The same idea, changed the way you choose.'} Starting from <Link to={`/recipes/${parent.slug}`} className="font-semibold text-ink underline">{parent.name}</Link>.</p>
          ) : foods.isPending ? <GhostText width="70%" /> : <Notice tone="warning">That recipe isn't available. Open a recipe and choose "Find alternatives" or "Make a variation" from there.</Notice>
        )}

        {mode === 'variation' && (
          <div>
            <p className="text-sm font-semibold">Change it to be</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VARIATIONS.map((v) => <Chip key={v} on={variation === v} onClick={() => setVariation(variation === v ? '' : v)}>{v}</Chip>)}
            </div>
            <TextField className="mt-3" label="Or describe it" placeholder="e.g. with rice instead of bread" value={VARIATIONS.includes(variation) ? '' : variation} onChange={(e) => setVariation(e.target.value.slice(0, 60))} />
          </div>
        )}

        {mode === 'use_ingredients' && (
          <div className="rounded-lg bg-elevated p-4">
            <p className="text-sm font-semibold">From your kitchen</p>
            {kitchen.isPending ? <GhostText width="80%" className="mt-2" /> : kitchenItems.length ? (
              <>
                <p className="mt-1 text-sm text-ink-2">{kitchenItems.slice(0, 18).map((k) => k.name).join(', ')}{kitchenItems.length > 18 ? ` and ${kitchenItems.length - 18} more` : ''}</p>
                {leftOut.length > 0 && <p className="mt-2 text-footnote text-ink-2">Left out for safety: {leftOut.map((n) => n.name).join(', ')}.</p>}
                <p className="mt-2 text-micro text-muted">Out-of-date items and old leftovers are never used. DISH lists what you'd still need to buy and never assumes you have anything else.</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-2">Your kitchen is empty. <Link to="/kitchen" className="font-semibold text-ink underline">Add what you have</Link>, or type a few ingredients below.</p>
            )}
          </div>
        )}

        {(mode === 'generate' || mode === 'use_ingredients') && (
          <TagInput label={mode === 'use_ingredients' ? 'Also use' : 'Ingredients'} hint={mode === 'generate' ? 'Add what you want to cook with, or leave it empty and choose a cuisine or meal.' : undefined} placeholder="e.g. chicken, spinach" value={ingredients} onChange={setIngredients} max={20} />
        )}

        {(mode === 'cuisine' || mode === 'generate') && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Cuisine" value={cuisine} onChange={(e) => setCuisine(e.target.value)} options={[{ value: '', label: mode === 'cuisine' ? 'Choose' : 'Any' }, ...CUISINES.filter((c) => c !== 'International').map((c) => ({ value: c, label: c }))]} />
            <Select label="Country" value={country} onChange={(e) => setCountry(e.target.value)} options={[{ value: '', label: 'Any' }, ...COUNTRIES.map((c) => ({ value: c.c2, label: c.name }))]} />
          </div>
        )}

        {mode !== 'variation' && (
          <div>
            <p className="text-sm font-semibold">Meal</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip on={category === null} onClick={() => setCategory(null)}>Any</Chip>
              {MEAL_SLOTS.map((s) => <Chip key={s} on={category === s} onClick={() => setCategory(s)}>{s === 'drink' ? 'Drinks' : s === 'snack' ? 'Snacks' : SLOT_LABEL[s]}</Chip>)}
            </div>
          </div>
        )}

        <details className="group rounded-lg bg-elevated" open={mode === 'generate'}>
          <summary className="press flex h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold">
            Time, servings and more <Icon name="down" size={16} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <Segmented label="Ready in" value={time} onChange={setTime} options={TIMES.map((t) => ({ value: t, label: t ? `${t}m` : 'Any' }))} />
            <Segmented label="Difficulty" value={difficulty} onChange={setDifficulty} options={[{ value: 'any', label: 'Any' }, { value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
            <Stepper label="Servings" value={servings} onChange={setServings} min={1} max={12} step={1} />
            <div>
              <Segmented label="Budget" value={budget} onChange={setBudget} options={[{ value: 'any', label: 'Any' }, { value: 'thrifty', label: 'Thrifty' }, { value: 'moderate', label: 'Moderate' }]} />
              <p className="mt-1 text-micro text-muted">A guide for the AI only. DISH has no reliable prices for generated recipes, so no cost is shown.</p>
            </div>
            <Select label="Diet" value={diet} onChange={(e) => setDiet(e.target.value as DietPattern)} hint={profileDiet !== 'none' ? `Your profile's diet (${DIET_LABEL[profileDiet]}) always applies.` : undefined} options={DIET_PATTERNS.map((d) => ({ value: d, label: d === 'none' ? (profileDiet === 'none' ? 'No restriction' : 'Just my profile diet') : DIET_LABEL[d] }))} />
            <TagInput label="Leave out" placeholder="e.g. mushrooms" value={avoid} onChange={setAvoid} max={15} tone="danger" />
            {mode !== 'alternatives' && mode !== 'variation' && <Segmented label="How many" value={count} onChange={setCount} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />}
            <TextField label="Anything else" placeholder="e.g. for a picnic, kid friendly" value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 200))} />
          </div>
        </details>

        <p className="flex items-start gap-2 text-footnote text-muted">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
          <span>{profileAllergies.length ? <>Always left out, from your profile: <strong className="text-ink">{profileAllergies.join(', ')}</strong>. </> : 'No allergies on your profile. '}<Link to="/profile/preferences" className="underline">Edit</Link></span>
        </p>

        <Button type="submit" size="lg" icon="sparkle" block disabled={disabled} loading={generate.isPending}>
          {generate.isPending ? 'Writing your recipe' : mode === 'surprise' ? 'Surprise me' : mode === 'alternatives' ? 'Find alternatives' : mode === 'variation' ? 'Make the variation' : count > 1 ? 'Generate recipes' : 'Generate a recipe'}
        </Button>
        {needsIngredients && mode === 'generate' && <p className="-mt-3 text-center text-micro text-muted">Add an ingredient, or choose a cuisine or meal.</p>}
      </form>

      <div ref={resultsRef} aria-live="polite" className="mt-6 scroll-mt-4">
        {generate.isPending ? (
          <GhostRegion label="Writing and checking your recipe" className="flex flex-col gap-3">
            <p className="text-sm text-muted">Writing your recipe, then checking it against your allergies, diet and safe cooking. This can take up to a minute.</p>
            {Array.from({ length: Math.min(count, 2) }, (_, i) => (
              <div key={i} className="rounded-xl bg-elevated p-5">
                <Ghost className="h-6 w-28 rounded-full" />
                <GhostText size="title3" width="70%" className="mt-3" />
                <GhostText width="50%" className="mt-2" />
                <GhostText width="90%" className="mt-4" />
                <div className="mt-4 flex gap-2"><Ghost className="h-9 w-28 rounded-full" /><Ghost className="h-9 w-28 rounded-full" /></div>
              </div>
            ))}
          </GhostRegion>
        ) : error ? (
          <Notice tone="error">
            <p>{error}</p>
            <button type="button" className="mt-2 font-semibold underline" onClick={() => void run()}>Try again</button>
          </Notice>
        ) : shownId && shown.isPending ? (
          <GhostRegion label="Loading recipes"><Ghost className="h-40 rounded-xl" /></GhostRegion>
        ) : current ? (
          <Results generation={current} cached={cached} onFresh={() => void run(true)} onVariation={(id) => nav(`/create?mode=variation&parent=${id}`)} />
        ) : null}
      </div>

      <History uid={uid} onOpen={(g) => { setCached(false); showGeneration(g.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
    </div>
  )
}

function Results({ generation: g, cached, onFresh, onVariation }: { generation: RecipeGeneration; cached: boolean; onFresh: () => void; onVariation: (id: string) => void }) {
  const rejected = g.validation?.rejected ?? []
  return (
    <section aria-label="Your recipes" className={REVEAL}>
      {cached && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-4 py-3 text-sm">
          <span className="text-ink-2">You asked for this before, so here it is again.</span>
          <button type="button" onClick={onFresh} className="font-semibold underline">Generate new ones</button>
        </div>
      )}
      {(g.validation?.kitchen_notes ?? []).length > 0 && <div className="mb-3"><Notice tone="warning"><ul className="flex flex-col gap-1">{g.validation.kitchen_notes!.map((n) => <li key={n}>{n}</li>)}</ul></Notice></div>}
      {g.recipes.length === 0 ? (
        <EmptyState
          icon="shield"
          title="No recipe passed DISH's checks"
          message={[g.validation?.unable_reason, rejected.length ? `DISH turned down ${rejected.length === 1 ? 'the recipe' : `${rejected.length} recipes`} because ${[...new Set(rejected.flatMap((r) => r.reasons))].slice(0, 3).join('; ')}.` : null, 'Try changing the request.'].filter(Boolean).join(' ')}
          action={<Button size="sm" variant="secondary" icon="refresh" onClick={onFresh}>Try again</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {g.recipes.map((_r, i) => <SavedAware key={`${g.id}-${i}`} generation={g} index={i} defaultOpen={g.recipes.length === 1} onVariation={onVariation} />)}
          {rejected.length > 0 && <p className="text-footnote text-muted">DISH left out {rejected.length === 1 ? 'one recipe' : `${rejected.length} recipes`} that didn't pass its checks ({[...new Set(rejected.flatMap((r) => r.reasons))].slice(0, 2).join('; ')}).</p>}
          <p className="text-micro text-muted">Recipes are written by AI and checked automatically by DISH for your allergies, diet and safe cooking. They aren't checked by a person, and nothing is stored until you save, plan or shop for one.</p>
        </div>
      )}
    </section>
  )
}

/** A card that knows whether its recipe is already stored (by fingerprint among the person's recipes). */
function SavedAware({ generation: g, index, defaultOpen, onVariation }: { generation: RecipeGeneration; index: number; defaultOpen: boolean; onVariation: (id: string) => void }) {
  const mine = useAiRecipes()
  const r = g.recipes[index]!
  const saved = mine.data?.find((f) => f.ai_fingerprint === r.fingerprint)?.id ?? null
  if (mine.isLoading) return <Ghost className="h-40 rounded-xl" />
  return <GeneratedRecipeCard recipe={r} generationId={g.id} index={index} savedId={saved} defaultOpen={defaultOpen} onVariation={onVariation} />
}

function History({ uid, onOpen }: { uid: string; onOpen: (g: RecipeGeneration) => void }) {
  const gens = useRecipeGenerations()
  const mine = useAiRecipes()
  const own = (mine.data ?? []).filter((f) => f.owner_id === uid)
  return (
    <>
      <Section title="Your AI recipes" action={own.length ? <span className="num text-footnote text-muted">{own.length}</span> : undefined}>
        {mine.isPending ? <Ghost className="h-14 rounded-lg" /> : own.length === 0 ? (
          <p className="text-sm text-muted">Recipes you save, plan or shop for appear here. Only you can see them.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg bg-elevated px-4">
            {own.slice(0, 20).map((f) => (
              <li key={f.id}>
                <Link to={`/recipes/${f.slug}`} className="press flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0"><span className="block truncate font-semibold">{f.name}</span><span className="num text-footnote text-muted">{f.cuisine} · {f.prep_minutes + f.cook_minutes} min</span></span>
                  <Icon name="right" size={18} className="shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Recent">
        {gens.isPending ? <Ghost className="h-14 rounded-lg" /> : (gens.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. What you generate is kept here so you can come back to it.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg bg-elevated px-4" aria-label="Recent generations">
            {gens.data!.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => onOpen(g)} className="press flex w-full items-center justify-between gap-3 py-3 text-left">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{g.recipes.length ? g.recipes.map((r) => r.name).join(', ') : 'No recipe passed the checks'}</span>
                    <span className="text-footnote text-muted">{MODE_LABEL[g.mode]} · {new Date(g.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                  </span>
                  <Icon name="right" size={18} className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn('press h-9 rounded-full px-4 text-sm font-semibold transition-colors', on ? 'bg-accent-soft text-ink ring-1 ring-inset ring-accent-border' : 'bg-elevated text-ink-2 hover:text-ink')}>
      {children}
    </button>
  )
}
