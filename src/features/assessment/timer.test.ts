import { describe, expect, it } from 'vitest'
import { createServerClock, formatClock, remainingMs, urgency } from './timer'

describe('server-corrected countdown', () => {
  it('ignores a device clock that is an hour fast or slow', () => {
    const serverNow = '2026-10-27T10:00:00.000Z'
    const deadline = '2026-10-27T10:10:00.000Z'
    for (const deviceSkewMs of [60 * 60_000, -60 * 60_000]) {
      // The device is skewed; the response arrived at device time = server time - skew.
      const receivedAt = new Date(serverNow).getTime() - deviceSkewMs
      const clock = createServerClock(serverNow, receivedAt, () => receivedAt)
      expect(remainingMs(deadline, clock)).toBe(10 * 60_000)
    }
  })

  it('moves forward with the device clock between readings', () => {
    let device = 1_000_000
    const clock = createServerClock(new Date(1_000_000).toISOString(), 1_000_000, () => device)
    const deadline = new Date(1_000_000 + 90_000).toISOString()
    expect(remainingMs(deadline, clock)).toBe(90_000)
    device += 30_000
    expect(remainingMs(deadline, clock)).toBe(60_000)
  })

  it('never goes below zero', () => {
    const clock = createServerClock('2026-10-27T10:00:00.000Z', Date.parse('2026-10-27T10:00:00.000Z'), () => Date.parse('2026-10-27T10:00:00.000Z'))
    expect(remainingMs('2026-10-27T09:00:00.000Z', clock)).toBe(0)
  })
})

describe('formatClock', () => {
  it('formats minutes and seconds with two digits', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(9_000)).toBe('00:09')
    expect(formatClock(125_000)).toBe('02:05')
  })
  it('adds hours from one hour upwards', () => {
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })
  it('rounds a partial second up so the display never shows 00:00 early', () => {
    expect(formatClock(400)).toBe('00:01')
  })
})

describe('urgency', () => {
  it('warns in the last five minutes and alarms in the last minute', () => {
    expect(urgency(10 * 60_000)).toBe('normal')
    expect(urgency(5 * 60_000)).toBe('warning')
    expect(urgency(60_000)).toBe('danger')
  })
})
