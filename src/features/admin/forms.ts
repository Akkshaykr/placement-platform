/** Pure helpers for the admin forms: datetime-local conversion, slugs and option lists. */

/** ISO string -> value for <input type="datetime-local"> in the viewer's local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const offsetMs = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16)
}

/** <input type="datetime-local"> value -> ISO string (UTC), or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Builds a URL-safe slug from a title. Always valid for the database check (lowercase, hyphens). */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return base.length >= 3 ? base : `challenge-${base || 'draft'}`.slice(0, 60)
}

export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 6

/** Client-side checks for quick feedback. The server re-checks everything and is authoritative. */
export function validateQuestionDraft(input: {
  stem: string
  options: string[]
  correctPosition: number
  topicId: string
}): Record<string, string> {
  const errors: Record<string, string> = {}
  if (input.stem.trim().length < 5) errors.stem = 'Write the question (at least 5 characters).'
  if (!input.topicId) errors.topicId = 'Choose a topic.'
  if (input.options.length < MIN_OPTIONS || input.options.length > MAX_OPTIONS) {
    errors.options = `Provide ${MIN_OPTIONS} to ${MAX_OPTIONS} options.`
  }
  input.options.forEach((o, i) => {
    if (!o.trim()) errors[`option-${i}`] = `Option ${i + 1} is empty.`
  })
  const normalised = input.options.map((o) => o.trim().toLowerCase()).filter(Boolean)
  if (new Set(normalised).size !== normalised.length) errors.options = 'Two options have the same text.'
  if (input.correctPosition < 1 || input.correctPosition > input.options.length) {
    errors.correct = 'Mark the correct option.'
  }
  return errors
}

/** Marks/points helpers for the assessment builder. */
export function totalMarks(items: { marks: number | null }[], pointsPerCorrect: number): number {
  return items.reduce((sum, i) => sum + (i.marks ?? pointsPerCorrect), 0)
}

/** Move an item within a list. Returns a new array; out-of-range moves return the same content. */
export function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta
  if (target < 0 || target >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}
