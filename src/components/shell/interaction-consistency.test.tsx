import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { Sidebar } from './Sidebar'
import type { Manifest } from '@/lib/tauri-bindings'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
  Toaster: () => null,
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

const FIRST_PATH = '/Users/test/Inarticulate III'
const SECOND_PATH = '/Users/test/PNDS Score 1'

/**
 * v1.2.2 (issue #32): the global consistency sweep — one accent
 * focus-visible ring class (pnds-focus-ring) on every interactive
 * control, press feedback by control kind (cards/segments darken — their
 * inline drag transform rules out scale; plain buttons micro-shrink), and
 * the hand cursor retired app-wide (arrows, the macOS desktop norm).
 * jsdom paints none of this; what it can pin is the contract: the shared
 * class and the press classes on the enumerated controls, and no
 * cursor-pointer anywhere. Feel (ring geometry, darkening strength,
 * reduced-motion) is human-verified against `tauri dev`.
 */
/** The sweep's enumerated sidebar controls, one locator each (issue #32's
 * own list) — both the focus-ring and the press tests walk this so the
 * enumeration cannot drift between them. */
const NAMED_CONTROLS = [
  'Remove from history',
  'Open in browser',
  'Reload monitor',
] as const

describe('interaction consistency (v1.2.2, issue #32)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWindowStore.setState({ showCustomTrafficLights: true })
    useProjectStore.setState({
      currentProject: { path: FIRST_PATH, manifest },
      recentProjectPaths: [FIRST_PATH, SECOND_PATH],
      projectFolders: [],
      activeFolderId: null,
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      preflightStatus: 'ready',
      preflightError: null,
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      audioMode: 'internal',
      lanIp: '192.168.1.10',
      lanAddresses: ['192.168.1.10'],
      oscTargetInput: '127.0.0.1:3333',
      deviceError: null,
      pendingChanges: false,
      volume: 80,
      muted: false,
      prevVolume: 0,
    })
  })

  it('gives every enumerated control the shared focus ring', () => {
    render(<Sidebar variant="static" />)

    // The folder-switch segments (unfiled + folders).
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('pnds-focus-ring')
    }

    // The list-tail import entry, the ✕, share/refresh, and the mute toggle.
    for (const testId of ['add-project-button', 'mute-toggle'] as const) {
      expect(screen.getByTestId(testId).className).toContain('pnds-focus-ring')
    }
    for (const name of NAMED_CONTROLS) {
      expect(screen.getByRole('button', { name }).className).toContain(
        'pnds-focus-ring'
      )
    }

    // The ✕ is hover-hidden (opacity-0) — the ring can only show if
    // keyboard focus also reveals it.
    expect(
      screen.getByRole('button', { name: 'Remove from history' }).className
    ).toContain('focus-visible:opacity-100')
  })

  it('presses: cards and segments darken, plain buttons micro-shrink', () => {
    const { container } = render(<Sidebar variant="static" />)

    // Cards: press-darkening on both card states (they carry inline drag
    // transforms, so scale is out).
    const current = screen.getByTestId('current-project-card')
    expect(current.className).toContain('active:bg-(--pnds-bg)')
    const other = screen.getAllByTestId('project-entry')[0]
    if (!other) throw new Error('Expected a second, non-current project card')
    expect(other.className).toContain('active:bg-(--pnds-text)/10')

    // Segments darken too.
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('active:bg-(--pnds-text)/10')
    }

    // Plain buttons micro-shrink: ghost import entry, ✕, share/refresh,
    // mute — each by its own scale magnitude.
    expect(screen.getByTestId('add-project-button').className).toContain(
      'active:scale-[0.98]'
    )
    for (const name of NAMED_CONTROLS) {
      expect(screen.getByRole('button', { name }).className).toContain(
        'active:scale-90'
      )
    }
    expect(screen.getByTestId('mute-toggle').className).toContain(
      'active:scale-90'
    )

    // No hand cursor anywhere in the rendered sidebar.
    expect(container.querySelector('.cursor-pointer')).toBeNull()
  })
})
