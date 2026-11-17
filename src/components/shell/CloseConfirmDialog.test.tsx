import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { CloseConfirmDialog } from './CloseConfirmDialog'

describe('CloseConfirmDialog (§v1.1.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWindowStore.setState({ confirmCloseOpen: false })
    useSessionStore.setState({ sessionStatus: 'ready', commandPending: false })
  })

  it('renders nothing while closed', () => {
    render(<CloseConfirmDialog />)
    expect(screen.queryByText('Stop the Session?')).not.toBeInTheDocument()
  })

  it('shows the app-styled dialog with translated copy when opened', () => {
    useWindowStore.getState().setConfirmCloseOpen(true)
    render(<CloseConfirmDialog />)
    expect(screen.getByText('Stop the Session?')).toBeInTheDocument()
    expect(
      screen.getByText('A session is running. Stop it and close the window?')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Stop & Close' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    // The primary (dark) action is the Enter default.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Stop & Close' })
    )
  })

  it('Enter confirms via the focused primary action — the dark button is the default', async () => {
    const user = userEvent.setup()
    useWindowStore.getState().setConfirmCloseOpen(true)
    render(<CloseConfirmDialog />)

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(commands.closeWindowWithFade).toHaveBeenCalledTimes(1)
    })
  })

  it('cancel closes the dialog and leaves the session running', async () => {
    useWindowStore.getState().setConfirmCloseOpen(true)
    render(<CloseConfirmDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(useWindowStore.getState().confirmCloseOpen).toBe(false)
    )
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.closeWindowWithFade).not.toHaveBeenCalled()
  })

  it('confirm stops the session, then fades and hides the window', async () => {
    useWindowStore.getState().setConfirmCloseOpen(true)
    render(<CloseConfirmDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop & Close' }))
    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(commands.closeWindowWithFade).toHaveBeenCalledTimes(1)
    })
    expect(useWindowStore.getState().confirmCloseOpen).toBe(false)
    // stopAndReset returns the session to idle (§8.2).
    expect(useSessionStore.getState().sessionStatus).toBe('idle')
  })

  it('does not hide while startup still owns the command', async () => {
    useSessionStore.setState({
      sessionStatus: 'starting',
      commandPending: true,
    })
    useWindowStore.getState().setConfirmCloseOpen(true)
    render(<CloseConfirmDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop & Close' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(commands.closeWindowWithFade).not.toHaveBeenCalled()
    expect(useWindowStore.getState().confirmCloseOpen).toBe(true)
    useSessionStore.setState({ commandPending: false })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stop & Close' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop & Close' }))
    await waitFor(() =>
      expect(commands.closeWindowWithFade).toHaveBeenCalledOnce()
    )
  })

  it('keeps the window and session facts when stopping fails', async () => {
    vi.mocked(commands.stopProject).mockResolvedValueOnce({
      status: 'error',
      error: 'Owned process cleanup could not be confirmed',
    })
    useWindowStore.getState().setConfirmCloseOpen(true)
    render(<CloseConfirmDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop & Close' }))
    await waitFor(() => expect(commands.stopProject).toHaveBeenCalledOnce())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(commands.closeWindowWithFade).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
    expect(useWindowStore.getState().confirmCloseOpen).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'could not be confirmed stopped'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop & Close' }))
    await waitFor(() =>
      expect(commands.closeWindowWithFade).toHaveBeenCalledOnce()
    )
  })
})
