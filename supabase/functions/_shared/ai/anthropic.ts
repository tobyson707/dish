// Claude adapter using the official Anthropic SDK with structured outputs
// (schema-constrained JSON, parsed and validated against the zod schema).
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { z } from 'zod'
import { AIError, type AIProvider, type StructuredRequest, type StructuredResult } from './provider.ts'

export function anthropicProvider(apiKey: string, textModel: string, visionModel: string): AIProvider {
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })
  return {
    name: 'anthropic',
    textModel,
    visionModel,
    async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
      const model = req.image ? visionModel : textModel
      const started = Date.now()
      const content: Anthropic.Beta.BetaContentBlockParam[] = []
      if (req.image) content.push({ type: 'image', source: { type: 'base64', media_type: req.image.mediaType, data: req.image.base64 } })
      content.push({ type: 'text', text: req.user })
      try {
        const res = await client.beta.messages.parse({
          model,
          max_tokens: req.maxTokens ?? 8000,
          system: req.system,
          messages: [{ role: 'user', content }],
          output_config: { format: betaZodOutputFormat(req.schema), effort: req.depth === 'careful' ? 'medium' : 'low' },
          // Server-side refusal fallback (routes by refusal category).
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
        if (res.stop_reason === 'refusal') throw new AIError('That request couldn’t be completed.', 'refused')
        if (res.stop_reason === 'max_tokens') throw new AIError('The answer was incomplete.', 'bad_output')
        if (res.parsed_output == null) throw new AIError('The answer couldn’t be read.', 'bad_output')
        return {
          data: res.parsed_output as z.infer<S>,
          model: res.model,
          inputTokens: res.usage?.input_tokens ?? null,
          outputTokens: res.usage?.output_tokens ?? null,
          latencyMs: Date.now() - started,
        }
      } catch (e) {
        if (e instanceof AIError) throw e
        if (e instanceof Anthropic.RateLimitError) throw new AIError('The service is busy. Please try again shortly.', 'rate_limited')
        if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AIError('That took too long.', 'timeout')
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AIError('This feature isn’t set up correctly on the server.', 'unavailable')
        if (e instanceof Anthropic.APIError) throw new AIError(`The service had a problem (${e.status ?? 'network'}).`, 'provider')
        throw new AIError('The answer couldn’t be read.', 'bad_output')
      }
    },
  }
}
