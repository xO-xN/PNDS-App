import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { WelcomeScreen } from './WelcomeScreen'
import type { Manifest } from '@/lib/tauri-bindings'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: ['supercollider/synthdefs/inarticulate-iii.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

const PENDING_PATH = '/Users/test/Inarticulate III'

/**
 * v1.1.2 T7: the starting page is copy-only — adding a project lives in
 * the sidebar's "+" button, so the hint is plain text. What the screen
 * still owns: the trust dialog (§4), the checking/error preflight
 * feedback.
 */
describe('WelcomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: [],
      pendingTrustPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('renders the plain hint — no interactive open/add control', () => {
    render(<WelcomeScreen />)

    expect(
      screen.getByText('Start a PNDS Digital Score by adding a new project')
    ).toBeInTheDocument()
    expect(
      screen.getByText('or select a project on the left sidebar')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('asks for trust before anything runs, then preflights without auto-starting (§4)', async () => {
    const user = userEvent.setup()
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    useProjectStore.getState().requestTrust(PENDING_PATH)

    render(<WelcomeScreen />)

    // Trust confirmation must appear before anything runs
    expect(await screen.findByText(/trust this project/i)).toBeInTheDocument()
    expect(commands.preflightProject).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: /trust and continue/i })
    )
    await waitFor(() => {
      expect(commands.preflightProject).toHaveBeenCalledWith(PENDING_PATH)
    })
    // Selecting only preflights — starting is explicit via the Load button
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('Enter confirms the trust dialog — the primary action is the Enter default', async () => {
    const user = userEvent.setup()
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    useProjectStore.getState().requestTrust(PENDING_PATH)

    render(<WelcomeScreen />)

    const confirm = await screen.findByRole('button', {
      name: /trust and continue/i,
    })
    expect(document.activeElement).toBe(confirm)

    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(commands.preflightProject).toHaveBeenCalledWith(PENDING_PATH)
    })
  })

  it('does not run preflight when trust is declined', async () => {
    const user = userEvent.setup()
    useProjectStore.getState().requestTrust(PENDING_PATH)

    render(<WelcomeScreen />)
    await screen.findByText(/trust this project/i)
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().isTrusted(PENDING_PATH)).toBe(false)
  })

  it('shows a readable preflight error and does not start', async () => {
    const user = userEvent.setup()
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'error',
      error: 'manifest.json missing required field: scoreServer.monitorPort',
    })
    useProjectStore.getState().requestTrust(PENDING_PATH)

    render(<WelcomeScreen />)
    await user.click(
      await screen.findByRole('button', { name: /trust and continue/i })
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'scoreServer.monitorPort'
    )
    expect(commands.startProject).not.toHaveBeenCalled()
  })
})
