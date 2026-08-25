import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * Settings section heading (通用 / 外观 / 音频 / 端口 / 开发者工具 /
 * 关于): a small muted eyebrow over the section's item rows — visually
 * distinct from the row Labels (text-sm font-medium), which previously
 * read as the same level as the headings (user review).
 */
export function SectionTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      className={cn(
        'text-muted-foreground text-xs font-semibold tracking-wide',
        className
      )}
      {...props}
    />
  )
}
