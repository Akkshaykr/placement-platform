/**
 * The countdown is a DISPLAY of the server-authoritative deadline. A device clock can be minutes
 * wrong, so the client never compares the deadline with its own clock directly. It records the
 * offset between the server's `server_now` and its own clock at the moment the response arrived,
 * and corrects every reading by that offset.
 */

export interface ServerClock {
  /** Current time in ms, corrected to the server's clock. */
  now(): number
  /** The offset that was applied (server minus device), in ms. Useful for tests and debugging. */
  offsetMs: number
}

/**
 * @param serverNowIso  the `server_now` value returned by the server
 * @param receivedAtMs  the device time (ms) when that response arrived
 * @param deviceNow     injectable clock for tests
 */
export function createServerClock(
  serverNowIso: string,
  receivedAtMs: number,
  deviceNow: () => number = () => Date.now(),
): ServerClock {
  // Assume the response travelled for half of the request time, which is unknown here; using the
  // receipt time is a standard simple estimate and the error is bounded by the request latency.
  const offsetMs = new Date(serverNowIso).getTime() - receivedAtMs
  return {
    offsetMs,
    now: () => deviceNow() + offsetMs,
  }
}

/** Milliseconds left until the deadline, never negative. */
export function remainingMs(deadlineIso: string, clock: ServerClock): number {
  return Math.max(0, new Date(deadlineIso).getTime() - clock.now())
}

/** mm:ss, or h:mm:ss at one hour or more. Always two-digit minutes and seconds. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${String(m).padStart(2, '0')}:${ss}`
}

/** Urgency band for styling the countdown: plain, warning in the last 5 minutes, danger in the last minute. */
export function urgency(ms: number): 'normal' | 'warning' | 'danger' {
  if (ms <= 60_000) return 'danger'
  if (ms <= 5 * 60_000) return 'warning'
  return 'normal'
}
