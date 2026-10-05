import { render, screen, act, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resolveHttpsCompatChoice,
  useHttpsCompatDialog,
} from '@/lib/session-flow'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { SessionActionButton } from './SessionActionButton'
import { HttpsCompatDialog } from './HttpsCompatDialog'

/**
 * #140: the explicit legacy-HTTP choice dialog — open state comes from
 * session-flow's store, and both exits close it (the promise plumbing
 * itself is pinned in session-flow.test.ts).
 */
describe('HttpsCompatDialog (#140)', () => {
  beforeEach(() => {
    useHttpsCompatDialog.setState({ open: false })
  })

  it('renders nothing until a choice is pending', () => {
    render(<HttpsCompatDialog />)
    expect(screen.queryByText(/legacy HTTP entry/i)).not.toBeInTheDocument()
  })

  it('renders the choice when open; proceeding closes it', async () => {
    const user = userEvent.setup()
    useHttpsCompatDialog.setState({ open: true })
    render(<HttpsCompatDialog />)

    expect(
      screen.getByText(/does not declare scoreServer.supportsPerformerUrl/i)
    ).toBeInTheDocument()

    await user.click(screen.getByTestId('https-compat-proceed'))
    expect(useHttpsCompatDialog.getState().open).toBe(false)
  })

  it('cancel closes it too', async () => {
    const user = userEvent.setup()
    useHttpsCompatDialog.setState({ open: true })
    render(<HttpsCompatDialog />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(useHttpsCompatDialog.getState().open).toBe(false)
  })

  it('keeps Change available after cancellation and submits the preserved mode on the next attempt', async () => {
    const user = userEvent.setup()
    const manifest: Manifest = {
      schemaVersion: 1,
      id: 'pending-change',
      name: 'Pending Change',
      version: '1.0.0',
      description: null,
      scoreServer: {
        entry: 'server.js',
        workingDirectory: '.',
        performerPort: 6868,
        monitorPort: 6869,
        needsHttps: true,
      },
      audio: {
        defaultMode: 'internal',
        supportedModes: ['internal', 'external'],
        synthdefs: [],
        scsynth: null,
        standaloneTarget: null,
      },
    }
    useProjectStore.setState({
      currentProject: { path: '/p', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.getState().resetSession()
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      audioMode: 'external',
      lanIp: '192.168.1.20',
      oscTargetInput: '127.0.0.1:4444',
      pendingChanges: true,
    })
    useSettingsStore.setState({ httpsEnabledSetting: true })
    vi.mocked(commands.stopProject)
      .mockClear()
      .mockResolvedValue({ status: 'ok', data: null })
    vi.mocked(commands.startProject)
      .mockClear()
      .mockResolvedValue({ status: 'ok', data: null })
    render(
      <>
        <SessionActionButton />
        <HttpsCompatDialog />
      </>
    )
    try {
      await user.click(screen.getByRole('button', { name: /^change$/i }))
      // A focus/visibility catch-up while the dialog is open still reports the old mode.
      act(() => {
        useSessionStore.getState().applySnapshot({
          status: 'ready',
          projectPath: '/p',
          projectName: 'Pending Change',
          audioMode: 'internal',
          lanIp: '192.168.1.10',
          hostAddress: null,
          health: null,
          outputTail: [],
          error: null,
          volume: 80,
          startupStage: 4,
          oscTarget: null,
          projectionStarted: false,
          httpsEntry: { status: 'off', url: null, error: null },
          dnsMapping: { status: 'off', domain: null, ip: null, error: null },
          channelPlan: null,
          outputDevice: null,
        })
      })
      await user.click(screen.getByRole('button', { name: /cancel/i }))
      expect(
        screen.getByRole('button', { name: /^change$/i })
      ).toBeInTheDocument()
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: /^change$/i }))
      await user.click(screen.getByTestId('https-compat-proceed'))
      await waitFor(() =>
        expect(commands.startProject).toHaveBeenCalledWith(
          '/p',
          'external',
          '192.168.1.20',
          '127.0.0.1:4444'
        )
      )
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(
        screen.queryByRole('button', { name: /^change$/i })
      ).not.toBeInTheDocument()
    } finally {
      resolveHttpsCompatChoice(false)
      await Promise.resolve()
    }
  })
})
