// Deterministic, explainable meal selection. AI (when configured) may re-rank
// the shortlist this produces, but can never add a candidate that failed the
// hard filters below — allergy exclusions are applied here, before any AI call.
import { checkAllergy } from './allergens.ts'
import { addDays, diffDays, type ISODate } from './dates.ts'
import { COOK_TIME_MAX, fitsOccasion, type CatalogueMeal, type MealSlot, type PreferenceSnapshot } from './types.ts'
import { DEFAULT_SIMILARITY, mealProfile, mealSimilarity, type SimilarityThresholds } from './similarity.ts'

export interface HistoryItem {
  food_item_id: string
  date: ISODate
  /** known for planned meals; diary entries may not have one */
  slot?: MealSlot
}

export interface ScoredCandidate {
  meal: CatalogueMeal
  score: number
  method: 'cook' | 'buy'
  reasons: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** crude singularisation so "egg" matches "Eggs" and "tomatoes" matches "tomato" */
const singular = (w: string) => (w.length > 3 && w.endsWith('oes') ? w.slice(0, -2) : w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const normS = (s: string) => norm(s).split(' ').map(singular).join(' ')

/** True if the user's term names this meal or one of its ingredients (word-level, plural-insensitive). */
export function mentions(meal: Pick<CatalogueMeal, 'name' | 'slug' | 'ingredients'>, term: string): boolean {
  const t = normS(term)
  if (!t) return false
  const hay = [meal.name, meal.slug.replaceAll('-', ' '), ...meal.ingredients.map((i) => i.name)].map(normS)
  return hay.some((h) => h === t || ` ${h} `.includes(` ${t} `) || ` ${t} `.includes(` ${h} `))
}

export function fitsDiet(meal: CatalogueMeal, pattern: PreferenceSnapshot['diet_pattern']): boolean {
  const tags = new Set(meal.dietary_tags)
  switch (pattern) {
    case 'vegetarian':
      return tags.has('vegetarian') || tags.has('vegan')
    case 'vegan':
      return tags.has('vegan')
    case 'pescatarian':
      return tags.has('vegetarian') || tags.has('vegan') || tags.has('pescatarian')
    case 'no_pork':
      return !tags.has('contains_pork')
    case 'no_beef':
      return !tags.has('contains_beef')
    default:
      return true
  }
}

/**
 * Budget per meal in the user's currency. Budgets are only compared with cost
 * estimates in the SAME currency: DISH never converts (no invented rates).
 */
export function perMealBudget(prefs: PreferenceSnapshot, mealsPerDay: number): number | null {
  if (prefs.budget_amount == null || prefs.budget_amount <= 0) return null
  return prefs.budget_period === 'meal' ? prefs.budget_amount : prefs.budget_amount / Math.max(1, mealsPerDay)
}

export function chooseMethod(meal: CatalogueMeal, prefs: PreferenceSnapshot, salt = 0): 'cook' | 'buy' | null {
  const totalTime = meal.prep_minutes + meal.cook_minutes
  const timeOk = totalTime <= COOK_TIME_MAX[prefs.cook_time]
  switch (prefs.cooking_mode) {
    case 'cook':
      return meal.can_cook && timeOk ? 'cook' : null
    case 'buy':
      return meal.can_buy ? 'buy' : null
    case 'quick':
      if (meal.can_cook && totalTime <= Math.min(20, COOK_TIME_MAX[prefs.cook_time])) return 'cook'
      return meal.can_buy ? 'buy' : null
    case 'mix': {
      const cookOk = meal.can_cook && timeOk
      if (cookOk && meal.can_buy) return salt % 2 === 0 ? 'cook' : 'buy'
      if (cookOk) return 'cook'
      return meal.can_buy ? 'buy' : null
    }
  }
}

export interface FilterContext {
  prefs: PreferenceSnapshot
  slot: MealSlot
  mealsPerDay: number
  /** relax soft-hard constraints (method/time/budget) when nothing else fits */
  relax?: boolean
}

export type Exclusion = 'slot' | 'allergy' | 'excluded' | 'diet' | 'method' | 'budget' | 'incomplete'

/**
 * A snack is not a lunch or dinner: items whose primary use is a snack (or
 * light snack-type items under 300 kcal) are kept out of main-meal slots.
 */
export function isSnackOnly(meal: CatalogueMeal): boolean {
  return meal.meal_types[0] === 'snack' || (meal.meal_types.includes('snack') && meal.calories != null && meal.calories < 300)
}

/** Returns null if the meal passes, or the reason it is excluded. */
export function exclusionReason(meal: CatalogueMeal, ctx: FilterContext): Exclusion | null {
  const { prefs } = ctx
  if (!meal.meal_types.includes(ctx.slot)) return 'slot'
  // a beverage never fills a meal or snack, and a drink slot never gets food, even if data disagreed
  if (!fitsOccasion(meal.food_type, ctx.slot)) return 'slot'
  // HARD — never relaxed.
  const allergy = checkAllergy(meal, { allergies: prefs.allergies, custom_allergies: prefs.custom_allergies })
  if (allergy.status !== 'no_known_conflict') return 'allergy'
  if (prefs.excluded_foods.some((x) => mentions(meal, x))) return 'excluded'
  if (!fitsDiet(meal, prefs.diet_pattern)) return 'diet'
  if (ctx.relax) return null
  // SOFT-HARD — relaxed only if the pool would otherwise be empty.
  if ((ctx.slot === 'lunch' || ctx.slot === 'dinner') && isSnackOnly(meal)) return 'incomplete'
  if (!chooseMethod(meal, prefs)) return 'method'
  const budget = perMealBudget(prefs, ctx.mealsPerDay)
  if (budget != null && meal.cost_currency === prefs.currency && meal.est_cost_min != null && meal.est_cost_min > budget * 1.15) return 'budget'
  return null
}

export interface ScoreContext extends FilterContext {
  date: ISODate
  history: HistoryItem[]
  kitchenNames?: string[]
  rng: () => number
  /** catalogue by id, so history items can be compared for similarity */
  lookup?: Map<string, CatalogueMeal>
  similarity?: SimilarityThresholds
  /** how often each main protein / base already appears in this plan block */
  usage?: { protein: Map<string, number>; base: Map<string, number> }
  /** cheapest and dearest same-currency estimate in the candidate pool (budget goal) */
  costRange?: { min: number; max: number } | null
}

const VARIETY_WINDOW = { low: 2, medium: 4, high: 7 } as const
const VARIETY_WEIGHT = { low: 0.5, medium: 1, high: 1.5 } as const

/** Spice on the person's five-step scale (0 none .. 4 very hot) against the catalogue's 0..3. */
function spiceScore(mealSpice: number, pref: number): number {
  const target = Math.min(pref, 3)
  let s = -Math.abs(mealSpice - target) * 1.2
  if (pref === 0 && mealSpice >= 2) s -= 4 // "no spice" means it, not "a bit less"
  if (pref === 4 && mealSpice === 3) s += 1
  return s
}

/** Meals eaten close together (same day or the next) that are too alike. */
function neighbourSimilarity(meal: CatalogueMeal, ctx: ScoreContext): { max: number; penalty: number } {
  if (!ctx.lookup) return { max: 0, penalty: 0 }
  const t = ctx.similarity ?? DEFAULT_SIMILARITY
  let max = 0
  let penalty = 0
  for (const h of ctx.history) {
    if (h.food_item_id === meal.id) continue
    const gap = Math.abs(diffDays(h.date, ctx.date))
    if (gap > 1) continue
    const other = ctx.lookup.get(h.food_item_id)
    if (!other) continue
    const sim = mealSimilarity(meal, other)
    max = Math.max(max, sim)
    if (sim >= t.moderate) penalty += (gap === 0 ? 6 : 4) * sim
  }
  return { max, penalty }
}

export function scoreMeal(meal: CatalogueMeal, ctx: ScoreContext, salt = 0): ScoredCandidate {
  const { prefs } = ctx
  const reasons: string[] = []
  let score = 0

  if (prefs.cuisines.length === 0 || prefs.cuisines.includes(meal.cuisine)) {
    score += prefs.cuisines.length ? 3 : 1
    if (prefs.cuisines.length) reasons.push(`${meal.cuisine}, one of your cuisines`)
  }
  if (prefs.favourite_meals.some((f) => mentions(meal, f))) {
    score += 5
    reasons.push('One of your favourites')
  }
  const favIng = prefs.favourite_ingredients.filter((f) => meal.ingredients.some((i) => norm(i.name).includes(norm(f))))
  if (favIng.length) {
    score += Math.min(3, favIng.length)
    reasons.push(`Has ${favIng.slice(0, 2).join(' & ')}`)
  }
  if (prefs.dislikes.some((d) => mentions(meal, d))) score -= 12
  score += spiceScore(meal.spice_level, prefs.spice_pref)
  score -= Math.abs(meal.richness - prefs.richness_pref) * 0.8

  const goals = new Set(prefs.planning_goals ?? [])
  const total0 = meal.prep_minutes + meal.cook_minutes
  const main = ctx.slot === 'lunch' || ctx.slot === 'dinner'
  const profile = mealProfile(meal)

  // Breakfast: lighter, breakfast-native dishes; no soups, stews or swallows first thing.
  if (ctx.slot === 'breakfast') {
    if (meal.meal_types[0] === 'breakfast') score += 1
    if (meal.calories != null && meal.calories > 650) score -= 3
    if (profile.base === 'swallow' || profile.style === 'soup' || profile.style === 'stew' || profile.style === 'pepper_soup') score -= 6
  }
  // Completeness: a main meal should be a meal, not a nibble.
  if (main && meal.calories != null && meal.calories < 350) score -= 2

  // Planning goals (only those with an honest, measurable effect).
  if (goals.has('less_time') && meal.can_cook && total0 <= 30) score += 1.5
  if (goals.has('substantial') && main && meal.calories != null && meal.calories >= 600) score += 1.5
  if (goals.has('balanced') && meal.protein_g != null && meal.protein_g >= 15 && meal.ingredients.some((i) => i.category === 'produce' && !/onion|scotch bonnet|pepper|garlic|ginger/i.test(i.name))) {
    score += 1.5
    reasons.push('Protein and vegetables')
  }
  if (goals.has('budget') && ctx.costRange && meal.cost_currency === prefs.currency && meal.est_cost_max != null && ctx.costRange.max > ctx.costRange.min) {
    score += 2 * (1 - (meal.est_cost_max - ctx.costRange.min) / (ctx.costRange.max - ctx.costRange.min))
  }
  const seenBefore = ctx.history.some((h) => h.food_item_id === meal.id)
  if (goals.has('discover') && !seenBefore) score += prefs.cuisines.length && !prefs.cuisines.includes(meal.cuisine) ? 1.5 : 1
  if (goals.has('routine') && seenBefore) score += 1

  // Variety of the main ingredient and base across the block.
  if (ctx.usage) {
    const w = VARIETY_WEIGHT[prefs.variety] * (goals.has('routine') ? 0.6 : 1) * (goals.has('discover') ? 1.3 : 1)
    if (profile.protein !== 'none') score -= 1.6 * w * (ctx.usage.protein.get(profile.protein) ?? 0)
    if (profile.base !== 'none') score -= 1.2 * w * (ctx.usage.base.get(profile.base) ?? 0)
  }
  // Consecutive meals should not be near-copies of each other.
  score -= neighbourSimilarity(meal, ctx).penalty

  if (meal.calories != null) {
    if (prefs.goal === 'lose' && meal.calories < 550) score += 1.5
    if ((prefs.goal === 'gain' || prefs.goal === 'muscle') && meal.calories > 550) score += 1.5
  }
  if (meal.protein_g != null && prefs.goal === 'muscle' && meal.protein_g >= 25) {
    score += 2
    reasons.push('Good protein')
  }

  const budget = perMealBudget(prefs, ctx.mealsPerDay)
  if (budget != null && meal.cost_currency === prefs.currency && meal.est_cost_max != null && meal.est_cost_max <= budget) score += 1.5

  const total = meal.prep_minutes + meal.cook_minutes
  if (total <= 20) reasons.push(`Ready in about ${total} min`)

  if (ctx.kitchenNames?.length) {
    const have = meal.ingredients.filter((i) => !i.optional && ctx.kitchenNames!.some((k) => norm(k) === norm(i.name))).length
    const need = meal.ingredients.filter((i) => !i.optional).length || 1
    if (have > 0) {
      score += 3 * (have / need)
      reasons.push(`Uses ${have} thing${have > 1 ? 's' : ''} from your kitchen`)
    }
  }

  // Variety: penalise meals eaten/planned recently.
  const window = VARIETY_WINDOW[prefs.variety]
  for (const h of ctx.history) {
    if (h.food_item_id !== meal.id) continue
    const gap = Math.abs(diffDays(h.date, ctx.date))
    if (gap === 0) score -= 20
    else if (gap < window) score -= 8 * (1 - gap / window)
    else if (prefs.leftovers_ok && gap === 1) score += 0.5
  }

  score += ctx.rng() * 2.5 // gentle shuffle so plans don't repeat identically
  const method = chooseMethod(meal, prefs, salt) ?? (meal.can_cook ? 'cook' : 'buy')
  return { meal, score, method, reasons: reasons.slice(0, 3) }
}

/**
 * Rank the meals that pass the filters. `guard` (uniqueness and similarity
 * rules) narrows the pool further, but only while something still passes: a
 * slot is never left empty because of variety alone.
 */
export function rankCandidates(meals: CatalogueMeal[], ctx: ScoreContext, salt = 0, guard?: (m: CatalogueMeal) => boolean): ScoredCandidate[] {
  let pool = meals.filter((m) => exclusionReason(m, ctx) === null)
  if (pool.length === 0) pool = meals.filter((m) => exclusionReason(m, { ...ctx, relax: true }) === null)
  if (guard) {
    const varied = pool.filter(guard)
    if (varied.length) pool = varied
  }
  let costRange = ctx.costRange
  if (costRange === undefined && ctx.prefs.planning_goals?.includes('budget')) {
    const costs = pool.filter((m) => m.cost_currency === ctx.prefs.currency && m.est_cost_max != null).map((m) => m.est_cost_max!)
    costRange = costs.length ? { min: Math.min(...costs), max: Math.max(...costs) } : null
  }
  return pool.map((m) => scoreMeal(m, { ...ctx, costRange }, salt)).sort((a, b) => b.score - a.score)
}

export interface VarietyOptions {
  leftovers_ok: boolean
  similarity?: SimilarityThresholds
}

type Placed = { date: ISODate; slot: MealSlot; food_item_id: string | null }

/** A recipe never repeats within this many days (a week), however long the plan. */
export const REPEAT_WINDOW_DAYS = 7

/**
 * May `meal` go in (date, slot) given what is already placed? The same recipe
 * within a week is refused (except as next-day leftovers for lunch or dinner
 * when the person allows leftovers), and so is a near-copy on the same or the
 * next day. Longer plans repeat favourites only after a week has passed.
 */
export function fitsVariety(meal: CatalogueMeal, at: { date: ISODate; slot: MealSlot }, placed: Placed[], lookup: Map<string, CatalogueMeal>, opts: VarietyOptions): boolean {
  const t = opts.similarity ?? DEFAULT_SIMILARITY
  const main = at.slot === 'lunch' || at.slot === 'dinner'
  for (const p of placed) {
    if (!p.food_item_id || (p.date === at.date && p.slot === at.slot)) continue
    const gap = Math.abs(diffDays(p.date, at.date))
    if (p.food_item_id === meal.id) {
      if (gap >= REPEAT_WINDOW_DAYS) continue
      if (opts.leftovers_ok && main && gap === 1 && (p.slot === 'lunch' || p.slot === 'dinner')) continue
      return false
    }
    if (gap > 1) continue
    const other = lookup.get(p.food_item_id)
    if (other && mealSimilarity(meal, other) >= t.strong) return false
  }
  return true
}

export interface PlanIssue {
  kind: 'duplicate' | 'similar' | 'incomplete'
  date: ISODate
  slot: MealSlot
  food_item_id: string
  other?: string
}

/** Check a whole block. Bounded: O(n²) over the block's own slots, no search. */
export function validatePlan(placed: Placed[], lookup: Map<string, CatalogueMeal>, opts: VarietyOptions): PlanIssue[] {
  const issues: PlanIssue[] = []
  const sorted = [...placed].filter((p) => p.food_item_id).sort(bySlotTime)
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!
    const meal = lookup.get(p.food_item_id!)
    if (!meal) continue
    if ((p.slot === 'lunch' || p.slot === 'dinner') && isSnackOnly(meal)) issues.push({ kind: 'incomplete', date: p.date, slot: p.slot, food_item_id: meal.id })
    const before = sorted.slice(0, i)
    if (fitsVariety(meal, p, before, lookup, opts)) continue
    const dup = before.find((b) => b.food_item_id === meal.id)
    issues.push(dup ? { kind: 'duplicate', date: p.date, slot: p.slot, food_item_id: meal.id, other: dup.food_item_id! } : { kind: 'similar', date: p.date, slot: p.slot, food_item_id: meal.id, other: before.find((b) => Math.abs(diffDays(b.date, p.date)) <= 1 && lookup.get(b.food_item_id!) && mealSimilarity(meal, lookup.get(b.food_item_id!)!) >= (opts.similarity ?? DEFAULT_SIMILARITY).strong)?.food_item_id ?? undefined })
  }
  return issues
}

/**
 * One bounded repair pass over selections (for example after an AI re-rank,
 * which picks each slot independently): any pick that breaks the variety rules
 * is swapped for the first shortlist alternative that doesn't. Kept and locked
 * meals are never changed. Returns how many picks were changed.
 */
export function enforceVariety(selections: PlannedSelection[], keep: Placed[], lookup: Map<string, CatalogueMeal>, opts: VarietyOptions): number {
  const ordered = [...selections].sort(bySlotTime)
  const placed: Placed[] = [...keep]
  let changed = 0
  for (const s of ordered) {
    const current = lookup.get(s.food_item_id)
    if (current && !fitsVariety(current, s, placed, lookup, opts)) {
      const alt = s.shortlist.map((id) => lookup.get(id)).find((m) => m && m.id !== s.food_item_id && fitsVariety(m, s, placed, lookup, opts))
      if (alt) {
        s.food_item_id = alt.id
        s.reasons = ['Adds variety to your week']
        changed++
      }
    }
    placed.push({ date: s.date, slot: s.slot, food_item_id: s.food_item_id })
  }
  return changed
}

export function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PlanSlotRequest {
  date: ISODate
  slot: MealSlot
}

export interface PlannedSelection extends PlanSlotRequest {
  food_item_id: string
  method: 'cook' | 'buy'
  reasons: string[]
  /** shortlist (best first) — passed to AI for optional re-ranking */
  shortlist: string[]
}

export interface GenerateInput {
  slots: PlanSlotRequest[]
  meals: CatalogueMeal[]
  prefs: PreferenceSnapshot
  mealsPerDay: number
  /** slots that are locked or already filled and must not be touched */
  keep: (PlanSlotRequest & { food_item_id: string | null })[]
  history: HistoryItem[]
  kitchenNames?: string[]
  seed: string
  shortlistSize?: number
  /** override the similarity thresholds (defaults: strong 0.75, moderate 0.5) */
  similarity?: SimilarityThresholds
}

const SLOT_ORDER: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3, drink: 4 }
const bySlotTime = (a: PlanSlotRequest, b: PlanSlotRequest) => (a.date === b.date ? SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] : a.date < b.date ? -1 : 1)

