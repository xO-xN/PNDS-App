import { useEffect, useRef, useState } from 'react'

import {
  MONITOR_REVEAL_FADE_MS,
  MONITOR_REVEAL_FADE_TRANSITION,
} from '@/lib/monitor-reveal'
import { cn } from '@/lib/utils'

type Phase = 'in' | 'out'

/**
 * v1.3.0 (user report): the stop-transition cover. When a live session
 * stops — switching projects, or closing back to Welcome — the shell
 * fades this plain themed layer IN over the still-mounted monitor (the
 * outgoing page dissolves under it instead of being cut away), and
 * fades it OUT over the next screen once the backend reaches idle. The
 * same fade length as the loading reveal (#50), so every
 * live→next transition moves at one pace; a switch's `starting`
 * snapshot simply supersedes the cover with the loading splash.
 */
export function StopCover({
  phase,
  onFadedOut,
}: {
  phase: Phase
  onFadedOut?: () => void
}) {
  // 'in' starts transparent and becomes opaque; 'out' starts opaque and
  // becomes transparent. The rAF hop lets the mount paint at the START
  // opacity before the transition flips it — a transition on the very
  // first frame would be skipped by the compositor.
  const [opaque, setOpaque] = useState(phase === 'out')
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpaque(phase === 'in'))
    return () => cancelAnimationFrame(raf)
  }, [phase])
  // Latest parent callback without restarting the clear timer on every
  // AppShell re-render (the PndsLogoCanvas dissolveEndRef pattern).
  const fadedOutRef = useRef(onFadedOut)
  useEffect(() => {
    fadedOutRef.current = onFadedOut
  }, [onFadedOut])
  useEffect(() => {
    if (phase !== 'out') return
    const id = setTimeout(() => fadedOutRef.current?.(), MONITOR_REVEAL_FADE_MS)
    return () => clearTimeout(id)
  }, [phase])
  return (
    <div
      aria-hidden="true"
      data-testid="stop-cover"
      className={cn(
        'absolute inset-0 z-50 bg-(--pnds-bg)',
        opaque ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
      style={{ transition: MONITOR_REVEAL_FADE_TRANSITION }}
    />
  )
}
