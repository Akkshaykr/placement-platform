import { describe, expect, it } from 'vitest'
import { toAppError } from './errors'

describe('toAppError', () => {
  it('turns a coded database error into its code and message', () => {
    expect(toAppError({ message: 'NOT_OPEN: This challenge has not started yet.' })).toEqual({
      code: 'NOT_OPEN',
      message: 'This challenge has not started yet.',
    })
  })

  it('keeps the message of a coded validation error', () => {
    expect(toAppError({ message: 'VALIDATION: Provide 2 to 6 options.' })).toEqual({
      code: 'VALIDATION',
      message: 'Provide 2 to 6 options.',
    })
  })

  it('maps a permission failure without exposing the database text', () => {
    const err = toAppError({ message: 'permission denied for function admin_save_question', code: '42501' })
    expect(err.code).toBe('FORBIDDEN')
    expect(err.message).not.toContain('permission denied for function')
  })

  it('treats an unrecognised code as unknown and never shows internal text', () => {
    const err = toAppError({ message: 'DROP TABLE secret: boom' })
    expect(err).toEqual({ code: 'UNKNOWN', message: 'Something went wrong. Please try again.' })
  })

  it('reports a network failure as NETWORK so the answer queue can retry', () => {
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe('NETWORK')
  })
})
