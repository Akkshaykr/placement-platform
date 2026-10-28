import { describe, expect, it } from 'vitest'
import { readCallbackError } from './callbackError'

describe('readCallbackError', () => {
  it('returns null when nothing went wrong', () => {
    expect(readCallbackError('?code=abc', '')).toBeNull()
  })
  it('reads errors from the query string or the hash', () => {
    expect(readCallbackError('?error=access_denied&error_description=Access+denied', '')).toBe('Access denied')
    expect(readCallbackError('', '#error=server_error&error_description=Link+expired')).toBe('Link expired')
    expect(readCallbackError('?error=access_denied', '')).toMatch(/cancelled or failed/)
  })
})
