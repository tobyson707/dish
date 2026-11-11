import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { play } from '@/lib/uiSound'
import { useUserId } from '@/features/auth/AuthProvider'
import { enqueue } from '@/offline/outbox'
import { uuid } from '@/lib/ids'
import { aggregateIngredients, planGroceryMerge, subtractInventory, type MealForGrocery } from '@domain/grocery.ts'
import type { GroceryCategory } from '@domain/types.ts'
import type { FoodItem, GroceryItem, GroceryList, KitchenItemRow, PlannedMeal } from '@/types/db'
import { persistMeta, qk } from './keys'
import { patchLists, upsertIn } from './optimistic'
import { toCatalogueMeal } from './catalogue'

export function useGroceryLists() {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.groceryLists(uid),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('grocery_lists').select('*').eq('user_id', uid).eq('archived', false).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as GroceryList[]
    },
  })
}

export function useGroceryItems(listId: string | undefined) {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.groceryItems(uid, listId ?? ''),
    meta: persistMeta(uid),
    enabled: !!listId,
    queryFn: async () => {
      const { data, error } = await supabase.from('grocery_items').select('*').eq('list_id', listId!).order('category').order('sort').order('name')
      if (error) throw error
      return (data ?? []) as GroceryItem[]
    },
  })
}

export function useCreateList() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.from('grocery_lists').insert({ id: uuid(), user_id: uid, name }).select('*').single()
      if (error) throw error
      return data as GroceryList
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.groceryLists(uid) }),
  })
}

export function useRenameOrArchiveList() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<GroceryList, 'name' | 'archived'>> }) => {
      const { error } = await supabase.from('grocery_lists').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.groceryLists(uid) }),
  })
}

/** Offline-capable item edits. */
export function useGroceryItemMutations(listId: string) {
  const uid = useUserId()
  const qc = useQueryClient()
  const key = qk.groceryItems(uid, listId)
  const local = (fn: (rows: GroceryItem[]) => GroceryItem[]) => patchLists<GroceryItem>(qc, key, fn)
  const stamp = () => new Date().toISOString()

  return {
    toggle: async (item: GroceryItem) => {
      if (!item.purchased) play('tick') // a tactile tick as it goes in the basket
      const patch = { purchased: !item.purchased, purchased_at: !item.purchased ? stamp() : null, client_updated_at: stamp() }
      local((rows) => rows.map((r) => (r.id === item.id ? { ...r, ...patch, _pending: true } : r)))
      await enqueue({ kind: 'update', table: 'grocery_items', id: item.id, patch }, { label: `${patch.purchased ? 'Tick off' : 'Untick'} ${item.name}`, invalidate: [key] })
    },
    edit: async (item: GroceryItem, patch: Partial<Pick<GroceryItem, 'name' | 'quantity' | 'unit' | 'category'>>) => {
      const p = { ...patch, user_edited: true, client_updated_at: stamp() }
      local((rows) => rows.map((r) => (r.id === item.id ? { ...r, ...p, _pending: true } : r)))
      await enqueue({ kind: 'update', table: 'grocery_items', id: item.id, patch: p }, { label: `Edit ${item.name}`, invalidate: [key] })
    },
    add: async (input: { name: string; quantity: number | null; unit: string | null; category: GroceryCategory; ingredient_id?: string | null }) => {
      const row = {
        id: uuid(),
        list_id: listId,
        user_id: uid,
        ingredient_id: input.ingredient_id ?? null,
        name: input.name.trim(),
        category: input.category,
        quantity: input.quantity,
        unit: input.unit,
        source: 'manual' as const,
        client_updated_at: stamp(),
      }
      local((rows) => upsertIn(rows, { ...row, gen_key: null, source_meal_ids: [], source_meal_names: [], kitchen_status: 'none', user_edited: true, stale: false, purchased: false, purchased_at: null, est_cost: null, sort: 999, _pending: true }))
      await enqueue({ kind: 'upsert', table: 'grocery_items', row }, { label: `Add ${row.name}`, invalidate: [key] })
    },
    remove: async (item: GroceryItem) => {
      local((rows) => rows.filter((r) => r.id !== item.id))
      await enqueue({ kind: 'delete', table: 'grocery_items', id: item.id }, { label: `Remove ${item.name}`, invalidate: [key] })
    },
  }
}

export interface GenerateResult {
  list: GroceryList
  inserted: number
  updated: number
  removed: number
  keptStale: number
  coveredByKitchen: string[]
  mealsWithoutRecipe: string[]
}

/**
 * Build or refresh a list from planned meals in [from, to].
 * Requires a connection (it reads the latest plan & kitchen). Manual items are never
 * touched; purchased or hand-edited items are kept and flagged if no longer needed.
 */
