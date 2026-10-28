import { describe, expect, it } from 'vitest'
import { fromLocalInput, moveItem, slugify, toLocalInput, totalMarks, validateQuestionDraft } from './forms'

describe('datetime conversion', () => {
  it('round-trips a minute-precision instant through the local format', () => {
    const iso = new Date(Date.UTC(2026, 9, 27, 10, 30)).toISOString()
    expect(toLocalInput(iso)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso)
  })
  it('treats empty and invalid values as no date', () => {
    expect(toLocalInput(null)).toBe('')
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('not a date')).toBeNull()
  })
})

describe('slugify', () => {
  it('produces database-valid slugs', () => {
    expect(slugify('Time, Speed & Distance — Set 1!')).toBe('time-speed-distance-set-1')
    expect(slugify('  ')).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(slugify('ab')).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(slugify('A'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('validateQuestionDraft', () => {
  const ok = { stem: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correctPosition: 2, topicId: 't' }
  it('accepts a complete draft', () => {
    expect(validateQuestionDraft(ok)).toEqual({})
  })
  it('flags duplicate options, blanks, missing answer and missing topic', () => {
    expect(validateQuestionDraft({ ...ok, options: ['4', ' 4', '5', '6'] }).options).toMatch(/same text/)
    expect(validateQuestionDraft({ ...ok, options: ['4', '', '5', '6'] })['option-1']).toBeTruthy()
    expect(validateQuestionDraft({ ...ok, correctPosition: 0 }).correct).toBeTruthy()
    expect(validateQuestionDraft({ ...ok, topicId: '' }).topicId).toBeTruthy()
  })
  it('limits options to between 2 and 6', () => {
    expect(validateQuestionDraft({ ...ok, options: ['a'] }).options).toBeTruthy()
    expect(validateQuestionDraft({ ...ok, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).options).toBeTruthy()
  })
})

describe('assessment builder helpers', () => {
  it('sums per-question marks, falling back to the default for unset marks', () => {
    expect(totalMarks([{ marks: 2 }, { marks: null }, { marks: 0.5 }], 1)).toBe(3.5)
  })
  it('moves items and clamps at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
  })
})
