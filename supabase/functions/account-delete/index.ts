import { handler, json } from '../_shared/http.ts'
import { authenticate } from '../_shared/supabase.ts'

/**
 * Kept for older app versions: it no longer deletes anything immediately. It schedules
 * deletion with the 30-day grace period (the same rules as the app: a recent sign-in is
 * required), and the scheduled job (account-purge) carries it out after the deadline.
 */
Deno.serve(
  handler(async (req) => {
    const { db } = await authenticate(req)
    const { data, error } = await db.rpc('request_account_deletion')
    if (error) return json({ error: error.message, code: error.hint === 'reauthenticate' ? 'reauthenticate' : 'refused' }, 403)
    return json({ scheduled: true, ...(data as object) })
  }),
)
