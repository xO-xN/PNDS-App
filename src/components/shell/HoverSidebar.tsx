import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { cn } from '@/lib/utils'

/**
 * Hover-revealed floating sidebar (§10.1): a left-edge hover zone pops
 * the overlay sidebar in; mouse-leave slides it back out. Used in the
 * running monitor and the loading screen so the sidebar stays reachable
 * in fullscreen (keyed remounts by the host reset the pop state).
 */
export function HoverSidebar() {
  const [sidebarVisible, setSidebarVisible] = useState(false)
  // While a settings popup is open (Radix portals live outside the sidebar
  // element), mouse-leave auto-hide must not dismiss the sidebar.
  const [popupOpen, setPopupOpen] = useState(false)

  return (
    <>
      {/* Left-edge hover zone that pops the sidebar in. Full height with
          a little overhang beyond the top/bottom edges, and a wider strip
          than before, so the whole left edge triggers it. */}
      <div
        data-testid="sidebar-hover-zone"
        className="absolute -top-2 -bottom-2 left-0 z-40 w-3.5"
        onMouseEnter={() => setSidebarVisible(true)}
      />

      {/* Floating sidebar: always mounted so the slide/fade animates both
          ways. The host keys it by fullscreen so a popped-out sidebar is
          dropped instantly on toggle (fresh instance starts collapsed). */}
      <div
        data-testid="sidebar-popover"
        className={cn(
          'absolute bottom-3 left-3 top-3 z-50 transition-all duration-200 ease-out',
          sidebarVisible
            ? 'translate-x-0 opacity-100'
            : 'pointer-events-none -translate-x-5 opacity-0'
        )}
        onMouseLeave={() => {
          if (!popupOpen) setSidebarVisible(false)
        }}
      >
        <Sidebar
          variant="overlay"
          onRequestClose={() => setSidebarVisible(false)}
          onPopupOpenChange={setPopupOpen}
        />
      </div>
    </>
  )
}
