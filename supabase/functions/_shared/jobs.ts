// Audit + rate limiting for generation requests. Writes use the service role
// (users can read their own job rows, never write them). Request summaries
// are non-identifying (counts, ranges, flags) — no free-text preferences.
import type { SupabaseClient } from '@supabase/supabase-js'
import { admin } from './supabase.ts'
import { aiRateLimitPerHour } from './ai/provider.ts'
import { HttpError } from './http.ts'

export type JobKind = 'plan_block' | 'replace_meal' | 'surprise' | 'kitchen' | 'scan_food' | 'recipe_assist'

export async function startJob(userId: string, kind: JobKind, engine: string, opts: { model?: string | null; promptVersion?: string | null; summary?: Record<string, unknown>; usesAi: boolean }): Promise<string> {
  const { data, error } = await admin()
    .from('ai_generation_jobs')
    .insert({ user_id: userId, kind, engine, model: opts.model ?? null, prompt_version: opts.promptVersion ?? null, request_summary: opts.summary ?? {}, uses_ai: opts.usesAi })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function finishJob(id: string, patch: { status: 'succeeded' | 'failed' | 'fallback'; result?: Record<string, unknown>; error?: string; model?: string; inputTokens?: number | null; outputTokens?: number | null; latencyMs?: number; usesAi?: boolean }) {
  await admin()
    .from('ai_generation_jobs')
    .update({
      status: patch.status,
      result_summary: patch.result ?? null,
      error: patch.error?.slice(0, 300) ?? null,
      model: patch.model,
      input_tokens: patch.inputTokens ?? null,
      output_tokens: patch.outputTokens ?? null,
      latency_ms: patch.latencyMs ?? null,
      uses_ai: patch.usesAi,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)
}

/** Returns remaining AI calls this hour; throws 429 when none left. */
export async function checkAiQuota(db: SupabaseClient, throwIfNone = true): Promise<number> {
  const { data, error } = await db.rpc('ai_jobs_last_hour')
  if (error) throw error
  const remaining = Math.max(0, aiRateLimitPerHour() - Number(data ?? 0))
  if (remaining <= 0 && throwIfNone) throw new HttpError(429, "You've used DISH's AI a lot in the last hour. Please try again a little later.", 'rate_limited')
  return remaining
}

/** Cheap global guard for non-AI generation too (protects the database). */
export async function checkRequestBurst(userId: string, kind: JobKind, perMinute = 20) {
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await admin().from('ai_generation_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', kind).gte('created_at', since)
  if ((count ?? 0) >= perMinute) throw new HttpError(429, 'Slow down a little. Please try again in a minute.', 'rate_limited')
}
