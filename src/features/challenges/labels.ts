import type { ChallengeState } from '@/features/assessment/schemas'

type Tone = 'neutral' | 'brand' | 'danger' | 'success' | 'warning'

export const STATE_LABEL: Record<ChallengeState, string> = {
  OPEN: 'Open now',
  UPCOMING: 'Upcoming',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NOT_PUBLISHED: 'Not published',
}

export const STATE_TONE: Record<ChallengeState, Tone> = {
  OPEN: 'success',
  UPCOMING: 'brand',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
  NOT_PUBLISHED: 'neutral',
}

export const RELEASE_LABEL: Record<'IMMEDIATE' | 'AFTER_CLOSE' | 'NEVER', string> = {
  IMMEDIATE: 'Shown straight after you submit',
  AFTER_CLOSE: 'Shown after the challenge closes',
  NEVER: 'Not shown to students',
}

export const DIFFICULTY_LABEL: Record<'EASY' | 'MEDIUM' | 'HARD', string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
}

export function formatWindow(startIso: string | null, endIso: string | null): string {
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not set'
  return `${fmt(startIso)} to ${fmt(endIso)}`
}

export function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-'
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '-' : `${Number(value).toFixed(value % 1 === 0 ? 0 : 1)}%`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m} min ${s} s` : `${s} s`
}

export function formatMarks(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
