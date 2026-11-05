import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isSupabaseConfigured } from './env'

/**
 * Single browser client. Uses only the public anon key; every user-data
 * request is constrained by Row Level Security on the server.
 */
export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? env.supabaseUrl : 'http://localhost:54321',
  isSupabaseConfigured ? env.supabaseAnonKey : 'not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'dish-auth',
    },
  },
)

export const MEAL_IMAGE_BUCKET = 'meal-images'
export const SCAN_BUCKET = 'food-scans'

/** Resized catalogue image (Supabase image transformations; persistent, CDN-cached URL). */
export function mealImageUrl(path: string | null | undefined, width = 640): string | null {
  if (!path || !isSupabaseConfigured) return null
  const { data } = supabase.storage.from(MEAL_IMAGE_BUCKET).getPublicUrl(path, { transform: { width, quality: 72 } })
  return data.publicUrl
}

/** The stored file itself — used when image transformations aren't available on the project. */
export function mealImageOriginalUrl(path: string | null | undefined): string | null {
  if (!path || !isSupabaseConfigured) return null
  return supabase.storage.from(MEAL_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}
