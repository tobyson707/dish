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

export interface AuthProblem {
  message: string
  /** a temporary restriction: how long to wait before trying again (seconds) */
  retryAfter: number | null
}

/**
 * Supabase Auth errors by their error code, not by guessing from the text. The two
 * rate limits are different things and must never share a message:
 * - over_email_send_rate_limit: the auth server's email quota. On the built-in email
 *   service it is shared by the whole project, so one person can hit it without
 *   having done anything. Per-address cooldowns ("you can only request this after
 *   N seconds") use the same code.
 * - over_request_rate_limit: too many auth requests from one network (per IP).
 */
export function authProblem(e: unknown): AuthProblem | null {
  const err = e as { code?: string; message?: string; status?: number }
  const msg = err?.message ?? ''
  const wait = /after (\d+) seconds?/i.exec(msg)
  switch (err?.code) {
    case 'over_email_send_rate_limit':
      if (wait) return { message: `We've just sent an email to this address. Check your inbox and spam folder; a new one can be sent in ${wait[1]} seconds.`, retryAfter: Number(wait[1]) }
      return { message: "We couldn't send your confirmation email right now because DISH is sending a lot of emails. Nothing was saved, and this isn't anything you did. Please try again in a few minutes.", retryAfter: 120 }
    case 'over_request_rate_limit':
      return { message: 'There have been a lot of sign-in attempts from your network. Please wait a minute and try again.', retryAfter: 60 }
    case 'user_already_exists':
    case 'email_exists':
      return { message: 'An account with this email already exists. Try signing in.', retryAfter: null }
    case 'email_address_invalid':
      return { message: "That email address can't receive mail. Check it and try again.", retryAfter: null }
    case 'weak_password':
      return { message: msg || 'Choose a stronger password.', retryAfter: null }
    case 'signup_disabled':
      return { message: 'New sign-ups are paused at the moment. Please try again later.', retryAfter: null }
    case 'captcha_failed':
      return { message: "We couldn't confirm you're a person. Please try again.", retryAfter: null }
  }
  return null
}

export function friendlyError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isNetworkError(e)) return "You're offline or the connection dropped. Check your connection and try again."
  const auth = authProblem(e)
  if (auth) return auth.message
  const err = e as { message?: string; code?: string; status?: number; context?: { status?: number } }
  const msg = err?.message ?? ''
  if (/Invalid login credentials/i.test(msg)) return 'That email and password combination did not work.'
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.'
  if (/User already registered/i.test(msg)) return 'An account with this email already exists. Try signing in.'
  if (/Password should be/i.test(msg)) return msg
  // any other limit (our own functions, storage): say what it is without blaming the person
  if (/rate limit|too many/i.test(msg) || err?.status === 429) return 'This is temporarily limited. Please wait a moment and try again.'
  if (/JWT|not authenticated|401/i.test(msg)) return 'Your session has expired. Please sign in again.'
  if (err instanceof AppError) return err.message
  if (msg && msg.length < 160 && !/^[A-Z_]+$/.test(msg) && !/violates|syntax|relation|column/i.test(msg)) return msg
  return fallback
}