/**
 * Fill every requested slot. Slots with nothing suitable are returned in
 * `unfilled`. No recipe repeats within a week (bar allowed leftovers), no
 * near-identical meals on the same or consecutive days, and spreads the main
 * protein and base across the week.
 */
export function generateSelections(input: GenerateInput): { selections: PlannedSelection[]; unfilled: PlanSlotRequest[] } {
  const rng = seededRng(input.seed)
  const lookup = new Map(input.meals.map((m) => [m.id, m]))
  const history: HistoryItem[] = [
    ...input.history,
    ...input.keep.filter((k) => k.food_item_id).map((k) => ({ food_item_id: k.food_item_id!, date: k.date })),
  ]
  const keyOf = (x: { date: ISODate; slot?: MealSlot }) => `${x.date}|${x.slot ?? ''}`
  const requested = new Set(input.slots.map(keyOf))
  const placed: Placed[] = [
    ...input.keep.map((k) => ({ date: k.date, slot: k.slot, food_item_id: k.food_item_id })),
    // recent meals outside this block (e.g. the previous generation chunk) count too
    ...input.history.filter((h) => h.slot && !requested.has(keyOf(h))).map((h) => ({ date: h.date, slot: h.slot!, food_item_id: h.food_item_id })),
  ]
  // main protein / base counts over the surrounding week (rolling, so long plans stay varied all year)
  const usageAround = (date: ISODate) => {
    const usage = { protein: new Map<string, number>(), base: new Map<string, number>() }
    for (const p of placed) {
      if (!p.food_item_id || Math.abs(diffDays(p.date, date)) >= REPEAT_WINDOW_DAYS) continue
      const m = lookup.get(p.food_item_id)
      if (!m) continue
      const pr = mealProfile(m)
      usage.protein.set(pr.protein, (usage.protein.get(pr.protein) ?? 0) + 1)
      usage.base.set(pr.base, (usage.base.get(pr.base) ?? 0) + 1)
    }
    return usage
  }
  const opts: VarietyOptions = { leftovers_ok: input.prefs.leftovers_ok, similarity: input.similarity }
  const keepSet = new Set(input.keep.map((k) => `${k.date}|${k.slot}`))
  const selections: PlannedSelection[] = []
  const unfilled: PlanSlotRequest[] = []
  const ordered = [...input.slots].sort(bySlotTime)
  let salt = 0
  for (const req of ordered) {
    if (keepSet.has(`${req.date}|${req.slot}`)) continue
    const ranked = rankCandidates(
      input.meals,
      { prefs: input.prefs, slot: req.slot, mealsPerDay: input.mealsPerDay, date: req.date, history, kitchenNames: input.kitchenNames, rng, lookup, similarity: input.similarity, usage: usageAround(req.date) },
      salt++,
      (m) => fitsVariety(m, req, placed, lookup, opts),
    )
    if (ranked.length === 0) {
      unfilled.push(req)
      continue
    }
    const pick = ranked[0]
    selections.push({
      ...req,
      food_item_id: pick.meal.id,
      method: pick.method,
      reasons: pick.reasons,
      shortlist: ranked.slice(0, input.shortlistSize ?? 6).map((r) => r.meal.id),
    })
    history.push({ food_item_id: pick.meal.id, date: req.date })
    placed.push({ ...req, food_item_id: pick.meal.id })
  }
  return { selections, unfilled }
}

