import { describe, expect, it } from 'vitest'
import { navStatus, step, tally } from './attemptLogic'

describe('navStatus', () => {
  it('shows the open question as current regardless of its answer', () => {
    expect(navStatus({ isCurrent: true, answered: true, marked: true })).toBe('current')
  })
  it('keeps a flagged question flagged even when it is answered', () => {
    expect(navStatus({ isCurrent: false, answered: true, marked: true })).toBe('marked')
  })
  it('distinguishes answered from unanswered', () => {
    expect(navStatus({ isCurrent: false, answered: true, marked: false })).toBe('answered')
    expect(navStatus({ isCurrent: false, answered: false, marked: false })).toBe('unanswered')
  })
})

describe('tally', () => {
  it('counts answered, unanswered and marked questions against the paper size', () => {
    const t = tally(
      [
        { selected: 'a', marked: false },
        { selected: null, marked: true },
        { selected: null, marked: false },
      ],
      4,
    )
    expect(t).toEqual({ answered: 1, unanswered: 3, marked: 1 })
  })
})

describe('step', () => {
  it('moves within the paper and never leaves it', () => {
    expect(step(0, -1, 3)).toBe(0)
    expect(step(1, 1, 3)).toBe(2)
    expect(step(2, 1, 3)).toBe(2)
    expect(step(0, 1, 0)).toBe(0)
  })
})
