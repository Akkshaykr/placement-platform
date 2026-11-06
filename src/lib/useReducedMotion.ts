import { useSyncExternalStore } from 'react'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const FINE_POINTER = '(hover: hover) and (pointer: fine)'

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/** Subscribers are created once, so React does not resubscribe on every render. */
function subscriberFor(query: string) {
  return (onChange: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }
}

const subscribeReduced = subscriberFor(REDUCED_MOTION)
const subscribeFine = subscriberFor(FINE_POINTER)

/** True when the person has asked the operating system for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => matches(REDUCED_MOTION),
    () => false,
  )
}

/** True for a mouse or trackpad. Touch screens return false, so the spotlight is never used there. */
export function useFinePointer(): boolean {
  return useSyncExternalStore(
    subscribeFine,
    () => matches(FINE_POINTER),
    () => false,
  )
}
