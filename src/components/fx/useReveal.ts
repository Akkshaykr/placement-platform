import { useLayoutEffect, useRef } from 'react'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Fades an element in the first time it scrolls into view. The element is hidden only when observation is
 * possible and motion is allowed, so without JavaScript, or with reduced motion, content is always visible.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || reduced || typeof IntersectionObserver === 'undefined') return

    el.classList.add('fx-reveal-armed')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          el.classList.add('fx-reveal-in')
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)

    return () => {
      observer.disconnect()
      el.classList.remove('fx-reveal-armed', 'fx-reveal-in')
    }
  }, [reduced])

  return ref
}
