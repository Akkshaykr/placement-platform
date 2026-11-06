import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

interface Symbol {
  glyph: string
  left: string
  top: string
  size: string
  duration: string
  delay: string
  dx: string
  dy: string
  /** Shown only on wide screens, where there is room beside the content. */
  desktopOnly?: boolean
}

/**
 * Corner symbols stay in the page gutters, clear of headings and buttons.
 * Side symbols appear only on wide screens (xl and up), where the content column leaves room.
 */
const SYMBOLS: Symbol[] = [
  { glyph: '∑', left: '2%', top: '3%', size: '2.4rem', duration: '28s', delay: '-3s', dx: '18px', dy: '-22px' },
  { glyph: '√', left: '94%', top: '2%', size: '2rem', duration: '34s', delay: '-11s', dx: '-16px', dy: '20px' },
  { glyph: '∞', left: '3%', top: '95%', size: '2.6rem', duration: '36s', delay: '-22s', dx: '-14px', dy: '-18px' },
  { glyph: '%', left: '93%', top: '96%', size: '2.2rem', duration: '27s', delay: '-18s', dx: '-18px', dy: '-14px' },
  { glyph: 'π', left: '1.5%', top: '40%', size: '3rem', duration: '31s', delay: '-6s', dx: '14px', dy: '18px', desktopOnly: true },
  { glyph: '÷', left: '1.5%', top: '72%', size: '2rem', duration: '29s', delay: '-9s', dx: '16px', dy: '-12px', desktopOnly: true },
  { glyph: 'x²', left: '95%', top: '38%', size: '2rem', duration: '24s', delay: '-14s', dx: '-14px', dy: '16px', desktopOnly: true },
  { glyph: '½', left: '95.5%', top: '62%', size: '2rem', duration: '30s', delay: '-2s', dx: '-12px', dy: '14px', desktopOnly: true },
  { glyph: '×', left: '2%', top: '86%', size: '1.7rem', duration: '25s', delay: '-16s', dx: '12px', dy: '-14px', desktopOnly: true },
  { glyph: '=', left: '95%', top: '84%', size: '1.8rem', duration: '32s', delay: '-8s', dx: '-12px', dy: '12px', desktopOnly: true },
]

/** Floating aptitude symbols. Pure CSS animation (see fx.css); decorative and hidden from assistive technology. */
export function FloatingSymbols() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {SYMBOLS.map((s, i) => (
        <span
          key={i}
          className={cn('fx-symbol', s.desktopOnly && 'hidden xl:block')}
          style={
            {
              left: s.left,
              top: s.top,
              fontSize: s.size,
              animationDuration: s.duration,
              animationDelay: s.delay,
              '--fx-dx': s.dx,
              '--fx-dy': s.dy,
            } as CSSProperties
          }
        >
          {s.glyph}
        </span>
      ))}
    </div>
  )
}
