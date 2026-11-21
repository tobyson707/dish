import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import type { CheckedRecipe, Rejection } from '@domain/recipeValidation.ts'
import type { Allergen, DietPattern, MealSlot } from '@domain/types.ts'
import type { FoodItem } from '@/types/db'
import { FOOD_SELECT, useCatalogue } from './catalogue'
import { invokeFn } from './ai'
import { qk } from './keys'

export type RecipeMode = 'generate' | 'use_ingredients' | 'cuisine' | 'surprise' | 'alternatives' | 'variation'

export interface RecipeRequest {
  ingredients?: string[]
  cuisine?: string | null
  country?: string | null
  category?: MealSlot | null
  diet?: DietPattern | null
  avoid?: string[]
  allergies?: Allergen[]
  max_minutes?: number | null
  difficulty?: 'easy' | 'medium' | 'hard' | null
  servings?: number | null
  budget?: 'thrifty' | 'moderate' | null
  use_kitchen?: boolean
  notes?: string | null
  parent_id?: string | null
  variation?: string | null
  count?: number
}

export interface GeneratedRecipe extends CheckedRecipe {
  /** a curated DISH recipe with the same name (shown instead of duplicating it) */
  similar_catalogue?: { slug: string; name: string } | null
}

export interface RecipeGeneration {
  id: string
  mode: RecipeMode
  request: Record<string, unknown> & { ingredients?: string[]; cuisine?: string | null; category?: MealSlot | null; parent?: { name: string } | null; variation?: string | null }
  status: 'succeeded' | 'failed'
  recipes: GeneratedRecipe[]
  validation: { rejected?: Rejection[]; unable_reason?: string | null; kitchen_notes?: string[] }
  saved_food_ids: string[]
  parent_food_item_id: string | null
  model: string | null
  created_at: string
}

export interface GenerateResponse {
  generation: RecipeGeneration
  cached: boolean
  ai_used: boolean
  provider: string
  kitchen_notes: string[]
}

const aiKey = (uid: string) => ['ai-recipes', uid]
const genKey = (uid: string) => ['recipe-generations', uid]

/** The person's own AI recipes (and any shared with them through a plan). Private; never in the public catalogue. */
export function useAiRecipes() {
  const uid = useUserId()
  return useQuery({
    queryKey: aiKey(uid),
    enabled: !!uid,
    meta: { persist: true, userId: uid },
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('food_items').select(FOOD_SELECT).eq('origin', 'ai').order('created_at', { ascending: false })
      if (error) throw error
      const items = (data ?? []) as FoodItem[]
      for (const f of items) f.recipe?.recipe_ingredients.sort((a, b) => a.sort - b.sort)
      return items
    },
  })
}

/**
 * Every food this person can open: the curated catalogue plus their AI recipes. Use it to
 * look a food up by id or slug (plans, saved, shopping, the recipe page); discovery feeds and
 * the planner use the curated catalogue only.
 */
export function useFoods() {
  const cat = useCatalogue()
  const mine = useAiRecipes()
  const data = useMemo(() => (cat.data ? [...cat.data, ...(mine.data ?? [])] : undefined), [cat.data, mine.data])
  return { ...cat, data, isPending: cat.isPending || mine.isLoading, refetch: async () => { await mine.refetch(); return cat.refetch() } }
}

/** Past generations (newest first), so earlier results can be revisited without asking again. */
export function useRecipeGenerations(limit = 20) {
  const uid = useUserId()
  return useQuery({
    queryKey: [...genKey(uid), limit],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('recipe_generations').select('*').order('created_at', { ascending: false }).limit(limit)
      if (error) throw error
      return (data ?? []) as RecipeGeneration[]
    },
  })
}

export function useRecipeGeneration(id: string | null) {
  const uid = useUserId()
  return useQuery({
    queryKey: [...genKey(uid), 'one', id],
    enabled: !!uid && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('recipe_generations').select('*').eq('id', id!).single()
      if (error) throw error
      return data as RecipeGeneration
    },
  })
}

export function useGenerateRecipes() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { mode: RecipeMode; input: RecipeRequest; fresh?: boolean; today?: string }) => invokeFn<GenerateResponse>('recipe-generate', { action: 'generate', ...v }),
    onSuccess: (r) => {
      qc.setQueryData([...genKey(uid), 'one', r.generation.id], r.generation)
      void qc.invalidateQueries({ queryKey: genKey(uid) })
    },
  })
}

/** Store a generated recipe as the person's own (idempotent: the same recipe is never stored twice). */
export function useSaveGenerated() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { generationId: string; index: number }) => invokeFn<{ food_item: { id: string; slug: string }; already_saved: boolean }>('recipe-generate', { action: 'save', generation_id: v.generationId, index: v.index }),
    onSuccess: async (r, v) => {
      qc.setQueriesData<RecipeGeneration>({ queryKey: [...genKey(uid), 'one', v.generationId] }, (g) => (g && !g.saved_food_ids.includes(r.food_item.id) ? { ...g, saved_food_ids: [...g.saved_food_ids, r.food_item.id] } : g))
      void qc.invalidateQueries({ queryKey: genKey(uid) })
      // the food must be loadable before anything uses it (plans, shopping, the recipe page)
      await qc.refetchQueries({ queryKey: aiKey(uid) })
    },
  })
}

export function useDeleteAiRecipe() {
  const uid = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('food_items').delete().eq('id', id).eq('origin', 'ai')
      if (error) throw error
    },
    onSuccess: (_r, id) => {
      qc.setQueryData<FoodItem[]>(aiKey(uid), (old) => old?.filter((f) => f.id !== id))
      void qc.invalidateQueries({ queryKey: aiKey(uid) })
      void qc.invalidateQueries({ queryKey: qk.favourites(uid) })
      void qc.invalidateQueries({ queryKey: genKey(uid) })
    },
  })
}

export const KIND_LABEL: Record<CheckedRecipe['kind'], string> = {
  traditional: 'Traditional style',
  adaptation: 'Adapted',
  fusion: 'Fusion',
  original: 'New idea',
}
export const KIND_HELP: Record<CheckedRecipe['kind'], string> = {
  traditional: 'Written in the style the dish is commonly made, by AI. Home cooks make it many ways.',
  adaptation: 'A known dish, changed by AI for your request.',
  fusion: 'AI combined more than one food tradition.',
  original: 'A new dish written by AI.',
}