/** Replacement candidates for one slot: same constraints, excluding the current meal. */
export function replacementCandidates(
  meals: CatalogueMeal[],
  args: { slot: MealSlot; date: ISODate; currentId: string | null; prefs: PreferenceSnapshot; mealsPerDay: number; history: HistoryItem[]; seed: string; count?: number },
): ScoredCandidate[] {
  const rng = seededRng(args.seed)
  return rankCandidates(
    meals.filter((m) => m.id !== args.currentId),
    { prefs: args.prefs, slot: args.slot, mealsPerDay: args.mealsPerDay, date: args.date, history: args.history, rng },
  ).slice(0, args.count ?? 3)
}

export interface SurpriseFilters {
  slot: MealSlot
  method?: 'cook' | 'buy' | 'any'
  maxBudget?: number | null
  maxMinutes?: number | null
  cuisine?: string | null // null/'' = anything
  useKitchen?: boolean
}

export function surpriseCandidates(
  meals: CatalogueMeal[],
  f: SurpriseFilters,
  ctx: { prefs: PreferenceSnapshot; date: ISODate; history: HistoryItem[]; kitchenNames?: string[]; seed: string; mealsPerDay: number; exclude?: string[]; count?: number },
): ScoredCandidate[] {
  const prefs: PreferenceSnapshot = {
    ...ctx.prefs,
    cooking_mode: f.method === 'cook' ? 'cook' : f.method === 'buy' ? 'buy' : 'mix',
    cook_time: f.maxMinutes != null ? (f.maxMinutes <= 15 ? 'lt15' : f.maxMinutes <= 30 ? '15_30' : f.maxMinutes <= 60 ? '30_60' : 'gt60') : ctx.prefs.cook_time,
    budget_amount: f.maxBudget ?? ctx.prefs.budget_amount,
    budget_period: f.maxBudget != null ? 'meal' : ctx.prefs.budget_period,
    cuisines: f.cuisine ? [f.cuisine] : [],
  }
  const pool = meals.filter((m) => !(ctx.exclude ?? []).includes(m.id) && (!f.cuisine || m.cuisine === f.cuisine))
  const rng = seededRng(ctx.seed)
  // Surprise is strict: no relaxing of method/budget/time — an honest empty result beats a mismatch.
  return pool
    .filter((m) => exclusionReason(m, { prefs, slot: f.slot, mealsPerDay: ctx.mealsPerDay }) === null)
    .filter((m) => f.maxMinutes == null || chooseMethod(m, prefs) === 'buy' || m.prep_minutes + m.cook_minutes <= f.maxMinutes)
    .map((m) => scoreMeal(m, { prefs, slot: f.slot, mealsPerDay: ctx.mealsPerDay, date: ctx.date, history: ctx.history, kitchenNames: f.useKitchen ? ctx.kitchenNames : undefined, rng }))
    .sort((a, b) => b.score - a.score)
    .slice(0, ctx.count ?? 3)
}

/** Expand dates × slots for a block. */
export function slotsForRange(start: ISODate, end: ISODate, slots: MealSlot[], planDays?: number[]): PlanSlotRequest[] {
  const out: PlanSlotRequest[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7
    if (planDays && planDays.length && !planDays.includes(wd)) continue
    for (const s of slots) out.push({ date: d, slot: s })
  }
  return out
}
