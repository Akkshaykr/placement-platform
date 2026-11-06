import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useFinePointer, useReducedMotion } from '@/lib/useReducedMotion'

interface SpotlightLayerProps {
  children: ReactNode
  className?: string
}

/**
 * A soft light that follows the mouse across its content. Only on mouse-driven devices, and never with
 * reduced motion. The glow moves through CSS variables set in one animation frame per move, so React
 * does not re-render on every pointer event.
 */
export function SpotlightLayer({ children, className }: SpotlightLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const finePointer = useFinePointer()
  const enabled = finePointer && !reduced

  useEffect(() => {
    const host = hostRef.current
    const glow = glowRef.current
    if (!enabled || !host || !glow) return

    let frame = 0
    let x = 0
    let y = 0

    const paint = () => {
      frame = 0
      glow.style.setProperty('--fx-x', `${x}px`)
      glow.style.setProperty('--fx-y', `${y}px`)
    }
    const onMove = (event: PointerEvent) => {
      const box = host.getBoundingClientRect()
      x = event.clientX - box.left
      y = event.clientY - box.top
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const onEnter = () => glow.classList.add('fx-spotlight-on')
    const onLeave = () => glow.classList.remove('fx-spotlight-on')

    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerenter', onEnter)
    host.addEventListener('pointerleave', onLeave)
    return () => {
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerenter', onEnter)
      host.removeEventListener('pointerleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [enabled])

  return (
    <div ref={hostRef} className={cn('relative', className)}>
      {enabled ? <div ref={glowRef} aria-hidden="true" className="fx-spotlight pointer-events-none absolute inset-0" /> : null}
      <div className="relative">{children}</div>
    </div>
  )
}
