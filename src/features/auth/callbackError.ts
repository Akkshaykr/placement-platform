/** Reads an error Supabase may have placed in the query string or hash of the redirect URL. */
export function readCallbackError(search: string, hash: string): string | null {
  const params = new URLSearchParams(search)
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
  const description = params.get('error_description') ?? hashParams.get('error_description')
  const code = params.get('error') ?? hashParams.get('error')
  if (!description && !code) return null
  return description?.replace(/\+/g, ' ') ?? 'Sign-in was cancelled or failed.'
}
