// Provider-independent AI interface. Feature code depends only on this file;
// vendors are adapters selected by the AI_PROVIDER secret. Adding a vendor =
// one new adapter implementing `AIProvider` + a case in getProvider().
import type { z } from 'zod'
import { anthropicProvider } from './anthropic.ts'

export interface StructuredRequest<S extends z.ZodType> {
  /** short task id for logs/audit, e.g. "plan_rank" */
  task: string
  system: string
  user: string
  schema: S
  image?: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }
  maxTokens?: number
  /** relative depth of reasoning; adapters map this to vendor settings */
  depth?: 'fast' | 'careful'
}

export interface StructuredResult<T> {
  data: T
  model: string
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
}

export interface AIProvider {
  name: string
  textModel: string
  visionModel: string | null
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>>
}

export class AIError extends Error {
  constructor(message: string, public kind: 'unavailable' | 'rate_limited' | 'refused' | 'bad_output' | 'timeout' | 'provider') {
    super(message)
  }
}

export function getProvider(): AIProvider | null {
  const name = (Deno.env.get('AI_PROVIDER') ?? '').trim().toLowerCase()
  const key = Deno.env.get('AI_API_KEY') ?? ''
  if (!name || !key) return null
  switch (name) {
    case 'anthropic':
      return anthropicProvider(key, Deno.env.get('AI_MODEL_TEXT') || 'claude-opus-5-5', Deno.env.get('AI_MODEL_VISION') || 'claude-opus-5-5')
    default:
      console.warn(`AI_PROVIDER "${name}" has no adapter; AI features disabled`)
      return null
  }
}

export function aiRateLimitPerHour(): number {
  const n = Number(Deno.env.get('AI_RATE_LIMIT_PER_HOUR') ?? 30)
  return Number.isFinite(n) && n > 0 ? n : 30
}
