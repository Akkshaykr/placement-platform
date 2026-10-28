import { safeNextPath } from '@/lib/safeRedirect'

const KEY = 'pc.next'

/**
 * Remembers where to send the person after sign-in. It is kept in sessionStorage rather than in
 * the redirect URL because Supabase only redirects to allow-listed URLs, and a query string
 * would stop matching the allow-list.
 */
export function rememberNextPath(next: string | null | undefined): void {
  try {
    window.sessionStorage.setItem(KEY, safeNextPath(next))
  } catch {
    /* storage unavailable (private mode): fall back to the default destination */
  }
}

export function consumeNextPath(): string {
  try {
    const value = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
    return safeNextPath(value)
  } catch {
    return safeNextPath(null)
  }
}
