/**
 * The database raises coded errors as `CODE: message` (see the Phase 2 migrations). This module turns
 * them into a stable code plus a message that is safe to show. Unknown failures get a generic message,
 * so internal details never reach the screen.
 */

export const KNOWN_CODES = [
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'INVALID_TRANSITION',
  'NOT_OPEN',
  'ENDED',
  'CANCELLED',
  'FULL',
  'ATTEMPT_LIMIT',
  'ATTEMPT_CLOSED',
  'ATTEMPT_EXPIRED',
  'INVALID_ANSWER',
  'AI_DISABLED',
  'AI_QUOTA',
] as const

export type KnownCode = (typeof KNOWN_CODES)[number]

export interface AppError {
  code: KnownCode | 'NETWORK' | 'UNKNOWN'
  message: string
}

interface PostgrestLike {
  message?: unknown
  code?: unknown
}

const CODED = /^([A-Z_]+):\s*(.+)$/s

function isKnown(code: string): code is KnownCode {
  return (KNOWN_CODES as readonly string[]).includes(code)
}

/** Converts any thrown value from supabase-js / PostgREST into an AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof TypeError) {
    // fetch() rejects with a TypeError when the network is unreachable.
    return { code: 'NETWORK', message: 'You appear to be offline. Your answers are kept; reconnect to continue.' }
  }
  const e = (error ?? {}) as PostgrestLike
  const raw = typeof e.message === 'string' ? e.message : ''
  const match = CODED.exec(raw)
  if (match && isKnown(match[1]!)) {
    return { code: match[1] as KnownCode, message: match[2]!.trim() }
  }
  if (e.code === '42501') {
    return { code: 'FORBIDDEN', message: 'You do not have permission to do that.' }
  }
  return { code: 'UNKNOWN', message: 'Something went wrong. Please try again.' }
}
