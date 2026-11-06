import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Reveal } from './Reveal'

describe('Reveal', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps content visible when IntersectionObserver is unavailable', () => {
    const { container } = render(
      <Reveal>
        <p>Visible text</p>
      </Reveal>,
    )
    expect(container.firstElementChild?.classList.contains('fx-reveal-armed')).toBe(false)
    expect(screen.getByText('Visible text')).toBeVisible()
  })

  it('fades in once the element scrolls into view', () => {
    let notify: IntersectionObserverCallback = () => {}
    class FakeObserver {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return []
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver as unknown as typeof IntersectionObserver)

    const { container } = render(
      <Reveal>
        <p>Scrolls in</p>
      </Reveal>,
    )
    const el = container.firstElementChild!
    expect(el.classList.contains('fx-reveal-armed')).toBe(true)

    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(el.classList.contains('fx-reveal-in')).toBe(true)
  })
})
