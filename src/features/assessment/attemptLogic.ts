/** Pure logic for the attempt screen, separated so it can be unit tested. */

export type NavStatus = 'current' | 'answered' | 'marked' | 'unanswered'

/**
 * Status shown in the question navigator. "marked" wins over "answered" so a flagged question stays
 * visibly flagged even after an answer is chosen; "current" wins over everything for the open question.
 */
export function navStatus(opts: { isCurrent: boolean; answered: boolean; marked: boolean }): NavStatus {
  if (opts.isCurrent) return 'current'
  if (opts.marked) return 'marked'
  if (opts.answered) return 'answered'
  return 'unanswered'
}

export interface Tally {
  answered: number
  unanswered: number
  marked: number
}

export function tally(answers: { selected: string | null; marked: boolean }[], total: number): Tally {
  const answered = answers.filter((a) => a.selected !== null).length
  const marked = answers.filter((a) => a.marked).length
  return { answered, unanswered: Math.max(0, total - answered), marked }
}

/** Question index after moving by `delta`, clamped to the paper. */
export function step(index: number, delta: -1 | 1, total: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(total - 1, 0))
}
