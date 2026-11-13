import type { Ref } from 'react'
import { cn } from '@/lib/utils'

interface CardSelectionPillProps {
  pillRef: Ref<HTMLDivElement>
  instant?: boolean
  testId?: string
}

export function CardSelectionPill({
  pillRef,
  instant = false,
  testId = 'card-selection-pill',
}: CardSelectionPillProps) {
  return (
    <div
      ref={pillRef}
      data-testid={testId}
      data-selection-pill=""
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-5 top-0 z-0 rounded-xl bg-(--pnds-card) shadow-sm',
        instant
          ? 'transition-none'
          : 'transition-[transform,opacity] duration-[280ms] ease-[cubic-bezier(0.4,0.1,0.2,1)]'
      )}
    />
  )
}
