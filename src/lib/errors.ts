// Turns Supabase / network / function errors into calm, user-facing copy.
export class AppError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = String((e as { message?: string })?.message ?? e)
  return /Failed to fetch|NetworkError|Load failed|network request failed|fetch failed|ERR_INTERNET/i.test(msg)
}

export function isConflictError(e: unknown): boolean {
  const err = e as { code?: string; message?: string }
  return err?.code === 'DS409' || /stale_write/.test(err?.message ?? '')
}

export function friendlyError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isNetworkError(e)) return "You're offline or the connection dropped. Check your connection and try again."
  const err = e as { message?: string; code?: string; status?: number; context?: { status?: number } }
  const msg = err?.message ?? ''
  if (/Invalid login credentials/i.test(msg)) return 'That email and password combination did not work.'
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.'
  if (/User already registered/i.test(msg)) return 'An account with this email already exists. Try signing in.'
  if (/Password should be/i.test(msg)) return msg
  if (/rate limit|too many/i.test(msg) || err?.status === 429) return "You've done that a lot in a short time. Please wait a moment and try again."
  if (/JWT|not authenticated|401/i.test(msg)) return 'Your session has expired. Please sign in again.'
  if (err instanceof AppError) return err.message
  if (msg && msg.length < 160 && !/^[A-Z_]+$/.test(msg) && !/violates|syntax|relation|column/i.test(msg)) return msg
  return fallback
}
