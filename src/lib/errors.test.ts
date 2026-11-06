import { describe, expect, it } from 'vitest'
import { authProblem, friendlyError } from './errors'

const authErr = (code: string, message: string, status = 429) => Object.assign(new Error(message), { code, status, name: 'AuthApiError' })

describe('auth errors are mapped by code', () => {
  it('the project-wide email quota is never blamed on the person', () => {
    const p = authProblem(authErr('over_email_send_rate_limit', 'email rate limit exceeded'))!
    expect(p.message).toMatch(/isn't anything you did/)
    expect(p.message).not.toMatch(/done that a lot/)
    expect(p.retryAfter).toBeGreaterThan(0)
  })
  it('a per-address resend cooldown uses the seconds the server gives', () => {
    const p = authProblem(authErr('over_email_send_rate_limit', 'For security purposes, you can only request this after 42 seconds.'))!
    expect(p.retryAfter).toBe(42)
    expect(p.message).toContain('42 seconds')
    expect(p.message).toMatch(/just sent an email/)
  })
  it('a per-network limit says so', () => {
    expect(authProblem(authErr('over_request_rate_limit', 'Request rate limit reached'))!.message).toMatch(/your network/)
  })
  it('other codes', () => {
    expect(friendlyError(authErr('user_already_exists', 'User already registered', 422))).toMatch(/already exists/)
    expect(friendlyError(authErr('email_address_invalid', 'Email address "x@x" is invalid', 400))).toMatch(/can't receive mail/)
    expect(friendlyError(authErr('weak_password', 'Password should be at least 8 characters.', 422))).toBe('Password should be at least 8 characters.')
    expect(friendlyError(authErr('signup_disabled', 'Signups not allowed', 422))).toMatch(/paused/)
  })
  it('an unknown 429 is neutral', () => {
    expect(friendlyError({ message: 'Too many requests', status: 429 })).toBe('This is temporarily limited. Please wait a moment and try again.')
  })
})
