import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safeRedirect'

describe('safeNextPath (open-redirect protection)', () => {
  it('keeps ordinary same-site paths, including query and hash', () => {
    expect(safeNextPath('/profile')).toBe('/profile')
    expect(safeNextPath('/challenges/abc?tab=2#top')).toBe('/challenges/abc?tab=2#top')
  })

  it('falls back when missing', () => {
    expect(safeNextPath(null)).toBe('/dashboard')
    expect(safeNextPath('')).toBe('/dashboard')
    expect(safeNextPath(undefined, '/x')).toBe('/x')
  })

  it.each([
    'https://evil.example.test',
    '//evil.example.test',
    '/\\evil.example.test',
    '\\\\evil.example.test',
    'javascript:alert(1)',
    'profile',
    '/ok\nLocation: https://evil.example.test',
    '/x/../..//evil.example.test',
    '/./\\evil.example.test',
  ])('rejects %j', (value) => {
    const out = safeNextPath(value)
    expect(out.startsWith('//')).toBe(false)
    expect(out).not.toMatch(/^[a-z]+:/i)
    expect(out).toBe('/dashboard')
  })

  it('never loops back into the auth screens', () => {
    for (const p of ['/login', '/register', '/forgot-password', '/reset-password', '/auth/callback', '/login?next=/x']) {
      expect(safeNextPath(p)).toBe('/dashboard')
    }
  })
})
