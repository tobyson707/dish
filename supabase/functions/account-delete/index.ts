import { z } from 'zod'
import { handler, json, parseBody } from '../_shared/http.ts'
import { admin, authenticate } from '../_shared/supabase.ts'

const Body = z.object({ confirm: z.literal('DELETE') })

/**
 * Permanently deletes the caller's account: private storage objects first,
 * then the auth user (all user-owned rows cascade via foreign keys).
 */
Deno.serve(
  handler(async (req, raw) => {
    const { user } = await authenticate(req)
    parseBody(Body, raw)
    const svc = admin()
    // Remove every object in the user's private folder (paginated).
    for (;;) {
      const { data, error } = await svc.storage.from('food-scans').list(user.id, { limit: 100 })
      if (error) throw error
      if (!data?.length) break
      const { error: rmErr } = await svc.storage.from('food-scans').remove(data.map((o) => `${user.id}/${o.name}`))
      if (rmErr) throw rmErr
      if (data.length < 100) break
    }
    const { error } = await svc.auth.admin.deleteUser(user.id)
    if (error) throw error
    return json({ deleted: true })
  }),
)
