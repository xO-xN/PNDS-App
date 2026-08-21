import { render, screen, fireEvent } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { HoverSidebar } from './HoverSidebar'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}))

/**
 * The ⌘-peek contract (spec issue #4, module doc): while a session runs,
 * holding ⌘ reveals the sidebar, and releasing ⌘ keeps it open while the
 * pointer is inside it — including an entry straight into the popover,
 * which never touches the left-edge hover strip.
 */
describe('HoverSidebar ⌘-peek pointer latch', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessionStatus: 'ready' })
    useKeyboardStore.setState({ commandKeyPressed: false })
  })

  const releaseCommandKey = () =>
    act(() => {
      useKeyboardStore.setState({ commandKeyPressed: false })
    })

  const expectVisible = () =>
    expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-100')
  const expectHidden = () =>
    expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-0')

  it('releasing ⌘ while the pointer is inside keeps the sidebar open', () => {
    useKeyboardStore.setState({ commandKeyPressed: true })
    render(<HoverSidebar />)
    expectVisible()

    // The ⌘-summoned entry path: the pointer crosses straight into the
    // popover from the monitor side, never through the left-edge strip.
    fireEvent.mouseEnter(screen.getByTestId('sidebar-popover'))

    releaseCommandKey()
    expectVisible() // the regression: this retracted under the pointer

    // Leaving afterwards hides it as usual.
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectHidden()
  })

  it('releasing ⌘ without the pointer inside retracts the sidebar', () => {
    useKeyboardStore.setState({ commandKeyPressed: true })
    render(<HoverSidebar />)
    expectVisible()
    releaseCommandKey()
    expectHidden()
  })

  it('the left-edge strip still reveals on hover and hides on leave', () => {
    render(<HoverSidebar />)
    fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
    expectVisible()
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectHidden()
  })
})
