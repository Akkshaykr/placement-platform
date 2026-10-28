import { describe, expect, it } from 'vitest'
import { parseEnv, readJwtRole } from './env'

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (role: string) => `${b64({ alg: 'HS256' })}.${b64({ role, iss: 'supabase' })}.signature`

const good = { VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123' }

describe('parseEnv', () => {
  it('accepts a hosted URL with a publishable key', () => {
    const r = parseEnv(good)
    expect(r).toEqual({ ok: true, value: { supabaseUrl: good.VITE_SUPABASE_URL, supabasePublishableKey: good.VITE_SUPABASE_PUBLISHABLE_KEY, appUrl: null } })
  })

  it('accepts a legacy anon JWT and a local http URL', () => {
    expect(parseEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).ok).toBe(true)
    expect(parseEnv({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).ok).toBe(true)
  })

  it('reports every missing value', () => {
    const r = parseEnv({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems).toHaveLength(2)
  })

  it('rejects the placeholders copied from .env.example', () => {
    const r = parseEnv({ VITE_SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_YOUR_KEY' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.join(' ')).toMatch(/placeholder/)
  })

  it('refuses a secret key or a service_role JWT, because VITE_ variables are public', () => {
    for (const key of ['sb_secret_abc123', jwt('service_role')]) {
      const r = parseEnv({ ...good, VITE_SUPABASE_PUBLISHABLE_KEY: key })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.problems.join(' ')).toMatch(/secret\/service_role/)
    }
  })

  it('refuses unrecognised keys and an authenticated-role JWT', () => {
    expect(parseEnv({ ...good, VITE_SUPABASE_PUBLISHABLE_KEY: 'not-a-key' }).ok).toBe(false)
    expect(parseEnv({ ...good, VITE_SUPABASE_PUBLISHABLE_KEY: jwt('authenticated') }).ok).toBe(false)
  })

  it('requires https except for localhost', () => {
    expect(parseEnv({ ...good, VITE_SUPABASE_URL: 'http://abcdefgh.supabase.co' }).ok).toBe(false)
    expect(parseEnv({ ...good, VITE_SUPABASE_URL: 'not a url' }).ok).toBe(false)
  })

  it('validates and normalises the optional app URL', () => {
    const r = parseEnv({ ...good, VITE_APP_URL: 'https://app.example.test/' })
    expect(r.ok && r.value.appUrl).toBe('https://app.example.test')
    expect(parseEnv({ ...good, VITE_APP_URL: 'nope' }).ok).toBe(false)
  })
})

describe('readJwtRole', () => {
  it('reads the role claim and tolerates garbage', () => {
    expect(readJwtRole(jwt('anon'))).toBe('anon')
    expect(readJwtRole('a.b.c')).toBeNull()
    expect(readJwtRole('sb_publishable_x')).toBeNull()
  })
})
