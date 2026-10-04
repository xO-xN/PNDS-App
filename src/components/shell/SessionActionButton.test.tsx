import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { SessionActionButton } from './SessionActionButton'
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

const telematicManifest: Manifest = { ...manifest, telematic: true }

/**
 * The three footer states that route a submit differently: plain Load,
 * the #58「设置节点」gate, and the #39/T4 confirm-and-replace switch.
 * The gate verdicts themselves (canStartNow / nodeGateBlocksStart) are
 * covered by session-flow.test.ts — here they are exercised through the
 * button that consumes them.
 */
describe('SessionActionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: { path: '/p', manifest },
      recentProjectPaths: ['/p'],
      preflightStatus: 'ready',
      preflightError: null,
    })
    useSettingsStore.setState({
      settingsOpen: false,
      focusSection: null,
      nodeNameSetting: '',
      hubUrlSetting: '',
      hubTokenSetting: '',
    })
    useSessionStore.getState().resetSession()
    useSessionStore.setState({
      lanIp: '192.168.1.10',
      lanAddresses: ['192.168.1.10'],
      audioMode: 'internal',
    })
    vi.mocked(commands.startProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    vi.mocked(commands.stopProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
  })

  it('renders an enabled Load button when idle and loadable; a click starts', async () => {
    render(<SessionActionButton />)

    const load = screen.getByRole('button', { name: 'Load' })
    expect(load).toBeEnabled()

    fireEvent.click(load)
    await waitFor(() =>
      expect(commands.startProject).toHaveBeenCalledWith(
        '/p',
        'internal',
        '192.168.1.10',
        null
      )
    )
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('#147: a Load gated only by a missing LAN address explains itself instead of sitting gray', async () => {
    // Everything else ready, no usable address at all (the auto-pick has
    // nothing to fill) — the pre-fix bug showed a dead-gray Load.
    useSessionStore.setState({ lanIp: null, lanAddresses: [] })

    render(<SessionActionButton />)

    const load = screen.getByRole('button', { name: 'Load' })
    expect(load).toBeDisabled()
    expect(screen.getByTestId('lan-missing-hint')).toHaveTextContent(
      /No usable network address/i
    )

    // Once an address exists (auto-picked or restored), the hint is gone
    // and the button loads again.
    useSessionStore.setState({ lanIp: '192.168.1.10' })
    await waitFor(() => expect(load).toBeEnabled())
    expect(screen.queryByTestId('lan-missing-hint')).not.toBeInTheDocument()
  })

  it('#58: a gated telematic selection becomes「设置节点」routing to the Node section', () => {
    useProjectStore.setState({
      currentProject: { path: '/p', manifest: telematicManifest },
    })

    render(<SessionActionButton />)

    fireEvent.click(screen.getByTestId('setup-node-button'))

    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    expect(useSettingsStore.getState().focusSection).toBe('node')
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('#39/T4: loading another card over a live session confirms, then stops and starts', async () => {
    // A runs; the selection is B with its own pending config.
    useProjectStore.setState({
      currentProject: { path: '/b', manifest },
      recentProjectPaths: ['/a', '/b'],
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/a',
    })

    render(<SessionActionButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Load' }))

    // The named authorization: the dialog names both cards before the
    // running show stops.
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(commands.startProject).toHaveBeenCalledWith(
        '/b',
        'internal',
        '192.168.1.10',
        null
      )
    })
  })
})
