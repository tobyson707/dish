// Public (browser-safe) configuration only. Server secrets never use the VITE_ prefix.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const env = {
  supabaseUrl: url?.trim() || '',
  supabaseAnonKey: anonKey?.trim() || '',
  googleAuth: import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true',
  vapidPublicKey: (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || '',
}

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
