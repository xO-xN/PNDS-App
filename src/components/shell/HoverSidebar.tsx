import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { useProjectStore } from '@/store/project-store'
import { cn } from '@/lib/utils'

/**
 * Hover-revealed floating sidebar (§10.1): a left-edge hover zone pops
 * the overlay sidebar in; mouse-leave slides it back out. Used in the
 * running monitor and the loading screen so the sidebar stays reachable
 * in fullscreen (keyed remounts by the host reset the pop state).
 *
 * v1.1.2 Cmd peek (spec issue #4): while a session runs, holding Cmd
 * reveals the sidebar regardless of the mouse and keeps it open until
 * Cmd is released — unless a dialog or settings popup is open, or the
 * pointer is still hovering, in which case it stays.
 */
export function HoverSidebar() {
  const [hoverVisible, setHoverVisible] = useState(false)
  // While a settings popup is open (Radix portals live outside the sidebar
  // element), mouse-leave auto-hide must not dismiss the sidebar.
  const [popupOpen, setPopupOpen] = useState(false)
  // Same guard for sidebar dialogs (§8.3 switch confirm, folder delete).
  const [dialogOpen, setDialogOpen] = useState(false)
  const commandKeyPressed = useKeyboardStore(state => state.commandKeyPressed)
  const running = useSessionStore(state => state.sessionStatus === 'ready')
  // v1.1.2 T6: ⌘R reveals the sidebar straight into the inline edit, and
  // the edit must outlast the Cmd key / hover that summoned it (spec
  // issue #10: 编辑聚焦期间侧栏保持显现).
  const renaming = useProjectStore(state => state.renameTarget !== null)

  const peeking = commandKeyPressed && running
  const sidebarVisible =
    hoverVisible || popupOpen || dialogOpen || peeking || renaming

  return (
    <>
      {/* Left-edge hover zone that pops the sidebar in. Full height with
          a little overhang beyond the top/bottom edges, and a wider strip
          than before, so the whole left edge triggers it. */}
      <div
        data-testid="sidebar-hover-zone"
        className="absolute -top-2 -bottom-2 left-0 z-40 w-3.5"
        onMouseEnter={() => setHoverVisible(true)}
      />

      {/* Floating sidebar: always mounted so the slide/fade animates both
          ways. The host keys it by fullscreen so a popped-out sidebar is
          dropped instantly on toggle (fresh instance starts collapsed). */}
      <div
        data-testid="sidebar-popover"
        data-sidebar-motion=""
        className={cn(
          'absolute bottom-3 left-3 top-3 z-50 transition-all duration-200 ease-out',
          sidebarVisible
            ? 'translate-x-0 opacity-100'
            : 'pointer-events-none -translate-x-5 opacity-0'
        )}
        // The ⌘-peek promise in the module doc: releasing ⌘ keeps the
        // sidebar while the pointer is inside it. The hover strip only
        // covers the left edge, so an entry straight into the popover
        // (the ⌘-summoned case) must also latch hoverVisible — otherwise
        // releasing ⌘ retracts the sidebar under the pointer.
        onMouseEnter={() => setHoverVisible(true)}
        onMouseLeave={() => {
          if (!popupOpen && !dialogOpen) setHoverVisible(false)
        }}
      >
        <Sidebar
          variant="overlay"
          onPopupOpenChange={setPopupOpen}
          onDialogOpenChange={setDialogOpen}
        />
      </div>
    </>
  )
}
