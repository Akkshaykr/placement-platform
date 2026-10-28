export interface AuthFailure {
  code: string
  message: string
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'The email or password is incorrect.',
  email_not_confirmed: 'Confirm your email address first. Check your inbox for the confirmation link.',
  user_already_exists: 'An account with this email already exists. Try signing in instead.',
  email_exists: 'An account with this email already exists. Try signing in instead.',
  weak_password: 'That password is too weak. Choose a longer, less common one.',
  same_password: 'Choose a password you have not used before.',
  over_request_rate_limit: 'Too many attempts. Wait a few minutes and try again.',
  over_email_send_rate_limit: 'Too many emails requested. Wait a few minutes and try again.',
  signup_disabled: 'New sign-ups are currently closed.',
  validation_failed: 'Check the details you entered and try again.',
  session_not_found: 'Your session has expired. Sign in again.',
  network: 'Can’t reach the server. Check your connection and try again.',
}

/** Turns any error thrown by Supabase Auth into a safe, human-readable message plus a stable code. */
export function describeAuthError(error: unknown): AuthFailure {
  if (error && typeof error === 'object') {
    const e = error as { name?: string; code?: string; status?: number }
    if (e.name === 'AuthRetryableFetchError' || e.status === 0) {
      return { code: 'network', message: MESSAGES.network! }
    }
    if (e.code && MESSAGES[e.code]) return { code: e.code, message: MESSAGES[e.code]! }
    if (e.code) return { code: e.code, message: 'Something went wrong. Please try again.' }
  }
  return { code: 'unknown', message: 'Something went wrong. Please try again.' }
}
