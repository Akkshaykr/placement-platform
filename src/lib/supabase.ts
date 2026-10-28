import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from './env'

let client: SupabaseClient | null = null

/**
 * The single browser Supabase client. It only ever holds the PUBLISHABLE key; what a user may
 * read or write is decided by the database (grants + row level security), not by this client.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client
  const env = getEnv()
  if (!env.ok) throw new Error(`Invalid configuration: ${env.problems.join(' ')}`)
  client = createClient(env.value.supabaseUrl, env.value.supabasePublishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}

/** Public site URL used to build auth redirect links. */
export function getSiteUrl(): string {
  const env = getEnv()
  return (env.ok && env.value.appUrl) || window.location.origin
}
