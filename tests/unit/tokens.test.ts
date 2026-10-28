import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'index.css'), 'utf8')

function token(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`Token --color-${name} not found in index.css`)
  return m[1]!
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('design tokens (WCAG 2.2)', () => {
  it('uses the palette from the specification', () => {
    expect(token('canvas').toLowerCase()).toBe('#080d18')
    expect(token('surface').toLowerCase()).toBe('#111c2e')
    expect(token('raised').toLowerCase()).toBe('#172338')
    expect(token('brand').toLowerCase()).toBe('#2563eb')
    expect(token('brand-soft').toLowerCase()).toBe('#60a5fa')
    expect(token('danger').toLowerCase()).toBe('#ef4444')
    expect(token('success').toLowerCase()).toBe('#22c55e')
    expect(token('ink').toLowerCase()).toBe('#f8fafc')
    expect(token('ink-muted').toLowerCase()).toBe('#94a3b8')
  })

  const surfaces = ['canvas', 'surface', 'raised']

  it.each(surfaces)('keeps body and muted text at AA (4.5:1) on %s', (bg) => {
    expect(contrast(token('ink'), token(bg))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('ink-muted'), token(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(surfaces)('keeps accent and status text at AA on %s', (bg) => {
    for (const name of ['brand-soft', 'danger-soft', 'success', 'warning']) {
      expect(contrast(token(name), token(bg)), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps button labels readable', () => {
    expect(contrast(token('ink'), token('brand'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('ink'), token('brand-hover'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('canvas'), token('danger'))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps form control borders at 3:1 against the surfaces they sit on', () => {
    for (const bg of surfaces) {
      expect(contrast(token('line-strong'), token(bg)), `border on ${bg}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the focus ring visible (3:1) on every surface', () => {
    for (const bg of surfaces) {
      expect(contrast(token('brand-soft'), token(bg))).toBeGreaterThanOrEqual(3)
    }
  })
})
