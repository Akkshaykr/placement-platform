import { describe, expect, it } from 'vitest'
import { AnswerSync, type AnswerDraft, type SaveFn, type SyncState } from './answerSync'

const draft = (q: string, option: string | null, marked = false): AnswerDraft => ({
  attemptId: 'attempt-1',
  questionVersionId: q,
  optionId: option,
  marked,
})

/** A save function the test controls: each call returns a promise the test resolves or rejects. */
function controlledSave() {
  const calls: { draft: AnswerDraft; resolve: (v: { saved: boolean; code?: string }) => void; reject: (e: unknown) => void }[] = []
  const save: SaveFn = (d) =>
    new Promise((resolve, reject) => {
      calls.push({ draft: d, resolve, reject })
    })
  return { save, calls }
}

/** Retry timers are captured and fired by the test, so nothing waits on real time. */
function manualScheduler() {
  const timers: (() => void)[] = []
  return { schedule: (fn: () => void) => void timers.push(fn), timers }
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

describe('AnswerSync', () => {
  it('sends only the latest answer when a question changes several times before the first save returns', async () => {
    const { save, calls } = controlledSave()
    const sync = new AnswerSync(save)
    sync.enqueue(draft('q1', 'a'))
    sync.enqueue(draft('q1', 'b'))
    sync.enqueue(draft('q1', 'c'))
    expect(calls).toHaveLength(1) // one request in flight
    calls[0]!.resolve({ saved: true })
    await flushMicrotasks()
    // The first request was for 'a'; after it returns, only the newest value ('c') is sent next.
    expect(calls).toHaveLength(2)
    expect(calls[1]!.draft.optionId).toBe('c')
  })

  it('never has two requests in flight for the same question', async () => {
    const { save, calls } = controlledSave()
    const sync = new AnswerSync(save)
    sync.enqueue(draft('q1', 'a'))
    sync.enqueue(draft('q1', 'b'))
    expect(calls).toHaveLength(1)
  })

  it('sends different questions independently', async () => {
    const { save, calls } = controlledSave()
    const sync = new AnswerSync(save)
    sync.enqueue(draft('q1', 'a'))
    sync.enqueue(draft('q2', 'x'))
    expect(calls.map((c) => c.draft.questionVersionId)).toEqual(['q1', 'q2'])
  })

  it('reports saved once every answer is accepted', async () => {
    const { save, calls } = controlledSave()
    const sync = new AnswerSync(save)
    const seen: SyncState[] = []
    sync.subscribe((s) => seen.push(s))
    sync.enqueue(draft('q1', 'a'))
    calls[0]!.resolve({ saved: true })
    await flushMicrotasks()
    expect(sync.currentState).toBe('saved')
    expect(sync.unsentCount).toBe(0)
  })

  it('retries a network failure with the scheduled delay and keeps the answer until it is accepted', async () => {
    const { save, calls } = controlledSave()
    const { schedule, timers } = manualScheduler()
    const sync = new AnswerSync(save, { schedule, retryDelaysMs: [1000] })
    sync.enqueue(draft('q1', 'a'))
    calls[0]!.reject(new TypeError('Failed to fetch'))
    await flushMicrotasks()
    expect(sync.currentState).toBe('retrying')
    expect(sync.unsentCount).toBe(1)
    timers[0]!()
    expect(calls).toHaveLength(2)
    calls[1]!.resolve({ saved: true })
    await flushMicrotasks()
    expect(sync.currentState).toBe('saved')
  })

  it('goes offline after the retry budget is spent, and flush() keeps trying', async () => {
    const { save, calls } = controlledSave()
    const { schedule, timers } = manualScheduler()
    const sync = new AnswerSync(save, { schedule, retryDelaysMs: [] })
    sync.enqueue(draft('q1', 'a'))
    calls[0]!.reject(new TypeError('Failed to fetch'))
    await flushMicrotasks()
    expect(sync.currentState).toBe('offline')
    expect(timers).toHaveLength(0)
    const flushed = sync.flush()
    expect(calls).toHaveLength(2) // flush sends again immediately
    calls[1]!.resolve({ saved: true })
    await expect(flushed).resolves.toBeUndefined()
  })

  it('stops the queue for good when the attempt has closed, and ignores later answers', async () => {
    const { save, calls } = controlledSave()
    const sync = new AnswerSync(save)
    sync.enqueue(draft('q1', 'a'))
    calls[0]!.resolve({ saved: false, code: 'ATTEMPT_CLOSED' })
    await flushMicrotasks()
    expect(sync.currentState).toBe('closed')
    sync.enqueue(draft('q2', 'b'))
    expect(calls).toHaveLength(1)
  })

  it('does not retry a rule violation, drops that answer, and reports it', async () => {
    const { save, calls } = controlledSave()
    const reported: string[] = []
    const sync = new AnswerSync(save, { onFatal: (e) => reported.push(e.code) })
    sync.enqueue(draft('q1', 'bad'))
    calls[0]!.reject({ message: 'INVALID_ANSWER: That option does not belong to this question.' })
    await flushMicrotasks()
    expect(reported).toEqual(['INVALID_ANSWER'])
    expect(sync.unsentCount).toBe(0)
    expect(calls).toHaveLength(1)
  })
})
