import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { QuitConfirmDialog } from './QuitConfirmDialog'

describe('QuitConfirmDialog (v1.1.2 T7 ⌘Q)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWindowStore.setState({ quitConfirmOpen: false })
    useSessionStore.setState({ sessionStatus: 'ready' })
  })

  it('renders nothing while closed', () => {
    render(<QuitConfirmDialog />)
    expect(
      screen.queryByText('Stop the Session and Quit?')
    ).not.toBeInTheDocument()
  })

  it('shows the app-styled dialog with translated copy when opened', () => {
    useWindowStore.getState().setQuitConfirmOpen(true)
    render(<QuitConfirmDialog />)
    expect(screen.getByText('Stop the Session and Quit?')).toBeInTheDocument()
    expect(
      screen.getByText('A session is running. Stop it and quit PNDS?')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Stop & Quit' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    // The primary (dark) action is the Enter default.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Stop & Quit' })
    )
  })

  it('cancel closes the dialog and leaves the app running', async () => {
    useWindowStore.getState().setQuitConfirmOpen(true)
    render(<QuitConfirmDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(useWindowStore.getState().quitConfirmOpen).toBe(false)
    )
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.quitApp).not.toHaveBeenCalled()
  })

  it('confirm stops the session, then exits the process (no fade)', async () => {
    useWindowStore.getState().setQuitConfirmOpen(true)
    render(<QuitConfirmDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop & Quit' }))
    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(commands.quitApp).toHaveBeenCalledTimes(1)
    })
    expect(useWindowStore.getState().quitConfirmOpen).toBe(false)
    // The quit path never waits for a window fade (§7.4).
    expect(commands.closeWindowWithFade).not.toHaveBeenCalled()
    // stopAndReset returns the session to idle (§8.2).
    expect(useSessionStore.getState().sessionStatus).toBe('idle')
  })
})
