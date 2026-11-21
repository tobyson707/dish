import { handler, json } from '../_shared/http.ts'
import { authenticate } from '../_shared/supabase.ts'
import { getProvider } from '../_shared/ai/provider.ts'
import { checkAiQuota } from '../_shared/jobs.ts'

// Tells the UI which AI features are available, so it can show an honest
// "not configured" state rather than failing later.
Deno.serve(
  handler(async (req) => {
    const { db } = await authenticate(req)
    const p = getProvider()
    const r = getProvider('recipes')
    return json({
      // recipe generation (may be the local test provider on a developer's machine)
      recipes_configured: !!r,
      recipes_provider: r?.name ?? null,
      ai_configured: !!p,
      vision_configured: !!p?.visionModel,
      provider: p?.name ?? null,
      remaining_this_hour: p || r ? await checkAiQuota(db, false) : null,
    })
  }),
)
