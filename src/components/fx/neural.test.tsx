import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FloatingSymbols } from './FloatingSymbols'
import { NeuralBackground } from './NeuralBackground'

describe('homepage decoration', () => {
  it('renders the canvas and ten floating symbols without a browser canvas context', () => {
    const { container } = render(
      <div>
        <NeuralBackground />
        <FloatingSymbols />
      </div>,
    )
    expect(container.querySelector('canvas')).toBeInTheDocument()
    expect(container.querySelectorAll('.fx-symbol')).toHaveLength(10)
  })

  it('hides the decoration from assistive technology', () => {
    const { container } = render(<FloatingSymbols />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
