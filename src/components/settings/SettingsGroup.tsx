import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SettingsGroupProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode
  description?: ReactNode
  status?: ReactNode
  footer?: ReactNode
}

/** A related set of preferences, with its own status and scoped actions. */
export function SettingsGroup({
  title,
  description,
  status,
  footer,
  children,
  className,
  ...props
}: SettingsGroupProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={cn('settings-group', className)}
      {...props}
    >
      <header className="settings-group-heading">
        <div>
          <h3 id={headingId}>{title}</h3>
          {description && (
            <div className="settings-group-description">{description}</div>
          )}
        </div>
        {status && <div className="settings-group-status">{status}</div>}
      </header>
      <div className="settings-group-body">{children}</div>
      {footer && <footer className="settings-group-footer">{footer}</footer>}
    </section>
  )
}
