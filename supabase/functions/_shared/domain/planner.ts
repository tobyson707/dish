// Deterministic, explainable meal selection. AI (when configured) may re-rank
// the shortlist this produces, but can never add a candidate that failed the
// hard filters below — allergy exclusions are applied here, before any AI call.
import { checkAllergy } from './allergens.ts'
import { addDays, diffDays, type ISODate } from './dates.ts'
import { COOK_TIME_MAX, type CatalogueMeal, type MealSlot, type PreferenceSnapshot } from './types.ts'

export interface HistoryItem {
  food_item_id: string
  date: ISODate
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

export type Exclusion = 'slot' | 'allergy' | 'excluded' | 'diet' | 'method' | 'budget'

/** Returns null if the meal passes, or the reason it is excluded. */
export function exclusionReason(meal: CatalogueMeal, ctx: FilterContext): Exclusion | null {
  const { prefs } = ctx
  if (!meal.meal_types.includes(ctx.slot)) return 'slot'
  // HARD — never relaxed.
  const allergy = checkAllergy(meal, { allergies: prefs.allergies, custom_allergies: prefs.custom_allergies })
  if (allergy.status !== 'no_known_conflict') return 'allergy'
  if (prefs.excluded_foods.some((x) => mentions(meal, x))) return 'excluded'
  if (!fitsDiet(meal, prefs.diet_pattern)) return 'diet'
  if (ctx.relax) return null
  // SOFT-HARD — relaxed only if the pool would otherwise be empty.
  if (!chooseMethod(meal, prefs)) return 'method'
  const budget = perMealBudget(prefs, ctx.mealsPerDay)
  if (budget != null && meal.est_cost_min != null && meal.est_cost_min > budget * 1.15) return 'budget'
  return null
}

export interface ScoreContext extends FilterContext {
  date: ISODate
  history: HistoryItem[]
  kitchenNames?: string[]
  rng: () => number
}

const VARIETY_WINDOW = { low: 2, medium: 4, high: 7 } as const

export function scoreMeal(meal: CatalogueMeal, ctx: ScoreContext, salt = 0): ScoredCandidate {
  const { prefs } = ctx
  const reasons: string[] = []
  let score = 0

  if (prefs.cuisines.length === 0 || prefs.cuisines.includes(meal.cuisine)) {
    score += prefs.cuisines.length ? 3 : 1
    if (prefs.cuisines.length) reasons.push(`${meal.cuisine} — one of your cuisines`)
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
  score -= Math.abs(meal.spice_level - prefs.spice_pref) * 1.2
  score -= Math.abs(meal.richness - prefs.richness_pref) * 0.8

  if (meal.calories != null) {
    if (prefs.goal === 'lose' && meal.calories < 550) score += 1.5
    if ((prefs.goal === 'gain' || prefs.goal === 'muscle') && meal.calories > 550) score += 1.5
  }
  if (meal.protein_g != null && prefs.goal === 'muscle' && meal.protein_g >= 25) {
    score += 2
    reasons.push('Good protein')
  }

  const budget = perMealBudget(prefs, ctx.mealsPerDay)
  if (budget != null && meal.est_cost_max != null && meal.est_cost_max <= budget) score += 1.5

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

export function rankCandidates(meals: CatalogueMeal[], ctx: ScoreContext, salt = 0): ScoredCandidate[] {
  let pool = meals.filter((m) => exclusionReason(m, ctx) === null)
  if (pool.length === 0) pool = meals.filter((m) => exclusionReason(m, { ...ctx, relax: true }) === null)
  return pool.map((m) => scoreMeal(m, ctx, salt)).sort((a, b) => b.score - a.score)
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
}

/** Fill every requested slot. Slots with nothing suitable are returned in `unfilled`. */
export function generateSelections(input: GenerateInput): { selections: PlannedSelection[]; unfilled: PlanSlotRequest[] } {
  const rng = seededRng(input.seed)
  const history: HistoryItem[] = [
    ...input.history,
    ...input.keep.filter((k) => k.food_item_id).map((k) => ({ food_item_id: k.food_item_id!, date: k.date })),
  ]
  const keepSet = new Set(input.keep.map((k) => `${k.date}|${k.slot}`))
  const selections: PlannedSelection[] = []
  const unfilled: PlanSlotRequest[] = []
  const ordered = [...input.slots].sort((a, b) => (a.date === b.date ? a.slot.localeCompare(b.slot) : a.date < b.date ? -1 : 1))
  let salt = 0
  for (const req of ordered) {
    if (keepSet.has(`${req.date}|${req.slot}`)) continue
    const ranked = rankCandidates(input.meals, { prefs: input.prefs, slot: req.slot, mealsPerDay: input.mealsPerDay, date: req.date, history, kitchenNames: input.kitchenNames, rng }, salt++)
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
