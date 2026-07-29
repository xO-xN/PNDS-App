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
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('asks for trust on first open, then runs preflight (§4)', async () => {
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

    // Success: project info is displayed
    expect(await screen.findByText('Inarticulate III')).toBeInTheDocument()
    expect(screen.getByText(/6868/)).toBeInTheDocument()
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

  it('shows a readable preflight error', async () => {
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

  it('starts the project with the chosen mode and LAN address (§6.1, §7)', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue('/Users/test/Inarticulate III')
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    vi.mocked(commands.listLanAddresses).mockResolvedValue({
      status: 'ok',
      data: ['192.168.1.10'],
    })

    render(<WelcomeScreen />)
    await user.click(screen.getByRole('button', { name: /open project/i }))
    await user.click(
      await screen.findByRole('button', { name: /trust and continue/i })
    )

    // Default mode comes from the manifest; switch it to "none"
    const modeSelect = await screen.findByRole('combobox', {
      name: /audio mode/i,
    })
    await user.selectOptions(modeSelect, 'none')

    await user.click(screen.getByRole('button', { name: /start project/i }))
    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        '/Users/test/Inarticulate III',
        'none',
        '192.168.1.10'
      )
    })
  })

  it('requires an explicit LAN choice when several addresses exist (§7)', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue('/Users/test/Inarticulate III')
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    vi.mocked(commands.listLanAddresses).mockResolvedValue({
      status: 'ok',
      data: ['192.168.1.10', '10.0.0.5'],
    })

    render(<WelcomeScreen />)
    await user.click(screen.getByRole('button', { name: /open project/i }))
    await user.click(
      await screen.findByRole('button', { name: /trust and continue/i })
    )

    // Start must stay disabled until the user picks an address
    const startButton = await screen.findByRole('button', {
      name: /start project/i,
    })
    expect(startButton).toBeDisabled()

    await user.selectOptions(
      screen.getByRole('combobox', { name: /network address/i }),
      '10.0.0.5'
    )
    expect(startButton).toBeEnabled()

    await user.click(startButton)
    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        '/Users/test/Inarticulate III',
        'internal',
        '10.0.0.5'
      )
    })
  })
})
