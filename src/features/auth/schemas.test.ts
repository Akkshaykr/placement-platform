import { describe, expect, it } from 'vitest'
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from './schemas'

const validRegister = { displayName: 'Ada Lovelace', email: 'ada@example.test', password: 'correct-horse-9', confirmPassword: 'correct-horse-9' }

describe('auth schemas', () => {
  it('accepts a valid registration and trims the name and email', () => {
    const r = registerSchema.parse({ ...validRegister, displayName: '  Ada  ', email: '  ada@example.test ' })
    expect(r.displayName).toBe('Ada')
    expect(r.email).toBe('ada@example.test')
  })

  it('requires a name, a valid email and a long-enough password', () => {
    expect(registerSchema.safeParse({ ...validRegister, displayName: '   ' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...validRegister, displayName: 'x'.repeat(61) }).success).toBe(false)
    expect(registerSchema.safeParse({ ...validRegister, email: 'nope' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...validRegister, password: 'short1', confirmPassword: 'short1' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...validRegister, password: 'x'.repeat(73), confirmPassword: 'x'.repeat(73) }).success).toBe(false)
  })

  it('reports a mismatch on the confirmation field', () => {
    const r = registerSchema.safeParse({ ...validRegister, confirmPassword: 'different-pass-1' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['confirmPassword'])
  })

  it('login only needs a non-empty password (never reveal password rules at sign-in)', () => {
    expect(loginSchema.safeParse({ email: 'a@b.test', password: 'x' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: 'a@b.test', password: '' }).success).toBe(false)
  })

  it('validates the forgot and reset forms', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'bad' }).success).toBe(false)
    expect(resetPasswordSchema.safeParse({ password: 'long-enough-1', confirmPassword: 'long-enough-1' }).success).toBe(true)
    expect(resetPasswordSchema.safeParse({ password: 'long-enough-1', confirmPassword: 'other' }).success).toBe(false)
  })
})
