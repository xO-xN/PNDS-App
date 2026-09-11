import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { useUpdaterStore } from '@/store/updater-store'
import { RELEASES_URL } from '@/lib/updater'
import { UpdaterFailureDialog } from './UpdaterFailureDialog'

// Clipboard + opener are mocked globally in src/test/setup.ts (writeText)
// and here (openUrl); sonner is stubbed like the other dialog tests.
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

describe('UpdaterFailureDialog (#60, check-only #121)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUpdaterStore.setState({ failure: null })
  })

  it('renders nothing while closed', () => {
    render(<UpdaterFailureDialog />)
    expect(screen.queryByText('Update Check Failed')).not.toBeInTheDocument()
  })

  it('titles a check failure and shows the full reason text', () => {
    useUpdaterStore.getState().showUpdaterFailure('no route to host')
    render(<UpdaterFailureDialog />)

    expect(screen.getByText('Update Check Failed')).toBeInTheDocument()
    expect(
      screen.getByText(/download the latest version manually/i)
    ).toBeInTheDocument()
    expect(screen.getByTestId('updater-failure-reason')).toHaveTextContent(
      'no route to host'
    )
  })

  it('copies the full error text and confirms with a toast', async () => {
    useUpdaterStore.getState().showUpdaterFailure('offline')
    render(<UpdaterFailureDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('offline'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Copied'))
  })

  it('toasts a generic error when the clipboard copy fails', async () => {
    vi.mocked(writeText).mockRejectedValueOnce(new Error('clipboard busy'))
    useUpdaterStore.getState().showUpdaterFailure('offline')
    render(<UpdaterFailureDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Something went wrong')
    )
  })

  it('opens the Releases page with the primary action and closes the dialog', async () => {
    const user = userEvent.setup()
    useUpdaterStore.getState().showUpdaterFailure('network dropped')
    render(<UpdaterFailureDialog />)

    // The primary (filled) action is the Enter default, like the
    // close/quit confirms.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open Releases Page' })
    )

    await user.click(screen.getByRole('button', { name: 'Open Releases Page' }))
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(RELEASES_URL))
    await waitFor(() => expect(useUpdaterStore.getState().failure).toBeNull())
  })

  it('cancel closes the dialog without touching the escape hatch', async () => {
    useUpdaterStore.getState().showUpdaterFailure('dns broke')
    render(<UpdaterFailureDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(useUpdaterStore.getState().failure).toBeNull())
    expect(openUrl).not.toHaveBeenCalled()
  })
})
