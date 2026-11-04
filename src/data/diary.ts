import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import { enqueue } from '@/offline/outbox'
import { uuid } from '@/lib/ids'
import type { MealSlot, NutritionSource } from '@domain/types.ts'
import type { DiaryEntry, NutritionEntry } from '@/types/db'
import { persistMeta, qk } from './keys'
import { patchLists, patchRangeLists, upsertIn } from './optimistic'

export function useDiary(from: string, to: string) {
  const uid = useUserId()
  return useQuery({
    queryKey: qk.diaryRange(uid, from, to),
    meta: persistMeta(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('food_diary_entries')
        .select('*, nutrition:nutrition_entries(*)')
        .eq('user_id', uid)
        .gte('local_date', from)
        .lte('local_date', to)
        .order('local_date', { ascending: false })
        .order('eaten_at', { ascending: true })
        .limit(500) // bounded history query
      if (error) throw error
      return (data ?? []) as DiaryEntry[]
    },
  })
}

export interface DiaryInput {
  id?: string
  local_date: string
  slot: MealSlot
  name: string
  servings: number
  serving_desc?: string | null
  source: DiaryEntry['source']
  food_item_id?: string | null
  planned_meal_id?: string | null
  scan_image_path?: string | null
  notes?: string | null
  nutrition: {
    calories: number | null
    protein_g: number | null
    carbs_g: number | null
    fat_g: number | null
    source: NutritionSource
    is_estimate: boolean
    confidence?: number | null
    review?: Record<string, unknown> | null
  }
}

/** Create or edit a diary entry. Works offline: queued and synced idempotently by id. */
export function useLogDiary() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: DiaryInput) => {
      const id = input.id ?? uuid()
      const now = new Date().toISOString()
      const entry = {
        id,
        local_date: input.local_date,
        eaten_at: now,
        slot: input.slot,
        name: input.name.trim(),
        food_item_id: input.food_item_id ?? null,
        planned_meal_id: input.planned_meal_id ?? null,
        servings: input.servings,
        serving_desc: input.serving_desc ?? null,
        source: input.source,
        scan_image_path: input.scan_image_path ?? null,
        notes: input.notes ?? null,
        client_updated_at: now,
      }
      const optimistic: DiaryEntry = {
        ...entry,
        user_id: uid,
        nutrition: { id: `local-${id}`, diary_entry_id: id, version: 1, confidence: null, review: null, ...input.nutrition } as NutritionEntry,
        _pending: true,
      }
      if (input.id) patchLists<DiaryEntry>(qc, qk.diary(uid), (rows) => rows.filter((r) => r.id !== id))
      patchRangeLists<DiaryEntry>(qc, qk.diary(uid), input.local_date, (rows) => upsertIn(rows, optimistic))
      await enqueue(
        { kind: 'rpc', fn: 'log_diary_entry', args: { entry, nutrition: input.nutrition } },
        { label: `${input.id ? 'Update' : 'Log'} ${entry.name}`, invalidate: [qk.diary(uid), qk.planned(uid)] },
      )
      return id
    },
  })
}

export function useDeleteDiary() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: DiaryEntry) => {
      patchLists<DiaryEntry>(qc, qk.diary(uid), (rows) => rows.filter((r) => r.id !== e.id))
      await enqueue({ kind: 'delete', table: 'food_diary_entries', id: e.id }, { label: `Delete ${e.name}`, invalidate: [qk.diary(uid), qk.planned(uid)] })
    },
  })
}
