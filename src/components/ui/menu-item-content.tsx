import type { ReactNode } from 'react'
import { Kbd } from './kbd'

export interface MenuItemDetails {
  icon?: ReactNode
  description?: string
  shortcut?: string
}

/** Shared presentation; the owning Radix item keeps focus and activation. */
export function MenuItemContent({
  id,
  icon,
  description,
  shortcut,
  children,
}: MenuItemDetails & { id: string; children: ReactNode }) {
  return (
    <>
      {icon && (
        <span className="pnds-menu-item__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="pnds-menu-item__copy">
        <span id={`${id}-label`} className="pnds-menu-item__label">
          {children}
        </span>
        {description && (
          <span
            id={`${id}-description`}
            className="pnds-menu-item__description"
          >
            {description}
          </span>
        )}
      </span>
      {shortcut && (
        <Kbd className="pnds-menu-item__shortcut" dir="ltr" aria-hidden="true">
          {shortcut}
        </Kbd>
      )}
    </>
  )
}
