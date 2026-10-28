const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/auth/callback']

/**
 * Returns a same-site path that is safe to navigate to after sign-in. Anything that could leave
 * the site (absolute URLs, protocol-relative `//host`, backslashes, control characters) or loop
 * back into the auth screens falls back to `fallback`. Prevents open-redirect abuse of `?next=`.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next) return fallback
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback
  try {
    const base = 'http://redirect-check.invalid'
    const url = new URL(next, base)
    if (url.origin !== base) return fallback
    if (AUTH_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return fallback
    const normalised = `${url.pathname}${url.search}${url.hash}`
    // Dot-segment normalisation can turn `/x/../..//host` into `//host`, a protocol-relative URL.
    if (normalised.startsWith('//') || normalised.includes('\\')) return fallback
    return normalised
  } catch {
    return fallback
  }
}
