import type { CatalogueRow } from './context.ts'

export function toSuggestion(m: CatalogueRow, method: 'cook' | 'buy', reasons: string[], note?: string | null) {
  return {
    food_item_id: m.id,
    name: m.name,
    slug: m.slug,
    method,
    reasons,
    note: note ?? null,
    est_cost_min: m.est_cost_min,
    est_cost_max: m.est_cost_max,
    calories: m.calories,
    prep_minutes: m.prep_minutes,
    cook_minutes: m.cook_minutes,
    image_path: m.image_path,
    // never "safe": only that no conflict was found in the listed ingredients
    allergy_status: 'no_known_conflict' as const,
  }
}

/** Snapshot catalogue values onto a planned meal row. */
export function plannedSnapshot(m: CatalogueRow, method: 'cook' | 'buy') {
  const cost = m.est_cost_min == null && m.est_cost_max == null ? null : Math.round(((m.est_cost_min ?? m.est_cost_max!) + (m.est_cost_max ?? m.est_cost_min!)) / 2)
  return {
    food_item_id: m.id,
    name: m.name,
    calories: m.calories,
    protein_g: m.protein_g,
    carbs_g: m.carbs_g,
    fat_g: m.fat_g,
    nutrition_source: m.nutrition_source,
    est_cost: cost,
    method,
  }
}
