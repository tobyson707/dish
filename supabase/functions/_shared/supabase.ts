import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { HttpError } from './http.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export interface Ctx {
  user: User
  /** Acts as the user: every query is constrained by RLS. Use this by default. */
  db: SupabaseClient
}

/** Authenticate the caller from the Authorization header. Rejects anon/service tokens. */
export async function authenticate(req: Request): Promise<Ctx> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token || token === ANON) throw new HttpError(401, 'Please sign in to continue.', 'unauthenticated')
  const db = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Your session has expired. Please sign in again.', 'unauthenticated')
  return { user: data.user, db }
}

/** Privileged client. Only for operations RLS can't express (audit rows, storage reads, account deletion). */
export function admin(): SupabaseClient {
  return createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
}
