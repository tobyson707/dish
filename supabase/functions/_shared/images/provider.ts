// Provider-independent image generation. Feature code depends only on this file;
// vendors are adapters chosen by the IMAGE_PROVIDER secret. Adding a vendor =
// one adapter implementing `ImageProvider` + a case in getImageProvider().
//
// Secrets (server only, never sent to the browser):
//   IMAGE_PROVIDER         openai | mock          (unset = image generation off)
//   IMAGE_API_KEY          provider key (falls back to OPENAI_API_KEY)
//   IMAGE_MODEL_FEATURED   default gpt-image-2.5-sunburst  (hero images)
//   IMAGE_MODEL_STANDARD   default gpt-image-2.5-flare     (routine catalogue)
//   IMAGE_DAILY_LIMIT      max generations per 24 h, default 40
import type { FoodPhotoVariant } from '../domain/foodPhoto.ts'
import { MOCK_WEBP_BASE64 } from './mock-image.ts'

export interface ImageRequest {
  prompt: string
  size: '1536x1024' | '1024x1024' | '1024x1536'
  variant: FoodPhotoVariant
}

export interface ImageResult {
  bytes: Uint8Array
  model: string
  latencyMs: number
}

export interface ImageProvider {
  name: string
  modelFor(variant: FoodPhotoVariant): string
  generate(req: ImageRequest): Promise<ImageResult>
}

export class ImageGenError extends Error {
  constructor(message: string, public kind: 'rate_limited' | 'refused' | 'bad_request' | 'timeout' | 'provider' | 'bad_output', public retriable: boolean) {
    super(message)
  }
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

function models() {
  return {
    featured: Deno.env.get('IMAGE_MODEL_FEATURED')?.trim() || 'gpt-image-2.5-sunburst',
    standard: Deno.env.get('IMAGE_MODEL_STANDARD')?.trim() || 'gpt-image-2.5-flare',
  }
}

/** OpenAI Images API (GPT Image models): POST /v1/images/generations, base64 output. */
function openaiProvider(key: string): ImageProvider {
  const m = models()
  return {
    name: 'openai',
    modelFor: (v) => (v === 'featured' ? m.featured : m.standard),
    async generate(req) {
      const model = req.variant === 'featured' ? m.featured : m.standard
      const t0 = Date.now()
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 170_000)
      let res: Response
      try {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          signal: ctrl.signal,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt: req.prompt,
            n: 1,
            size: req.size,
            quality: req.variant === 'featured' ? 'high' : 'medium',
            output_format: 'webp',
            output_compression: 82,
          }),
        })
      } catch (e) {
        throw new ImageGenError((e as Error).name === 'AbortError' ? 'The image provider timed out.' : 'Could not reach the image provider.', 'timeout', true)
      } finally {
        clearTimeout(timer)
      }
      const text = await res.text()
      let body: { data?: { b64_json?: string }[]; error?: { message?: string; code?: string } } = {}
      try {
        body = JSON.parse(text)
      } catch {
        /* non-JSON error page */
      }
      if (!res.ok) {
        // Provider messages are safe to show admins (no secrets); trim them.
        const msg = (body.error?.message ?? `HTTP ${res.status}`).slice(0, 240)
        if (res.status === 429) throw new ImageGenError(`Provider rate limit: ${msg}`, 'rate_limited', true)
        if (res.status >= 500) throw new ImageGenError(`Provider error: ${msg}`, 'provider', true)
        if (body.error?.code === 'moderation_blocked' || /safety|policy/i.test(msg)) throw new ImageGenError(`Refused by the provider: ${msg}`, 'refused', false)
        throw new ImageGenError(`Request rejected: ${msg}`, 'bad_request', false)
      }
      const b64 = body.data?.[0]?.b64_json
      if (!b64) throw new ImageGenError('The provider returned no image data.', 'bad_output', true)
      return { bytes: b64ToBytes(b64), model, latencyMs: Date.now() - t0 }
    },
  }
}

/** Deterministic placeholder for local development and automated tests. Never for production. */
function mockProvider(): ImageProvider {
  return {
    name: 'mock',
    modelFor: () => 'mock-image',
    async generate(req) {
      if (/\bFAIL-IMAGE\b/.test(req.prompt)) throw new ImageGenError('Mock provider failure (test).', 'provider', true)
      await new Promise((r) => setTimeout(r, 300))
      return { bytes: b64ToBytes(MOCK_WEBP_BASE64), model: 'mock-image', latencyMs: 300 }
    },
  }
}

export function getImageProvider(): ImageProvider | null {
  const name = (Deno.env.get('IMAGE_PROVIDER') ?? '').trim().toLowerCase()
  if (name === 'mock') return mockProvider()
  const key = Deno.env.get('IMAGE_API_KEY') || Deno.env.get('OPENAI_API_KEY') || ''
  if (!name || !key) return null
  switch (name) {
    case 'openai':
      return openaiProvider(key)
    default:
      console.warn(`IMAGE_PROVIDER "${name}" has no adapter; image generation disabled`)
      return null
  }
}

export function imageDailyLimit(): number {
  const n = Number(Deno.env.get('IMAGE_DAILY_LIMIT') ?? 40)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 40
}
