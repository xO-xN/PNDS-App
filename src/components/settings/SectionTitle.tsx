import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/** Shared category heading for settings and compact controls. */
export function SectionTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      className={cn(
        'settings-section-heading text-lg font-semibold tracking-tight text-foreground',
        className
      )}
      {...props}
    />
  )
}
