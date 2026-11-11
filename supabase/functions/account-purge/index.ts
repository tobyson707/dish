// Carries out account deletions whose 30-day grace period has ended. Run on a schedule
// (daily, see .github/workflows/account-purge.yml) with the SERVICE ROLE key; it does
// nothing for anyone else. Safe to run as often as you like: each request is claimed
// atomically, re-checked (still requested, deadline passed) and finished idempotently.
import { handler, json, HttpError } from '../_shared/http.ts'
import { admin } from '../_shared/supabase.ts'

const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_ATTEMPTS = 5
const BUCKETS_BY_USER = ['food-scans'] // private files kept under <user id>/
const STALE_MS = 60 * 60 * 1000 // a run that died mid-way is picked up again after an hour

type Req = { id: string; user_id: string; delete_after: string; status: string; attempts: number; started_at: string | null }

Deno.serve(
  handler(async (req) => {
    if ((req.headers.get('authorization') ?? '') !== `Bearer ${SERVICE}`) throw new HttpError(401, 'Service role required', 'unauthorized')
    const svc = admin()
    const now = new Date()
    // due: scheduled or failed (and not given up) past the deadline, or stuck in processing
    const { data, error } = await svc
      .from('account_deletion_requests')
      .select('id, user_id, delete_after, status, attempts, started_at')
      .in('status', ['scheduled', 'failed', 'processing'])
      .lte('delete_after', now.toISOString())
      .lt('attempts', MAX_ATTEMPTS)
      .order('delete_after')
      .limit(50)
    if (error) throw error
    const results: { id: string; outcome: string }[] = []
    for (const r of (data ?? []) as Req[]) {
      if (r.status === 'processing' && r.started_at && now.getTime() - new Date(r.started_at).getTime() < STALE_MS) continue
      // claim it: only if it is still what we read (a cancellation in between wins)
      const { data: claimed, error: claimErr } = await svc
        .from('account_deletion_requests')
        .update({ status: 'processing', started_at: now.toISOString(), attempts: r.attempts + 1, last_error: null })
        .eq('id', r.id)
        .eq('status', r.status)
        .lte('delete_after', now.toISOString())
        .select('id')
      if (claimErr) throw claimErr
      if (!claimed?.length) {
        results.push({ id: r.id, outcome: 'skipped (changed meanwhile)' })
        continue
      }
      try {
        await purge(svc, r.user_id)
        await svc.from('account_deletion_requests').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', r.id)
        results.push({ id: r.id, outcome: 'completed' })
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 300)
        console.error('[account-purge]', r.id, msg) // the request id only, never personal data
        await svc.from('account_deletion_requests').update({ status: 'failed', last_error: msg }).eq('id', r.id)
        results.push({ id: r.id, outcome: 'failed' })
      }
    }
    return json({ processed: results.length, results })
  }),
)

/** Idempotent: every step tolerates having run before (a retry after a partial run is fine). */
async function purge(svc: ReturnType<typeof admin>, userId: string) {
  const { data: u } = await svc.auth.admin.getUserById(userId)
  if (!u?.user) return // already gone: nothing left to do
  // 1. anonymise what lives on in other people's plans; learn which cover images to remove
  const { data: info, error } = await svc.rpc('purge_account_data', { p_user: userId })
  if (error) throw error
  const covers = ((info as { covers?: string[] } | null)?.covers ?? []).filter(Boolean)
  // 2. their files
  for (let i = 0; i < covers.length; i += 100) {
    const { error: e } = await svc.storage.from('plan-covers').remove(covers.slice(i, i + 100))
    if (e) throw e
  }
  for (const bucket of BUCKETS_BY_USER) {
    for (;;) {
      const { data: files, error: e } = await svc.storage.from(bucket).list(userId, { limit: 100 })
      if (e) throw e
      if (!files?.length) break
      const { error: rm } = await svc.storage.from(bucket).remove(files.map((f) => `${userId}/${f.name}`))
      if (rm) throw rm
      if (files.length < 100) break
    }
  }
  // 3. the account itself: sessions and sign-in end, and every row they own goes with it (cascades)
  const { error: del } = await svc.auth.admin.deleteUser(userId)
  if (del && !/not.?found/i.test(del.message)) throw del
}
