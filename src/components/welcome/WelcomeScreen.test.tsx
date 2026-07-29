import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { WelcomeScreen } from './WelcomeScreen'
import type { Manifest } from '@/lib/tauri-bindings'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

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

  it('asks for trust on first open, then preflights without auto-starting (§4)', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue('/Users/test/Inarticulate III')
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })

    render(<WelcomeScreen />)
    await user.click(screen.getByRole('button', { name: /open project/i }))

    // Trust confirmation must appear before anything runs
    expect(await screen.findByText(/trust this project/i)).toBeInTheDocument()
    expect(commands.preflightProject).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: /trust and continue/i })
    )
    await waitFor(() => {
      expect(commands.preflightProject).toHaveBeenCalledWith(
        '/Users/test/Inarticulate III'
      )
    })
    // Selecting only preflights — starting is explicit via the Load button
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('does not run preflight when trust is declined', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue('/Users/test/Inarticulate III')

    render(<WelcomeScreen />)
    await user.click(screen.getByRole('button', { name: /open project/i }))
    await screen.findByText(/trust this project/i)
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(
      useProjectStore.getState().isTrusted('/Users/test/Inarticulate III')
    ).toBe(false)
  })

  it('shows a readable preflight error and does not start', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue('/Users/test/Broken')
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'error',
      error: 'manifest.json missing required field: scoreServer.monitorPort',
    })

    render(<WelcomeScreen />)
    await user.click(screen.getByRole('button', { name: /open project/i }))
    await user.click(
      await screen.findByRole('button', { name: /trust and continue/i })
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'scoreServer.monitorPort'
    )
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('skips the trust dialog for paths trusted this session', async () => {
    const user = userEvent.setup()
    useProjectStore.getState().trustProject('/Users/test/Inarticulate III')
    vi.mocked(open).mockResolvedValue('/Users/test/Inarticulate III')
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })

    render(<WelcomeScreen />)
    await user.click(screen.getByRole('button', { name: /open project/i }))

    await waitFor(() => {
      expect(commands.preflightProject).toHaveBeenCalled()
    })
    expect(screen.queryByText(/trust this project/i)).not.toBeInTheDocument()
  })
})
