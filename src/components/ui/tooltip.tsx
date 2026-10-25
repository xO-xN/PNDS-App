'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

const TooltipProviderContext = React.createContext(false)
const HOVER_DELAY = 500

function TooltipProvider({
  delayDuration = HOVER_DELAY,
  skipDelayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipProviderContext value={true}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </TooltipProviderContext>
  )
}

function Tooltip({
  delayDuration,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const inherited = React.useContext(TooltipProviderContext)
  const tooltip = (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      delayDuration={delayDuration}
      {...props}
    />
  )
  if (inherited) return tooltip
  return <TooltipProvider>{tooltip}</TooltipProvider>
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  showArrow = false,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  showArrow?: boolean
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'pnds-tooltip bg-popover text-popover-foreground z-[100] w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) rounded-[12px] border border-(--pnds-border) p-2 text-xs leading-relaxed wrap-anywhere shadow-(--pnds-popover-shadow) animate-in fade-in-0 zoom-in-95 duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100 motion-reduce:animate-none',
          className
        )}
        {...props}
      >
        {children}
        {showArrow && <TooltipPrimitive.Arrow className="fill-popover" />}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/** Every hover waits independently; asChild preserves each control's DOM and refs. */
function TooltipHint({
  content,
  children,
  side = 'top',
  overflowOnly = false,
}: {
  content: React.ReactNode
  children: React.ReactElement
  side?: React.ComponentProps<typeof TooltipContent>['side']
  overflowOnly?: boolean
}) {
  const trigger = React.useRef<HTMLButtonElement>(null)
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const focusRequest = React.useRef(false)
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => () => clearTimeout(hoverTimer.current), [])
  const cancelHover = () => clearTimeout(hoverTimer.current)
  return (
    <Tooltip
      open={open && !!content}
      delayDuration={0}
      onOpenChange={next => {
        cancelHover()
        const fromFocus = focusRequest.current
        focusRequest.current = false
        const reveal = () => {
          const element = trigger.current
          const labels = element?.querySelectorAll('.truncate')
          const targets = labels?.length ? Array.from(labels) : [element]
          setOpen(
            next &&
              !!content &&
              (!overflowOnly ||
                targets.some(
                  text => text && text.scrollWidth > text.clientWidth
                ))
          )
        }
        if (!next || fromFocus) reveal()
        else hoverTimer.current = setTimeout(reveal, HOVER_DELAY)
      }}
    >
      <TooltipTrigger
        asChild
        ref={trigger}
        onFocus={() => {
          focusRequest.current = true
          queueMicrotask(() => {
            focusRequest.current = false
          })
        }}
        onPointerLeave={cancelHover}
        onPointerDown={cancelHover}
        onBlur={cancelHover}
        onKeyDown={event => {
          if (['Enter', ' ', 'Escape'].includes(event.key)) {
            cancelHover()
            setOpen(false)
          }
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipHint }
