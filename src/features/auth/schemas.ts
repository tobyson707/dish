import { z } from 'zod'

export const emailSchema = z.string().trim().min(1, 'Enter your email').email('That email address looks incomplete')
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number')

export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const i of err.issues) {
    const k = String(i.path[0] ?? 'form')
    if (!out[k]) out[k] = i.message
  }
  return out
}