export function useGenerateGroceryList() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ from, to, listId, name, catalogue, excludeKitchen, planId }: { from: string; to: string; listId?: string; name?: string; catalogue: FoodItem[]; excludeKitchen: boolean; /** one saved plan's meals only (any plan I can see) */ planId?: string }): Promise<GenerateResult> => {
      const [{ data: meals, error: e1 }, { data: kitchen, error: e2 }] = await Promise.all([
        (planId ? supabase.from('planned_meals').select('*').eq('plan_id', planId) : supabase.from('planned_meals').select('*').eq('user_id', uid).eq('on_calendar', true)).gte('date', from).lte('date', to).neq('status', 'skipped'),
        supabase.from('kitchen_inventory').select('*').eq('user_id', uid).is('used_at', null),
      ])
      if (e1) throw e1
      if (e2) throw e2
      const byId = new Map(catalogue.map((f) => [f.id, f]))
      const forGrocery: MealForGrocery[] = []
      const mealsWithoutRecipe: string[] = []
      for (const m of (meals ?? []) as PlannedMeal[]) {
        const f = m.food_item_id ? byId.get(m.food_item_id) : undefined
        if (m.method === 'buy') continue // bought meals need no ingredients
        if (!f?.recipe || f.recipe.recipe_ingredients.length === 0) {
          mealsWithoutRecipe.push(m.name)
          continue
        }
        forGrocery.push({ planned_meal_id: m.id, name: m.name, portion: m.portion, recipe_servings: f.recipe.servings, ingredients: toCatalogueMeal(f).ingredients })
      }
      const aggregated = aggregateIngredients(forGrocery)
      const { needed, covered } = excludeKitchen ? subtractInventory(aggregated, ((kitchen ?? []) as KitchenItemRow[]).map((k) => ({ ingredient_id: k.ingredient_id, name: k.name, quantity: k.quantity, unit: k.unit }))) : { needed: aggregated, covered: [] }

      let list: GroceryList
      if (listId) {
        const { data, error } = await supabase.from('grocery_lists').update({ range_start: from, range_end: to }).eq('id', listId).select('*').single()
        if (error) throw error
        list = data as GroceryList
      } else {
        const { data, error } = await supabase.from('grocery_lists').insert({ id: uuid(), user_id: uid, name: name ?? 'Shopping list', plan_id: planId ?? null, range_start: from, range_end: to }).select('*').single()
        if (error) throw error
        list = data as GroceryList
      }
      const { data: existing, error: e3 } = await supabase.from('grocery_items').select('*').eq('list_id', list.id)
      if (e3) throw e3
      const merge = planGroceryMerge((existing ?? []) as GroceryItem[], needed)
      if (merge.insert.length) {
        const { error } = await supabase.from('grocery_items').insert(
          merge.insert.map((g, i) => ({
            list_id: list.id,
            user_id: uid,
            ingredient_id: g.ingredient_id,
            name: g.name,
            category: g.category,
            quantity: g.quantity,
            unit: g.unit,
            source: 'generated',
            gen_key: g.key,
            source_meal_ids: g.source_meal_ids,
            source_meal_names: g.source_meal_names,
            kitchen_status: g.kitchen,
            sort: i,
            client_updated_at: new Date().toISOString(),
          })),
        )
        if (error) throw error
      }
      for (const u of merge.update) {
        const { error } = await supabase.from('grocery_items').update({ quantity: u.quantity, unit: u.unit, source_meal_ids: u.source_meal_ids, source_meal_names: u.source_meal_names, stale: false, kitchen_status: u.kitchen, client_updated_at: new Date().toISOString() }).eq('id', u.id)
        if (error) throw error
      }
      if (merge.remove.length) {
        const { error } = await supabase.from('grocery_items').delete().in('id', merge.remove)
        if (error) throw error
      }
      if (merge.markStale.length) {
        const { error } = await supabase.from('grocery_items').update({ stale: true, client_updated_at: new Date().toISOString() }).in('id', merge.markStale)
        if (error) throw error
      }
      return { list, inserted: merge.insert.length, updated: merge.update.length, removed: merge.remove.length, keptStale: merge.markStale.length, coveredByKitchen: covered.map((c) => c.name), mealsWithoutRecipe }
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.groceryLists(uid) })
      void qc.invalidateQueries({ queryKey: qk.groceryItems(uid, r.list.id) })
    },
  })
}

/** Add specific ingredients (e.g. missing ones from the kitchen assistant) as manual items. */
export function useAddIngredientsToList() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ listId, items }: { listId?: string; items: { name: string; ingredient_id: string | null; category: GroceryCategory; quantity: number | null; unit: string | null }[] }) => {
      let id = listId
      if (!id) {
        const { data: lists } = await supabase.from('grocery_lists').select('id').eq('user_id', uid).eq('archived', false).order('created_at', { ascending: false }).limit(1)
        id = lists?.[0]?.id
        if (!id) {
          const { data, error } = await supabase.from('grocery_lists').insert({ id: uuid(), user_id: uid, name: 'Shopping list' }).select('id').single()
          if (error) throw error
          id = data.id as string
        }
      }
      const { error } = await supabase.from('grocery_items').insert(items.map((it) => ({ ...it, list_id: id, user_id: uid, source: 'manual', client_updated_at: new Date().toISOString() })))
      if (error) throw error
      return id!
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: qk.groceryLists(uid) })
      void qc.invalidateQueries({ queryKey: qk.groceryItems(uid, id) })
    },
  })
}
