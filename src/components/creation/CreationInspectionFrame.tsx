import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useCreationStore } from '@/store/creation-store'

export function CreationInspectionFrame({
  embedded,
  open,
  identity,
  title,
  description,
  focusSelector,
  onClose,
  children,
}: {
  embedded?: boolean
  open: boolean
  identity: string
  title: string
  description: string
  focusSelector: string
  onClose: () => void
  children: ReactNode
}) {
  if (embedded)
    return (
      <section
        hidden={!open}
        aria-label={title}
        className="creation-debug-report"
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
        {children}
      </section>
    )
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-160 max-h-[85vh] flex-col overflow-hidden text-start sm:max-w-3xl"
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (
            useCreationStore.getState().workspace?.project.identity === identity
          )
            document.querySelector<HTMLButtonElement>(focusSelector)?.focus()
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}
