import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useUserId } from '@/features/auth/AuthProvider'
import type { FoodImageJob, FoodImageStatus } from '@/types/db'
import type { FoodPhotoQcId } from '@domain/foodPhoto.ts'
import { invokeFn } from './ai'
import { qk } from './keys'

/** Server-checked admin flag (public.app_admins). Hides the studio from everyone else. */
export function useIsAdmin() {
  const uid = useUserId()
  return useQuery({
    queryKey: ['is-admin', uid],
    enabled: !!uid,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_admin')
      if (error) return false
      return !!data
    },
  })
}

export interface ImageStudioStatus {
  configured: boolean
  provider: string | null
  models: { standard: string; featured: string } | null
  prompt_version: string
  art_direction: string
  daily_limit: number
  used_today: number
  queued: number
  running: number
  awaiting_review: number
}

export interface StudioRecipe {
  id: string
  slug: string
  name: string
  cuisine: string
  meal_types: string[]
  image_path: string | null
  image_generation_status: FoodImageStatus
  image_model: string | null
  image_generated_at: string | null
}

const STUDIO = ['image-studio'] as const

export function useImageStudioStatus(poll: boolean) {
  return useQuery({
    queryKey: [...STUDIO, 'status'],
    queryFn: () => invokeFn<ImageStudioStatus>('food-images', { action: 'status' }),
    refetchInterval: poll ? 4000 : false,
  })
}

/** Catalogue rows with image state + every job (admin-only via RLS). */
export function useImageStudioData(poll: boolean) {
  return useQuery({
    queryKey: [...STUDIO, 'data'],
    refetchInterval: poll ? 4000 : false,
    queryFn: async () => {
      const [foods, jobs] = await Promise.all([
        supabase.from('food_items').select('id, slug, name, cuisine, meal_types, image_path, image_generation_status, image_model, image_generated_at').order('name'),
        supabase.from('food_image_jobs').select('*').order('created_at', { ascending: false }).limit(500),
      ])
      if (foods.error) throw foods.error
      if (jobs.error) throw jobs.error
      const latest = new Map<string, FoodImageJob>()
      for (const j of (jobs.data ?? []) as FoodImageJob[]) if (!latest.has(j.food_item_id)) latest.set(j.food_item_id, j)
      return { recipes: (foods.data ?? []) as StudioRecipe[], latest, jobs: (jobs.data ?? []) as FoodImageJob[] }
    },
  })
}

type Action =
  | { action: 'enqueue'; food_item_ids: string[]; variant: 'standard' | 'featured'; regenerate?: boolean }
  | { action: 'approve'; job_id: string; qc: Record<FoodPhotoQcId, true>; notes?: string }
  | { action: 'reject'; job_id: string; notes?: string }
  | { action: 'retry'; job_id: string }
  | { action: 'cancel'; job_id: string }
  | { action: 'process' }

export function useImageStudioAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (a: Action) => invokeFn<{ queued?: number; skipped?: { id: string; reason: string }[] }>('food-images', a),
    onSettled: (_d, _e, a) => {
      void qc.invalidateQueries({ queryKey: STUDIO })
      // an approval publishes a new photo everywhere the catalogue is shown
      if (a.action === 'approve') void qc.invalidateQueries({ queryKey: qk.catalogue() })
    },
  })
}
