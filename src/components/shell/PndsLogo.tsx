/**
 * Static PNDS logo: two translucent circles with five colored dots, matching
 * the Figma loading frame and the app icon. Placeholder for task-3 — task-6
 * replaces this with the animated p5 sketch and the five-stage / random-color
 * contracts (§10.3), including random per-session dot colors.
 */
const DOTS = [
  // [x%, y%, color] — layout matches the Figma logo and the app icon
  { x: 50, y: 24, color: '#34c759' }, // green, top
  { x: 26, y: 50, color: '#ffcc00' }, // yellow, left
  { x: 74, y: 50, color: '#ff3b30' }, // red, right
  { x: 38, y: 76, color: '#af52de' }, // purple, bottom-left
  { x: 62, y: 76, color: '#0088ff' }, // blue, bottom-right
]

export function PndsLogo({ size = 180 }: { size?: number }) {
  const dot = size * 0.13
  return (
    <div
      role="img"
      aria-label="PNDS"
      className="relative"
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 rounded-full bg-[#b8ccf0]/40" />
      <div className="absolute inset-[15%] rounded-full bg-[#cdbff2]/50" />
      {DOTS.map(d => (
        <span
          key={`${d.x}-${d.y}`}
          className="absolute rounded-full"
          style={{
            width: dot,
            height: dot,
            backgroundColor: d.color,
            left: `${d.x}%`,
            top: `${d.y}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}
    </div>
  )
}
