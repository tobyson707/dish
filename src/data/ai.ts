import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { AppError } from '@/lib/errors'
import { useUserId } from '@/features/auth/AuthProvider'
import type { MealSlot } from '@domain/types.ts'
import type { PlanDuration } from '@domain/types.ts'
import type { MealPlan, PlannedMeal } from '@/types/db'
import { qk } from './keys'
import { gamificationCheck } from '@/gamification/bus'

/** Invoke an Edge Function and surface its JSON error message. */
export async function invokeFn<T>(name: string, body: unknown): Promise<T> {
  if (!navigator.onLine) throw new AppError('This needs an internet connection. Try again when you are back online.', 'offline')
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let payload: { error?: string; code?: string } = {}
      try {
        payload = await error.context.json()
      } catch {
        /* non-JSON */
      }
      throw new AppError(payload.error ?? 'The server could not complete that request.', payload.code ?? String(error.context.status))
    }
    if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
      // The function couldn't be reached at all (not deployed yet, or a network/CORS failure).
      throw new AppError("DISH's server functions aren't reachable right now. If you run this app, check that the Supabase Edge Functions are deployed. Everything else still works.", 'functions_unreachable')
    }
    throw error
  }
  return data as T
}

export interface AIStatus {
  ai_configured: boolean
  vision_configured: boolean
  provider: string | null
  remaining_this_hour: number | null
}

export function useAIStatus() {
  return useQuery({
    queryKey: qk.aiStatus(),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => invokeFn<AIStatus>('ai-status', {}),
  })
}

export interface GeneratePlanInput {
  create?: { duration: PlanDuration; start_date: string; title?: string; replace_active?: boolean }
  plan_id?: string
  /** regenerate a range inside an existing plan; locked meals are kept */
  regenerate?: { from: string; to: string }
  /** generate the next weekly block of a long plan */
  next_block?: boolean
  today: string
}
export interface GeneratePlanResult {
  plan: MealPlan
  created: number
  kept_locked: number
  unfilled: { date: string; slot: MealSlot }[]
  engine: string
  ai_used: boolean
  notice?: string
}

export function useGeneratePlan() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: GeneratePlanInput) => invokeFn<GeneratePlanResult>('plan-generate', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.activePlan(uid) })
      void qc.invalidateQueries({ queryKey: qk.planned(uid) })
      gamificationCheck('plan')
    },
  })
}

export interface Suggestion {
  food_item_id: string
  name: string
  slug: string
  method: 'cook' | 'buy'
  reasons: string[]
  note?: string | null
  est_cost_min: number | null
  est_cost_max: number | null
  calories: number | null
  prep_minutes: number
  cook_minutes: number
  image_path: string | null
  allergy_status: 'no_known_conflict'
}

export function useReplaceMeal() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { planned_meal_id: string; choose_food_item_id?: string; exclude?: string[] }) => invokeFn<{ suggestions?: Suggestion[]; replaced?: PlannedMeal; engine: string; ai_used: boolean }>('meal-replace', input),
    onSuccess: (r) => {
      if (r.replaced) {
        void qc.invalidateQueries({ queryKey: qk.planned(uid) })
        gamificationCheck('plan')
      }
    },
  })
}

export interface SurpriseInput {
  slot: MealSlot
  method: 'cook' | 'buy' | 'any'
  max_budget: number | null
  max_minutes: number | null
  cuisine: string | null
  use_kitchen: boolean
  exclude: string[]
  today: string
}
export function useSurprise() {
  return useMutation({ mutationFn: (input: SurpriseInput) => invokeFn<{ suggestions: Suggestion[]; engine: string; ai_used: boolean; message?: string }>('surprise', input) })
}

export interface KitchenSuggestion extends Suggestion {
  available: string[]
  missing: { name: string; ingredient_id: string | null; category: string; quantity: number | null; unit: string | null }[]
  uses_soon: string[]
  can_make_now: boolean
}
export function useKitchenSuggest() {
  return useMutation({ mutationFn: (input: { slot: MealSlot | null; today: string }) => invokeFn<{ suggestions: KitchenSuggestion[]; engine: string; ai_used: boolean; tip?: string | null }>('kitchen-suggest', input) })
}

export interface ScanItem {
  name: string
  matched_food_item_id: string | null
  portion_description: string
  servings_estimate: number
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  confidence: 'low' | 'medium' | 'high'
  possible_ingredients: string[]
}
export interface ScanResult {
  items: ScanItem[]
  overall_confidence: 'low' | 'medium' | 'high'
  uncertainty_notes: string[]
  needs_user_input: boolean
  model: string
}
export function useScanFood() {
  return useMutation({ mutationFn: (input: { image_path: string }) => invokeFn<ScanResult>('scan-food', input) })
}
