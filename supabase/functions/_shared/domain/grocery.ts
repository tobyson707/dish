import type { GroceryCategory, IngredientLine } from './types.ts'
import { fromBase, round, toBase, unitDimension, unitKey } from './units.ts'

export interface MealForGrocery {
  planned_meal_id: string
  name: string
  /** portions planned (e.g. 1 = one serving) */
  portion: number
  /** servings the recipe quantities are written for */
  recipe_servings: number
  ingredients: IngredientLine[]
}

export interface GeneratedLine {
  key: string
  ingredient_id: string | null
  name: string
  category: GroceryCategory
  quantity: number | null
  unit: string | null
  source_meal_ids: string[]
  source_meal_names: string[]
  kitchen: 'none' | 'partial' | 'maybe' // maybe = in kitchen but units not comparable
}

export interface InventoryItem {
  ingredient_id: string | null
  name: string
  quantity: number | null
  unit: string | null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function lineKey(l: { ingredient_id: string | null; name: string; unit: string | null }): string {
  return `${l.ingredient_id ?? `name:${norm(l.name)}`}|${unitKey(l.unit)}`
}

/** Combine ingredient lines across meals, summing only compatible units. */
export function aggregateIngredients(meals: MealForGrocery[]): GeneratedLine[] {
  const acc = new Map<string, GeneratedLine & { base: number | null; dim: ReturnType<typeof unitDimension> }>()
  for (const meal of meals) {
    const scale = meal.recipe_servings > 0 ? meal.portion / meal.recipe_servings : meal.portion
    for (const ing of meal.ingredients) {
      if (ing.optional) continue
      const key = lineKey(ing)
      const dim = unitDimension(ing.unit)
      const qty = ing.quantity == null ? null : ing.quantity * scale
      const existing = acc.get(key)
      if (!existing) {
        acc.set(key, {
          key,
          ingredient_id: ing.ingredient_id,
          name: ing.name,
          category: ing.category,
          quantity: null,
          unit: ing.unit,
          base: qty == null ? null : dim ? toBase(qty, ing.unit) : qty,
          dim,
          source_meal_ids: [meal.planned_meal_id],
          source_meal_names: [meal.name],
          kitchen: 'none',
        })
      } else {
        if (qty != null) existing.base = (existing.base ?? 0) + (dim ? toBase(qty, ing.unit) : qty)
        if (!existing.source_meal_ids.includes(meal.planned_meal_id)) {
          existing.source_meal_ids.push(meal.planned_meal_id)
          existing.source_meal_names.push(meal.name)
        }
      }
    }
  }
  return [...acc.values()].map(({ base, dim, ...l }) => {
    if (base == null) return { ...l, quantity: null }
    if (dim) {
      const d = fromBase(base, dim)
      return { ...l, quantity: d.quantity, unit: d.unit }
    }
    return { ...l, quantity: round(base, 2) }
  })
}

/**
 * Removes or reduces lines already covered by kitchen inventory.
 * Lines fully covered are returned in `covered` so the UI can show them.
 */
export function subtractInventory(lines: GeneratedLine[], inventory: InventoryItem[]): { needed: GeneratedLine[]; covered: GeneratedLine[] } {
  const needed: GeneratedLine[] = []
  const covered: GeneratedLine[] = []
  for (const line of lines) {
    const matches = inventory.filter((i) => (line.ingredient_id && i.ingredient_id === line.ingredient_id) || norm(i.name) === norm(line.name))
    if (matches.length === 0) {
      needed.push(line)
      continue
    }
    const dim = unitDimension(line.unit)
    const comparable = matches.filter((m) => m.quantity != null && unitDimension(m.unit) === dim && dim != null)
    if (line.quantity == null || comparable.length === 0) {
      // We know they have some, but can't tell if it's enough.
      needed.push({ ...line, kitchen: 'maybe' })
      continue
    }
    const have = comparable.reduce((s, m) => s + toBase(m.quantity!, m.unit), 0)
    const need = toBase(line.quantity, line.unit)
    if (have >= need) {
      covered.push(line)
    } else {
      const d = fromBase(need - have, dim!)
      needed.push({ ...line, quantity: d.quantity, unit: d.unit, kitchen: 'partial' })
    }
  }
  return { needed, covered }
}

export interface ExistingGroceryItem {
  id: string
  gen_key: string | null
  source: 'generated' | 'manual'
  purchased: boolean
  user_edited: boolean
  quantity: number | null
  unit: string | null
  source_meal_ids: string[]
  stale: boolean
}

export interface GroceryMergePlan {
  insert: GeneratedLine[]
  update: { id: string; quantity: number | null; unit: string | null; source_meal_ids: string[]; source_meal_names: string[]; stale: false; kitchen: GeneratedLine['kitchen'] }[]
  remove: string[] // generated, unpurchased, unedited items no longer needed
  markStale: string[] // purchased or user-edited items no longer needed — kept, flagged
}

/**
 * Merge a freshly generated list into an existing one without destroying
 * user work: manual items are never touched; purchased and user-edited items
 * are never deleted (only flagged stale); user-edited quantities are kept.
 */
export function planGroceryMerge(existing: ExistingGroceryItem[], generated: GeneratedLine[]): GroceryMergePlan {
  const plan: GroceryMergePlan = { insert: [], update: [], remove: [], markStale: [] }
  const byKey = new Map(existing.filter((e) => e.source === 'generated' && e.gen_key).map((e) => [e.gen_key!, e]))
  const seen = new Set<string>()
  for (const g of generated) {
    const e = byKey.get(g.key)
    seen.add(g.key)
    if (!e) {
      plan.insert.push(g)
      continue
    }
    if (e.purchased) continue // already bought — leave it alone
    plan.update.push({
      id: e.id,
      quantity: e.user_edited ? e.quantity : g.quantity,
      unit: e.user_edited ? e.unit : g.unit,
      source_meal_ids: g.source_meal_ids,
      source_meal_names: g.source_meal_names,
      stale: false,
      kitchen: g.kitchen,
    })
  }
  for (const e of byKey.values()) {
    if (seen.has(e.gen_key!)) continue
    if (e.purchased || e.user_edited) {
      if (!e.stale) plan.markStale.push(e.id)
    } else plan.remove.push(e.id)
  }
  return plan
}
