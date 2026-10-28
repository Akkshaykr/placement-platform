/**
 * Autosave for one attempt. Guarantees, each covered by unit tests:
 *   - Only the LATEST answer for a question is sent: a fast sequence of changes collapses to one save.
 *   - At most one request per question is in flight, so saves for a question arrive in order.
 *   - Network failures are retried with backoff; the answer is kept locally until it is accepted.
 *   - A server reply that the attempt is closed stops the queue: nothing more can be saved.
 *   - Other server errors (for example an invalid option) are not retried; they are reported.
 *
 * The queue holds only unsent answers in memory. The server remains the source of truth: on reload the
 * page restores answers from the server, never from browser storage.
 */

import { toAppError, type AppError } from './errors'

export interface AnswerDraft {
  attemptId: string
  questionVersionId: string
  optionId: string | null
  marked: boolean
}

export interface SaveOutcome {
  saved: boolean
  code?: string
}

export type SaveFn = (draft: AnswerDraft) => Promise<SaveOutcome>

export type SyncState = 'idle' | 'saving' | 'saved' | 'retrying' | 'offline' | 'closed'

export interface AnswerSyncOptions {
  retryDelaysMs?: number[]
  schedule?: (fn: () => void, ms: number) => unknown
  onFatal?: (error: AppError) => void
}

const RETRYABLE = new Set(['NETWORK', 'UNKNOWN'])

export class AnswerSync {
  private pending = new Map<string, AnswerDraft>()
  private inFlight = new Set<string>()
  private failures = new Map<string, number>()
  private listeners = new Set<(state: SyncState) => void>()
  private state: SyncState = 'idle'
  private closed = false
  private readonly retryDelaysMs: number[]
  private readonly schedule: (fn: () => void, ms: number) => unknown
  private readonly onFatal: (error: AppError) => void

  constructor(
    private readonly save: SaveFn,
    options: AnswerSyncOptions = {},
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 2000, 4000, 8000]
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.onFatal = options.onFatal ?? (() => undefined)
  }

  get currentState(): SyncState {
    return this.state
  }

  /** Number of answers not yet accepted by the server (including one in flight). */
  get unsentCount(): number {
    return new Set([...this.pending.keys(), ...this.inFlight]).size
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Records the newest answer for a question and starts sending it. */
  enqueue(draft: AnswerDraft): void {
    if (this.closed) return
    this.pending.set(draft.questionVersionId, draft)
    this.setState('saving')
    this.kick(draft.questionVersionId)
  }

  /**
   * Sends everything pending now, ignoring any retry delay. Resolves when the queue is empty, or when
   * the attempt is closed. Rejects if an answer still cannot be saved (the caller should keep the
   * user on the page and show the error).
   */
  async flush(): Promise<void> {
    for (const key of this.failures.keys()) this.failures.set(key, 0)
    for (const key of this.pending.keys()) this.kick(key)
    // Leave 'offline' before checking, so the check below waits for the requests just sent.
    if (this.pending.size > 0 || this.inFlight.size > 0) this.setState('saving')
    await new Promise<void>((resolve, reject) => {
      const check = (state: SyncState) => {
        if (state === 'closed' || (this.pending.size === 0 && this.inFlight.size === 0)) {
          unsubscribe()
          resolve()
        } else if (state === 'offline') {
          unsubscribe()
          reject(new Error('Some answers could not be saved yet.'))
        }
      }
      const unsubscribe = this.subscribe(check)
      check(this.state)
    })
  }

  private kick(key: string): void {
    if (this.closed || this.inFlight.has(key)) return
    const draft = this.pending.get(key)
    if (!draft) {
      this.refreshState()
      return
    }

    this.inFlight.add(key)
    this.save(draft).then(
      (outcome) => {
        this.inFlight.delete(key)
        if (!outcome.saved && outcome.code === 'ATTEMPT_CLOSED') {
          this.close()
          return
        }
        // Clear only if no newer answer for this question arrived while this one was in flight.
        if (this.pending.get(key) === draft) this.pending.delete(key)
        this.failures.delete(key)
        this.kick(key)
        this.refreshState()
      },
      (error: unknown) => {
        this.inFlight.delete(key)
        const app = toAppError(error)
        if (!RETRYABLE.has(app.code)) {
          // A rule violation will not improve on retry. Drop the answer and report it.
          if (this.pending.get(key) === draft) this.pending.delete(key)
          this.failures.delete(key)
          this.onFatal(app)
          this.kick(key)
          this.refreshState()
          return
        }
        const attempts = (this.failures.get(key) ?? 0) + 1
        this.failures.set(key, attempts)
        if (attempts > this.retryDelaysMs.length) {
          this.setState('offline')
          return
        }
        this.setState('retrying')
        this.schedule(() => this.kick(key), this.retryDelaysMs[attempts - 1]!)
      },
    )
  }

  private refreshState(): void {
    if (this.closed) return
    if (this.pending.size === 0 && this.inFlight.size === 0) this.setState('saved')
    else if (this.state !== 'retrying' && this.state !== 'offline') this.setState('saving')
  }

  private close(): void {
    this.closed = true
    this.pending.clear()
    this.setState('closed')
  }

  private setState(next: SyncState): void {
    if (this.state === next && next !== 'saving') return
    this.state = next
    for (const listener of this.listeners) listener(next)
  }
}
