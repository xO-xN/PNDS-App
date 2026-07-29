import { useState } from 'react'

/** §10.3: five-dot palette. Every loading session picks 5 colors (repeats
 *  allowed), then picks one for the "PNDS" wordmark (unused if possible). */
const PALETTE = [
  '#34c759', // green
  '#ffcc00', // yellow
  '#ff3b30', // red
  '#af52de', // purple
  '#0088ff', // blue
  '#ff9500', // orange
  '#00c7be', // teal
]

function pickRandomColors(): { dots: string[]; wordmark: string } {
  const dots = Array.from(
    { length: 5 },
    () => PALETTE[Math.floor(Math.random() * PALETTE.length)]
  ) as string[]
  const used = new Set(dots)
  const unused = PALETTE.filter(c => !used.has(c))
  const wordmark =
    unused.length > 0
      ? (unused[Math.floor(Math.random() * unused.length)] ?? '#000000')
      : '#000000'
  return { dots, wordmark }
}

interface PndsLogoProps {
  /** 0 = idle; 1–5 = dots visible; 5 + complete = spin + dissolve. */
  stage: number
  size?: number
}

const DOT_POSITIONS = [
  { x: 50, y: 24 },
  { x: 26, y: 50 },
  { x: 74, y: 50 },
  { x: 38, y: 76 },
  { x: 62, y: 76 },
]

export function AnimatedPndsLogo({ stage, size = 190 }: PndsLogoProps) {
  const [{ dots, wordmark }] = useState(pickRandomColors)
  const dotSize = size * 0.13
  const complete = stage >= 5

  return (
    <div
      role="img"
      aria-label="PNDS loading"
      className="relative"
      style={{ width: size, height: size }}
    >
      {/* Background circles — appear at stages 2 and 4 */}
      <div
        className="absolute inset-0 rounded-full bg-[#b8ccf0]/40 transition-opacity duration-500"
        style={{ opacity: stage >= 2 ? 1 : 0 }}
      />
      <div
        className="absolute inset-[15%] rounded-full bg-[#cdbff2]/50 transition-opacity duration-500"
        style={{ opacity: stage >= 4 ? 1 : 0 }}
      />

      {/* Five dots — appear one by one */}
      {DOT_POSITIONS.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full transition-all duration-400"
          style={{
            width: dotSize,
            height: dotSize,
            backgroundColor: dots[i],
            left: `${p.x}%`,
            top: `${p.y}%`,
            transform:
              stage > i
                ? 'translate(-50%, -50%) scale(1)'
                : 'translate(-50%, -50%) scale(0)',
            opacity: stage > i ? 1 : 0,
            transitionDelay: stage > i ? '0s' : '0s',
          }}
        />
      ))}

      {/* PNDS wordmark */}
      <div
        className="absolute inset-0 flex items-center justify-center text-[24px] font-bold tracking-[0.15em] transition-opacity duration-700"
        style={{ color: wordmark, opacity: complete ? 0 : 1 }}
      >
        PNDS
      </div>

      {/* Spin + dissolve: on complete, rotate + fade */}
      {complete && (
        <div
          className="absolute inset-0 animate-[spin-shrink_0.8s_ease-in-out_forwards]"
          style={{
            animation: 'spin-shrink 0.8s ease-in-out forwards',
          }}
        />
      )}
    </div>
  )
}

/** Static logo used by the non-animated loading placeholder. */
export function PndsLogo({ size = 180 }: { size?: number }) {
  return (
    <div
      role="img"
      aria-label="PNDS"
      className="relative"
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 rounded-full bg-[#b8ccf0]/40" />
      <div className="absolute inset-[15%] rounded-full bg-[#cdbff2]/50" />
      {DOT_POSITIONS.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            width: size * 0.13,
            height: size * 0.13,
            backgroundColor: PALETTE[i % PALETTE.length],
            left: `${p.x}%`,
            top: `${p.y}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}
    </div>
  )
}
