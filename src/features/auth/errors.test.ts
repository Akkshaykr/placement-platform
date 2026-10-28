import { describe, expect, it } from 'vitest'
import { describeAuthError } from './errors'

describe('describeAuthError', () => {
  it('maps known Supabase codes to friendly messages', () => {
    expect(describeAuthError({ code: 'invalid_credentials' }).message).toMatch(/incorrect/)
    expect(describeAuthError({ code: 'email_not_confirmed' }).code).toBe('email_not_confirmed')
    expect(describeAuthError({ code: 'over_request_rate_limit' }).message).toMatch(/Too many/)
  })

  it('recognises network failures', () => {
    expect(describeAuthError({ name: 'AuthRetryableFetchError', status: 0 }).code).toBe('network')
    expect(describeAuthError({ status: 0 }).code).toBe('network')
  })

  it('never leaks raw provider messages for unknown errors', () => {
    const r = describeAuthError({ code: 'weird', message: 'SECRET internal detail' })
    expect(r.message).not.toMatch(/SECRET/)
    expect(describeAuthError(new Error('boom: stack trace')).message).not.toMatch(/boom/)
    expect(describeAuthError(null).code).toBe('unknown')
  })
})
