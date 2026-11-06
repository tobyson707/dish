export type DishEnv = 'development' | 'preview' | 'production'

/**
 * The environment this build is running in. Vercel's VERCEL_ENV decides on
 * deployments; a local build pointed at a local Supabase stack is development.
 * Unknown means production: the safe default.
 */
export function dishEnv(): DishEnv {
  const v = (import.meta.env.VITE_DISH_ENV as string | undefined) ?? ''
  if (v === 'development' || v === 'preview' || v === 'production') return v
  if (import.meta.env.DEV) return 'development'
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  return /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url) ? 'development' : 'production'
}

export const ENV_LABEL: Record<DishEnv, string> = { development: 'Development', preview: 'Preview', production: 'Production' }
