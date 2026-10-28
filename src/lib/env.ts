import { z } from 'zod'

export interface AppEnv {
  supabaseUrl: string
  supabasePublishableKey: string
  appUrl: string | null
}

export type EnvResult = { ok: true; value: AppEnv } | { ok: false; problems: string[] }

const PLACEHOLDER = /YOUR_|your-project|<[^>]+>|changeme/i

/** Reads the `role` claim of a JWT-shaped key without verifying it (we only need to refuse privileged keys). */
export function readJwtRole(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const payload: unknown = JSON.parse(atob(padded))
    if (payload && typeof payload === 'object' && 'role' in payload && typeof payload.role === 'string') {
      return payload.role
    }
    return null
  } catch {
    return null
  }
}

const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/**
 * Validates the public configuration. Besides catching typos, it refuses to boot with a
 * privileged key: a service_role or secret key in a VITE_ variable would be published to
 * every visitor of the site.
 */
export function parseEnv(raw: Record<string, string | undefined>): EnvResult {
  const problems: string[] = []
  const url = (raw.VITE_SUPABASE_URL ?? '').trim()
  const key = (raw.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  const appUrl = (raw.VITE_APP_URL ?? '').trim()

  if (!url) {
    problems.push('VITE_SUPABASE_URL is not set.')
  } else if (PLACEHOLDER.test(url)) {
    problems.push('VITE_SUPABASE_URL still contains the placeholder from .env.example.')
  } else if (!z.url().safeParse(url).success) {
    problems.push('VITE_SUPABASE_URL is not a valid URL.')
  } else {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost(parsed.hostname))) {
      problems.push('VITE_SUPABASE_URL must use https (http is allowed only for localhost).')
    }
  }

  if (!key) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY is not set.')
  } else if (PLACEHOLDER.test(key)) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY still contains the placeholder from .env.example.')
  } else if (key.startsWith('sb_secret_') || readJwtRole(key) === 'service_role') {
    problems.push(
      'VITE_SUPABASE_PUBLISHABLE_KEY contains a secret/service_role key. Remove it immediately and rotate that key: anything in a VITE_ variable is public.',
    )
  } else if (!(key.startsWith('sb_publishable_') || readJwtRole(key) === 'anon')) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY is not a Supabase publishable (sb_publishable_...) or anon key.')
  }

  if (appUrl && !z.url().safeParse(appUrl).success) {
    problems.push('VITE_APP_URL is not a valid URL.')
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    value: { supabaseUrl: url, supabasePublishableKey: key, appUrl: appUrl ? appUrl.replace(/\/+$/, '') : null },
  }
}

export function getEnv(): EnvResult {
  return parseEnv(import.meta.env as Record<string, string | undefined>)
}
