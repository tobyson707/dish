import { supabase } from '@/lib/supabase'

const TABLES = ['profiles', 'user_preferences', 'dietary_goals', 'notification_preferences', 'meal_plans', 'planned_meals', 'food_diary_entries', 'nutrition_entries', 'kitchen_inventory', 'grocery_lists', 'grocery_items', 'budget_records', 'favourite_meals', 'user_prices', 'ai_generation_jobs'] as const

/** Exports everything RLS lets the user read about themselves, as JSON. */
export async function exportData(userId: string) {
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), user_id: userId, format: 'DISH export v1' }
  for (const t of TABLES) {
    const rows: unknown[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(t).select('*').range(from, from + 999)
      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    out[t] = rows
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `dish-export-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

