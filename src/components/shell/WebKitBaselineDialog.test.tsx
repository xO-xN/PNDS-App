import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { useWebKitBaselineStore } from '@/store/webkit-baseline-store'
import { safariUpdateGuideUrl } from '@/lib/webkit-baseline'
import { WebKitBaselineDialog } from './WebKitBaselineDialog'

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

describe('WebKitBaselineDialog (#110)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWebKitBaselineStore.setState({ belowBaselineVersion: null })
  })

  it('renders nothing while the baseline is met', () => {
    render(<WebKitBaselineDialog />)
    expect(screen.queryByText('Safari Needs an Update')).not.toBeInTheDocument()
  })

  it('states the detected Safari version and the update guidance', () => {
    useWebKitBaselineStore.getState().flagBelowBaseline('15.1')
    render(<WebKitBaselineDialog />)

    expect(screen.getByText('Safari Needs an Update')).toBeInTheDocument()
    expect(
      screen.getByText(/older than the Safari 16\.4 baseline/)
    ).toBeInTheDocument()
    // The details block carries the detected Safari version only — the
    // UA is frozen at AppleWebKit/605.1.15 and is deliberately absent.
    expect(screen.getByTestId('webkit-baseline-details')).toHaveTextContent(
      'Safari 15.1'
    )
  })

  it('copies the detected versions and confirms with a toast', async () => {
    useWebKitBaselineStore.getState().flagBelowBaseline('15.1')
    render(<WebKitBaselineDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('Safari 15.1')
      )
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Copied'))
  })

  it('opens the locale-matched update guide and keeps the dialog open', async () => {
    const user = userEvent.setup()
    useWebKitBaselineStore.getState().flagBelowBaseline('15.1')
    render(<WebKitBaselineDialog />)

    // The primary (filled) action is the Enter default, like the
    // close/quit confirms.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open Update Guide' })
    )

    await user.click(screen.getByRole('button', { name: 'Open Update Guide' }))
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith(safariUpdateGuideUrl('en'))
    )
    // The guide action deliberately does not close the dialog — on a
    // below-baseline machine this dialog is the reliable surface.
    expect(useWebKitBaselineStore.getState().belowBaselineVersion).toBe('15.1')
    expect(screen.getByText('Safari Needs an Update')).toBeInTheDocument()
  })

  it('close dismisses the dialog', async () => {
    useWebKitBaselineStore.getState().flagBelowBaseline('15.1')
    render(<WebKitBaselineDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(useWebKitBaselineStore.getState().belowBaselineVersion).toBeNull()
    )
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('localizes the update guide URL for zh-CN users', () => {
    expect(safariUpdateGuideUrl('en')).toBe(
      'https://support.apple.com/en-us/102665'
    )
    expect(safariUpdateGuideUrl('zh-CN')).toBe(
      'https://support.apple.com/zh-cn/102665'
    )
  })
})
