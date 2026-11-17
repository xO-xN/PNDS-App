import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface SettingsFieldProps {
  label: ReactNode
  htmlFor?: string
  description?: ReactNode
  children: ReactNode
  className?: string
}

export function SettingsField({
  label,
  htmlFor,
  description,
  children,
  className,
}: SettingsFieldProps) {
  return (
    <div className={cn('settings-field', className)}>
      <div className="settings-field-copy">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="settings-field-label">
            {label}
          </Label>
        ) : (
          <div className="settings-field-label">{label}</div>
        )}
        {description && (
          <div className="settings-field-description">{description}</div>
        )}
      </div>
      <div className="settings-field-control">{children}</div>
    </div>
  )
}
