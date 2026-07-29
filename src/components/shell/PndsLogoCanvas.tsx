import { useEffect, useRef, useState } from 'react'

// ── p5 visual constants ────────────────────────────────────────────────
const W = 600,
  CX = W / 2,
  CY = W / 2
const DOT_POSITIONS: [number, number][] = [
  [340, 180],
  [340, 260],
  [340, 340],
  [260, 340],
  [260, 260],
]
const D_LIGHT = 2 * Math.hypot(40, 120) // larger background circle diameter
const D_DARK = 2 * Math.hypot(120, 140) // smaller background circle

// Phase frame lengths (60fps)
const ENTRANCE_FRAMES = 50
const CLOSURE_FRAMES = 90
const DOT_REVEAL_INTERVAL = ENTRANCE_FRAMES / 5 // 10 frames between dots
const DOT_REVEAL_DURATION = 12
const LIGHT_CIRCLE_START = 24
const DARK_CIRCLE_START = 36
const CIRCLE_REVEAL_DURATION = 20
const TEXT_START_OFFSET = CLOSURE_FRAMES / 2 // 45 frames into closure
const TEXT_FADE_FRAMES = 24

// Spring physics
const STIFFNESS = 200,
  DAMPING = 22

const PALETTE = ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff']

type Phase = 'entrance' | 'wait' | 'closure' | 'done'

interface Props {
  /** Size (px) — canvas is always 600px internal, scaled via CSS. */
  size?: number
  /** Fires once the session is ready and the monitor iframe has loaded. */
  ready: boolean
  /** Called when the dissolve animation finishes. */
  onDissolveEnd?: () => void
}

// ── Math helpers (ported from the p5 prototype) ─────────────────────────
function spring(t: number): number {
  const w = Math.sqrt(STIFFNESS)
  const z = DAMPING / (2 * w)
  const wd = w * Math.sqrt(1 - z * z)
  return (
    1 -
    Math.exp(-z * w * t) *
      (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
  )
}

function bezierOut(t: number): number {
  // easeOutCubic with control points (0.215, 0.61, 0.355, 1)
  const [x1, y1, x2, y2] = [0.215, 0.61, 0.355, 1]
  let u = t
  for (let i = 0; i < 8; i++) {
    const x = 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u ** 2 * x2 + u ** 3 - t
    const dx =
      3 * (1 - u) ** 2 * x1 +
      6 * (1 - u) * u * (x2 - x1) +
      3 * u ** 2 * (1 - x2)
    if (Math.abs(dx) < 1e-10) break
    u -= x / dx
  }
  return 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u ** 2 * y2 + u ** 3
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1)
}

// ── Per-session random colours ──────────────────────────────────────────
function pickSessionColors(): { dotColors: string[]; textColor: string } {
  const dots = Array.from(
    { length: 5 },
    () => PALETTE[Math.floor(Math.random() * PALETTE.length)]
  ) as string[]
  const used = new Set(dots)
  const unused = PALETTE.filter(c => !used.has(c))
  return {
    dotColors: dots,
    textColor: (unused.length > 0
      ? unused[Math.floor(Math.random() * unused.length)]
      : '#000') as string,
  }
}

// ── Per-session random circle positions ─────────────────────────────────
function randomBgPositions(): {
  x1: number
  y1: number
  x2: number
  y2: number
} {
  const r1 = D_LIGHT / 2,
    r2 = D_DARK / 2
  const o = (a: number, b: number) =>
    (Math.random() < 0.5 ? -1 : 1) * (a + Math.random() * (b - a))

  let x1 = CX + o(70, Math.min(170, W / 2 - r1))
  let y1 = CY + o(70, Math.min(170, W / 2 - r1))
  let x2 = CX + o(50, Math.min(116, W / 2 - r2))
  let y2 = CY + o(50, Math.min(116, W / 2 - r2))

  for (let i = 0; i < 1000 && dist(x1, y1, x2, y2) < r1 + r2; i++) {
    x2 = CX + o(50, Math.min(116, W / 2 - r2))
    y2 = CY + o(50, Math.min(116, W / 2 - r2))
  }
  if (dist(x1, y1, x2, y2) < r1 + r2) {
    x1 = CX + 170
    y1 = CY + 170
    x2 = CX - 115
    y2 = CY - 115
  }
  return { x1, y1, x2, y2 }
}

