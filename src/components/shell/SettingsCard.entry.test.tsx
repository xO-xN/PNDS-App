import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { SettingsCard } from './SettingsCard'
import type { Manifest, SessionStatus } from '@/lib/tauri-bindings'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}))

const baseManifest: Manifest = {
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

const declaredManifest: Manifest = {
  ...baseManifest,
  scoreServer: { ...baseManifest.scoreServer, supportsPerformerUrl: true },
}

function seedRunning(
  manifest: Manifest = baseManifest,
  sessionStatus: SessionStatus = 'ready'
) {
  useProjectStore.setState({
    currentProject: { path: '/Users/test/Inarticulate III', manifest },
    preflightStatus: 'ready',
  })
  useSessionStore.setState({
    sessionStatus,
    sessionProjectPath: '/Users/test/Inarticulate III',
  })
}

/**
 * #140: the settings card's entry surfaces — the RUNNING session's
 * entry state row (status + the fixed URL) and the compat notice for a
 * switch-on × undeclared selection. Two facts the operator must never
 * conflate: the row reports the entry itself; the notice reports that
 * the entry will NOT apply.
 */
describe('SettingsCard HTTPS entry surfaces (#140)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ httpsEnabledSetting: false })
    useSessionStore.getState().resetSession()
  })

  it('shows the entry row with status and URL for a ready entry on the running card', () => {
    seedRunning(declaredManifest)
    useSessionStore.setState({
      httpsEntry: {
        status: 'ready',
        url: 'https://show.example.org:8443/',
        error: null,
      },
    })
    render(<SettingsCard />)

    const row = screen.getByTestId('session-entry-row')
    expect(screen.getByTestId('session-entry-status')).toHaveTextContent(
      /entry ready/i
    )
    // The scheme is trimmed for display; the copy target keeps it whole.
    expect(row).toHaveTextContent('show.example.org:8443/')
  })

  it('an entry fault keeps the row and reports the error beneath it', () => {
    seedRunning(declaredManifest)
    useSessionStore.setState({
      httpsEntry: {
        status: 'error',
        url: 'https://show.example.org:8443/',
        error: 'The HTTPS entry did not become reachable',
      },
    })
    render(<SettingsCard />)

    expect(screen.getByTestId('session-entry-status')).toHaveTextContent(
      /entry fault/i
    )
    expect(screen.getByTestId('session-entry-error')).toHaveTextContent(
      /did not become reachable/i
    )
  })

  it('hides the entry row while another card is selected over the live session', () => {
    seedRunning(declaredManifest)
    useSessionStore.setState({
      httpsEntry: {
        status: 'ready',
        url: 'https://show.example.org:8443/',
        error: null,
      },
    })
    // Roam to another project card — its pending config shows instead.
    useProjectStore.setState({
      currentProject: { path: '/other', manifest: baseManifest },
    })
    render(<SettingsCard />)

    expect(screen.queryByTestId('session-entry-row')).not.toBeInTheDocument()
  })

  it('no entry state — no row (the pre-#140 shape is unchanged)', () => {
    seedRunning(baseManifest)
    render(<SettingsCard />)
    expect(screen.queryByTestId('session-entry-row')).not.toBeInTheDocument()
  })

  it('shows the compat notice for a switch-on undeclared selection', () => {
    seedRunning(baseManifest)
    useSettingsStore.setState({ httpsEnabledSetting: true })
    render(<SettingsCard />)

    expect(screen.getByTestId('entry-compat-notice')).toHaveTextContent(
      /legacy http/i
    )
    expect(screen.queryByTestId('session-entry-row')).not.toBeInTheDocument()
  })

  it('hides the compat notice when the project declares adaptation or the switch is off', () => {
    seedRunning(declaredManifest)
    useSettingsStore.setState({ httpsEnabledSetting: true })
    const { rerender } = render(<SettingsCard />)
    expect(screen.queryByTestId('entry-compat-notice')).not.toBeInTheDocument()

    useSettingsStore.setState({ httpsEnabledSetting: false })
    useProjectStore.setState({
      currentProject: {
        path: '/Users/test/Inarticulate III',
        manifest: baseManifest,
      },
    })
    rerender(<SettingsCard />)
    expect(screen.queryByTestId('entry-compat-notice')).not.toBeInTheDocument()
  })
})
