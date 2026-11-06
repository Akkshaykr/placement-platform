import { useEffect, useRef } from 'react'
import { useReducedMotion } from '@/lib/useReducedMotion'

interface Node {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  phase: number
  rgb: string
}

const BLUE = '96, 165, 250'
const CYAN = '34, 211, 238'
const GREEN = '34, 197, 94'
const LINK_DISTANCE = 150
const DRIFT = 0.18 // pixels per frame: slow at 60 fps

/** Fewer nodes on small screens keeps the per-frame cost low. */
function nodeCountFor(width: number): number {
  if (width < 768) return 22
  return Math.min(56, Math.round(width / 26))
}

function createNodes(width: number, height: number): Node[] {
  const palette = [BLUE, BLUE, CYAN, BLUE, GREEN]
  return Array.from({ length: nodeCountFor(width) }, (_, i) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * DRIFT * 2,
    vy: (Math.random() - 0.5) * DRIFT * 2,
    r: 1 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2,
    rgb: palette[i % palette.length]!,
  }))
}

/**
 * Animated neural-network canvas: drifting nodes, links between nearby nodes, soft glows and gentle pulses.
 * Decorative only. It pauses while the tab is hidden, and draws one still frame when reduced motion is requested.
 */
export function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let width = 0
    let height = 0
    let nodes: Node[] = []
    let frame = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      nodes = createNodes(width, height)
    }

    const draw = (time: number, animate: boolean) => {
      ctx.clearRect(0, 0, width, height)

      if (animate) {
        for (const n of nodes) {
          n.x += n.vx
          n.y += n.vy
          if (n.x < -20) n.x = width + 20
          if (n.x > width + 20) n.x = -20
          if (n.y < -20) n.y = height + 20
          if (n.y > height + 20) n.y = -20
        }
      }

      ctx.lineWidth = 1
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 < LINK_DISTANCE * LINK_DISTANCE) {
            const alpha = (1 - Math.sqrt(d2) / LINK_DISTANCE) * 0.2
            ctx.strokeStyle = `rgba(${BLUE}, ${alpha})`
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
      }

      ctx.globalCompositeOperation = 'lighter'
      for (const n of nodes) {
        const pulse = animate ? 0.6 + 0.4 * Math.sin(time * 0.0015 + n.phase) : 0.75
        const glow = n.r * 6
        const gradient = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glow)
        gradient.addColorStop(0, `rgba(${n.rgb}, ${0.5 * pulse})`)
        gradient.addColorStop(1, `rgba(${n.rgb}, 0)`)
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(n.x, n.y, glow, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    const loop = (time: number) => {
      if (document.hidden) {
        frame = 0
        return
      }
      draw(time, true)
      frame = requestAnimationFrame(loop)
    }
    const start = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(loop)
    }
    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    const onResize = () => {
      resize()
      if (reduced) draw(0, false)
    }

    resize()
    if (reduced) draw(0, false)
    else start()

    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reduced])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}