// ── Canvas draw ─────────────────────────────────────────────────────────
function drawFrame(
  ctx: CanvasRenderingContext2D,
  f: number,
  phase: Phase,
  cols: ReturnType<typeof pickSessionColors>,
  bg: ReturnType<typeof randomBgPositions>
) {
  const { dotColors, textColor } = cols
  const { x1: bx1, y1: by1, x2: bx2, y2: by2 } = bg
  const { width: w } = ctx.canvas

  ctx.clearRect(0, 0, w, w)

  let d1 = 0,
    d2 = 0 // circle diameters
  let t = 0 // convergence progress (0→1)
  let r = 0 // rotation angle
  let gs = 2 // dot global scale

  if (phase === 'closure' || (phase === 'wait' && f >= ENTRANCE_FRAMES)) {
    // Closure: circles finished expanding, dots/rings converge
    d1 = D_LIGHT
    d2 = D_DARK
    const p = phase === 'closure' ? spring(Math.min(f / CLOSURE_FRAMES, 1)) : 1
    t = p
    r = (p * 225 * Math.PI) / 180
    gs = 2 + (1 - 2) * p // 2→1
  } else if (f >= ENTRANCE_FRAMES) {
    // Wait phase: circles fully expanded, no convergence
    d1 = D_LIGHT
    d2 = D_DARK
  } else {
    // Entrance: circles grow
    if (f >= LIGHT_CIRCLE_START) {
      d1 =
        bezierOut(
          Math.min(
            Math.max((f - LIGHT_CIRCLE_START) / CIRCLE_REVEAL_DURATION, 0),
            1
          )
        ) * D_LIGHT
    }
    if (f >= DARK_CIRCLE_START) {
      d2 =
        bezierOut(
          Math.min(
            Math.max((f - DARK_CIRCLE_START) / CIRCLE_REVEAL_DURATION, 0),
            1
          )
        ) * D_DARK
    }
  }

  // Background circles (light then dark for proper layering)
  ctx.fillStyle = 'rgba(222,226,255,0.39)' // 100/255 ≈ 0.39
  const cx2 = CX + (bx2 - CX) * (1 - t),
    cy2 = CY + (by2 - CY) * (1 - t)
  ctx.beginPath()
  ctx.arc(cx2, cy2, d2 / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(222,226,255,0.59)' // 150/255 ≈ 0.59
  const cx1 = CX + (bx1 - CX) * (1 - t),
    cy1 = CY + (by1 - CY) * (1 - t)
  ctx.beginPath()
  ctx.arc(cx1, cy1, d1 / 2, 0, Math.PI * 2)
  ctx.fill()

  // Five dots
  for (let i = 0; i < 5; i++) {
    const showAt = i * DOT_REVEAL_INTERVAL
    if (phase === 'entrance' && f < showAt) continue

    const dc = dotColors[i]
    if (!dc) continue
    ctx.fillStyle = dc
    const pos = DOT_POSITIONS[i]
    if (!pos) continue
    let [x, y] = pos
    x = CX + (x - CX) * gs
    y = CY + (y - CY) * gs

    if (r) {
      const dx = x - CX,
        dy = y - CY
      const angle = Math.atan2(dy, dx) + r
      const q = Math.hypot(dx, dy)
      x = CX + q * Math.cos(angle)
      y = CY + q * Math.sin(angle)
    }

    const progress =
      f < ENTRANCE_FRAMES
        ? Math.min(Math.max((f - showAt) / DOT_REVEAL_DURATION, 0), 1)
        : 1
    const bez = f < ENTRANCE_FRAMES ? bezierOut(progress) : 1
    // p5: y += lerp(50, 0, spring(t))
    const sp = f < ENTRANCE_FRAMES ? spring(progress) : 1
    const yLifted = y + 50 * (1 - sp)
    // p5: circle(x, y, 50 * gs * cs)  where cs = lerp(0.4, 1, bezierOut(t))
    const cs = 0.4 + (1 - 0.4) * bez
    const radius = 25 * gs * cs
    ctx.beginPath()
    ctx.arc(x, yLifted, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  // PNDS wordmark
  if (phase === 'closure' && f >= TEXT_START_OFFSET) {
    const a = Math.min(1, (f - TEXT_START_OFFSET) / TEXT_FADE_FRAMES)
    ctx.fillStyle = textColor
    ctx.globalAlpha = a
    ctx.font = '600 24px Arial Rounded MT Bold, Comfortaa, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('PNDS', CX, CY + 150)
    ctx.globalAlpha = 1
  }
}

/** PNDS logo animation (p5-prototype → Canvas2D). Phase 1 is autonomous
 *  dot entrance (~0.8 s); then the animation pauses until `ready` becomes
 *  true, at which point it plays the closure & dissolve. */
export function PndsLogoCanvas({ size = 190, ready, onDissolveEnd }: Props) {
  const [phase, setPhase] = useState<Phase>('entrance')
  const [dissolving, setDissolving] = useState(false)
  const frameRef = useRef(0)
  const colsRef = useRef(pickSessionColors())
  const bgRef = useRef(randomBgPositions())
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Reset on mount (state already defaults to 'entrance' / false).
  useEffect(() => {
    frameRef.current = 0
    colsRef.current = pickSessionColors()
    bgRef.current = randomBgPositions()
  }, [])

  // Advance to closure when ready
  useEffect(() => {
    if (ready && phase === 'wait') {
      frameRef.current = 0
      queueMicrotask(() => setPhase('closure'))
    }
    // If already ready before entrance finishes, let entrance complete first
  }, [ready, phase])

  // Animation loop
  useEffect(() => {
    if (phase === 'done') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cols = colsRef.current,
      bg = bgRef.current

    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / (1000 / 60) // normalised to 60 fps
      last = now
      frameRef.current += dt

      const f = frameRef.current
      const maxFrames = phase === 'entrance' ? ENTRANCE_FRAMES : CLOSURE_FRAMES

      if (f >= maxFrames) {
        if (phase === 'entrance') {
          // entrance complete → wait or jump directly to closure if ready
          if (ready) {
            frameRef.current = 0
            queueMicrotask(() => setPhase('closure'))
            return
          } else {
            // Paint the completed entrance frame once more, then pause
            drawFrame(ctx, ENTRANCE_FRAMES, 'wait', cols, bg)
            queueMicrotask(() => setPhase('wait'))
            return
          }
        } else {
          // closure complete → stay at final frame, then dissolve
          drawFrame(ctx, maxFrames, 'closure', cols, bg)
          setDissolving(true)
          setPhase('done')
          setTimeout(() => onDissolveEnd?.(), 400)
          return
        }
      }

      drawFrame(ctx, f, phase, cols, bg)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, ready, onDissolveEnd])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={W}
      className="block"
      style={{
        width: size,
        height: size,
        transition: 'opacity 0.4s ease-in',
        opacity: dissolving ? 0 : 1,
      }}
    />
  )
}
