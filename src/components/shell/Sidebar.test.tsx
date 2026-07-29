import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { Sidebar } from './Sidebar'
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

function seedLoadedProject() {
  useProjectStore.setState({
    currentProject: { path: '/Users/test/Inarticulate III', manifest },
    trustedPaths: ['/Users/test/Inarticulate III'],
    pendingTrustPath: null,
    preflightStatus: 'ready',
    preflightError: null,
  })
  useSessionStore.setState({
    audioMode: 'internal',
    lanIp: '192.168.1.10',
    lanAddresses: ['192.168.1.10'],
  })
}

describe('Sidebar', () => {
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

  it('shows the projects label and the settings card', () => {
    render(<Sidebar variant="static" />)
    expect(screen.getByText('PNDS Projects')).toBeInTheDocument()
    expect(screen.getByTestId('settings-card')).toBeInTheDocument()
  })

  it('shows custom traffic lights and top-right action buttons', () => {
    render(<Sidebar variant="static" />)
    expect(
      screen.getByRole('button', { name: /close window/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /minimize window/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /zoom window/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })

  it('starts a trusted project when its entry is clicked', async () => {
    const user = userEvent.setup()
    useProjectStore.getState().trustProject('/Users/test/Inarticulate III')
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })

    render(<Sidebar variant="static" />)
    await user.click(screen.getByText('Inarticulate III'))

    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        '/Users/test/Inarticulate III',
        'internal',
        '192.168.1.10'
      )
    })
  })

  it('restarts the session when the mode changes while running (§8.3)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({ sessionStatus: 'ready' })

    render(<Sidebar variant="overlay" />)
    await user.selectOptions(
      screen.getByRole('combobox', { name: /audio mode/i }),
      'none'
    )

    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalled()
    })
    expect(commands.startProject).toHaveBeenCalledWith(
      '/Users/test/Inarticulate III',
      'none',
      '192.168.1.10'
    )
  })

  it('stops the project from the overlay card ✕ button', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({ sessionStatus: 'ready' })

    render(<Sidebar variant="overlay" />)
    await user.click(screen.getByRole('button', { name: /stop project/i }))
    expect(commands.stopProject).toHaveBeenCalled()
  })

  it('starts once the user picks a LAN address when several exist (§7)', async () => {
    const user = userEvent.setup()
    seedLoadedProject()
    useSessionStore.setState({
      lanIp: null,
      lanAddresses: ['192.168.1.10', '10.0.0.5'],
      sessionStatus: 'idle',
    })

    render(<Sidebar variant="static" />)
    expect(commands.startProject).not.toHaveBeenCalled()

    await user.selectOptions(
      screen.getByRole('combobox', { name: /network address/i }),
      '10.0.0.5'
    )
    await waitFor(() => {
      expect(commands.startProject).toHaveBeenCalledWith(
        '/Users/test/Inarticulate III',
        'internal',
        '10.0.0.5'
      )
    })
  })
})
