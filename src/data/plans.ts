import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import { enqueue } from '@/offline/outbox'
import { uuid } from '@/lib/ids'
import type { MealSlot } from '@domain/types.ts'
import type { MealPlan, PlannedMeal, PlannedStatus } from '@/types/db'
import { persistMeta, qk } from './keys'
import { patchLists, patchRangeLists, upsertIn } from './optimistic'

const PM_SELECT = '*, food_item:food_items(id, slug, image_path, image_alt, cuisine, prep_minutes, cook_minutes, allergens, ingredients_complete, description)'

export function useActivePlan() {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.activePlan(uid),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('meal_plans').select('*').eq('user_id', uid).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return (data as MealPlan | null) ?? null
    },
  })
}

export function usePlannedMeals(from: string, to: string, opts: { enabled?: boolean } = {}) {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.plannedRange(uid, from, to),
    meta: persistMeta(uid),
    enabled: opts.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.from('planned_meals').select(PM_SELECT).eq('user_id', uid).gte('date', from).lte('date', to).order('date').order('scheduled_time', { nullsFirst: false })
      if (error) throw error
      return (data ?? []) as PlannedMeal[]
    },
  })
}

export function usePlannedMeal(id: string | undefined) {
  const uid = useUserId()
  const qc = useQueryClient()
  return useQuery({
    queryKey: qk.plannedMeal(uid, id ?? ''),
    meta: persistMeta(uid),
    enabled: !!id,
    initialData: () => {
      for (const [, rows] of qc.getQueriesData<PlannedMeal[]>({ queryKey: qk.planned(uid) })) {
        const hit = Array.isArray(rows) ? rows.find((r) => r.id === id) : undefined
        if (hit) return hit
      }
      return undefined
    },
    queryFn: async () => {
      const { data, error } = await supabase.from('planned_meals').select(PM_SELECT).eq('id', id!).single()
      if (error) throw error
      return data as PlannedMeal
    },
  })
}

const SORT: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 3, snack: 2 }
export const sortPlanned = (a: PlannedMeal, b: PlannedMeal) => (a.date === b.date ? SORT[a.slot] - SORT[b.slot] : a.date < b.date ? -1 : 1)

/** Local-first edits to a planned meal (lock, portion, move, time). Queued for sync. */
export function useUpdatePlannedMeal() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch, label }: { id: string; patch: Partial<Pick<PlannedMeal, 'locked' | 'portion' | 'date' | 'slot' | 'scheduled_time'>>; label: string }) => {
      const stamped = { ...patch, client_updated_at: new Date().toISOString() }
      const current = qc.getQueryData<PlannedMeal>(qk.plannedMeal(uid, id)) ?? qc.getQueriesData<PlannedMeal[]>({ queryKey: qk.planned(uid) }).flatMap(([, d]) => (Array.isArray(d) ? d : [])).find((r) => r.id === id)
      if (patch.date && current && patch.date !== current.date) {
        // moved to another day: remove from every range, add to ranges containing the new date
        const moved = { ...current, ...stamped } as PlannedMeal
        patchLists<PlannedMeal>(qc, qk.planned(uid), (rows) => rows.filter((r) => r.id !== id))
        patchRangeLists<PlannedMeal>(qc, qk.planned(uid), patch.date, (rows) => upsertIn(rows, moved).sort(sortPlanned))
      } else {
        patchLists<PlannedMeal>(qc, qk.planned(uid), (rows) => rows.map((r) => (r.id === id ? { ...r, ...stamped } : r)).sort(sortPlanned))
      }
      qc.setQueryData<PlannedMeal>(qk.plannedMeal(uid, id), (old) => (old ? { ...old, ...stamped } : old))
      await enqueue({ kind: 'update', table: 'planned_meals', id, patch: stamped }, { label, invalidate: [qk.planned(uid)] })
    },
  })
}

/** Mark eaten / skipped / planned. Eaten creates exactly one linked diary entry (server-side). */
export function useSetMealStatus() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ meal, status }: { meal: PlannedMeal; status: PlannedStatus }) => {
      patchLists<PlannedMeal>(qc, qk.planned(uid), (rows) => rows.map((r) => (r.id === meal.id ? { ...r, status } : r)))
      qc.setQueryData<PlannedMeal>(qk.plannedMeal(uid, meal.id), (old) => (old ? { ...old, status } : old))
      await enqueue(
        { kind: 'rpc', fn: 'set_planned_meal_status', args: { p_meal_id: meal.id, p_status: status, p_entry_id: status === 'eaten' ? uuid() : null, p_local_date: meal.date } },
        { label: `${status === 'eaten' ? 'Mark eaten' : status === 'skipped' ? 'Skip' : 'Reset'}: ${meal.name}`, invalidate: [qk.planned(uid), qk.diary(uid)] },
      )
    },
  })
}

export interface ManualMealInput {
  date: string
  slot: MealSlot
  name: string
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  est_cost: number | null
  /** ISO 4217 code the estimate is in (catalogue estimates are NGN) */
  est_cost_currency?: string | null
  method: 'cook' | 'buy'
  food_item_id?: string | null
  nutrition_source?: PlannedMeal['nutrition_source']
  plan_id?: string | null
  portion?: number
}

export function useCreatePlannedMeal() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (m: ManualMealInput) => {
      const row = {
        id: uuid(),
        user_id: uid,
        plan_id: m.plan_id ?? null,
        date: m.date,
        slot: m.slot,
        name: m.name.trim(),
        portion: m.portion ?? 1,
        calories: m.calories,
        protein_g: m.protein_g,
        carbs_g: m.carbs_g,
        fat_g: m.fat_g,
        est_cost: m.est_cost,
        est_cost_currency: m.est_cost == null ? null : (m.est_cost_currency ?? null),
        method: m.method,
        food_item_id: m.food_item_id ?? null,
        nutrition_source: m.nutrition_source ?? (m.calories != null ? 'user' : null),
        status: 'planned' as const,
        locked: false,
        client_updated_at: new Date().toISOString(),
      }
      patchRangeLists<PlannedMeal>(qc, qk.planned(uid), m.date, (rows) => upsertIn(rows, { ...row, scheduled_time: null, rationale: null, updated_at: row.client_updated_at } as PlannedMeal).sort(sortPlanned))
      await enqueue({ kind: 'upsert', table: 'planned_meals', row }, { label: `Add ${row.name}`, invalidate: [qk.planned(uid)] })
      return row.id
    },
  })
}

export function useDeletePlannedMeal() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (meal: PlannedMeal) => {
      patchLists<PlannedMeal>(qc, qk.planned(uid), (rows) => rows.filter((r) => r.id !== meal.id))
      await enqueue({ kind: 'delete', table: 'planned_meals', id: meal.id }, { label: `Remove ${meal.name}`, invalidate: [qk.planned(uid), qk.diary(uid)] })
    },
  })
}

export function useArchivePlan() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.from('meal_plans').update({ status: 'archived' }).eq('id', planId)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.activePlan(uid) })
      void qc.invalidateQueries({ queryKey: qk.planned(uid) })
    },
  })
}
