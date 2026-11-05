// Public (browser-safe) configuration only. Server secrets never use the VITE_ prefix.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// A relative URL (e.g. "/__supabase") is resolved against the current origin, so a
// dev server can proxy Supabase on the same port (see vite.config.ts server.proxy).
const resolveUrl = (u: string | undefined) => {
  const v = u?.trim() || ''
  return v.startsWith('/') && typeof window !== 'undefined' ? `${window.location.origin}${v.replace(/\/$/, '')}` : v
}

export const env = {
  supabaseUrl: resolveUrl(url),
  supabaseAnonKey: anonKey?.trim() || '',
  googleAuth: import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true',
  vapidPublicKey: (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || '',
}

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
