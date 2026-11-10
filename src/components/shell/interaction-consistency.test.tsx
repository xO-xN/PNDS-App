import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useSettingsStore } from '@/store/settings-store'
import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { PerformanceSidebarHarness as Sidebar } from '@/test/desktop-harness'
import type { Manifest } from '@/lib/tauri-bindings'

beforeEach(() => {
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
})

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
 * focus-visible ring class (pnds-focus-ring) on ordinary interactive
 * controls, marker-only focus on folder tabs, one feedback surface per card,
 * a selected browsing tab,
 * plain-button press feedback and the macOS arrow cursor.
 * jsdom pins the shared class, selected state and press classes on the
 * enumerated controls, and no cursor-pointer anywhere.
 * Feel (ring geometry, darkening strength,
 * reduced-motion) is human-verified against `tauri dev`.
 */
/** The sweep's enumerated sidebar controls, one locator each (issue #32's
 * own list) — both the focus-ring and the press tests walk this so the
 * enumeration cannot drift between them. */
const NAMED_CONTROLS = [
  'Remove from history',
  'Open projection window',
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
      preflightStatus: 'ready',
      preflightError: null,
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      // The ready session runs FIRST_PATH — since the post-#63 rule its
      // card is the one ✕-exempt card (the fixture always meant this;
      // sessionProjectPath just was never set).
      sessionProjectPath: FIRST_PATH,
      audioMode: 'internal',
      lanIp: '192.168.1.10',
      lanAddresses: ['192.168.1.10'],
      oscTargetInput: '127.0.0.1:3333',
      pendingChanges: false,
      volume: 80,
      muted: false,
      prevVolume: 0,
    })
  })

  it('keeps shared focus rings on ordinary controls and marker-only focus on folder tabs', () => {
    render(<Sidebar variant="static" />)

    // Folder tabs use their markers for focus rather than an outer ring.
    for (const tab of [
      screen.getByRole('tab', { name: 'Home' }),
      screen.getByRole('tab', { name: 'Utilities' }),
    ]) {
      expect(tab.className).not.toContain('pnds-focus-ring')
    }

    // The list-tail import entry, the ✕, projection, and the mute toggle.
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

  it('keeps card feedback on one surface, marks the active folder and gives plain buttons press feedback', () => {
    const { container } = render(<Sidebar variant="static" />)

    // Cards no longer paint hover/press layers above a moving selection.
    const current = screen.getByTestId('current-project-card')
    expect(current).toHaveAttribute('data-selected-card')
    const other = screen.getAllByTestId('project-entry')[0]
    if (!other) throw new Error('Expected a second, non-current project card')
    for (const card of [current, other]) {
      expect(card.className).toContain('pnds-project-card')
      expect(card.className).not.toMatch(/(?:hover|active):bg-/)
    }

    // Browsing tabs express the selected view independently of the
    // current project card and its running session.
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tab', { name: 'Utilities' })).toHaveAttribute(
      'aria-selected',
      'false'
    )

    // Plain buttons micro-shrink: ghost import entry, ✕, projection,
    // mute — each by its own scale magnitude.
    expect(screen.getByTestId('add-project-button').className).toContain(
      'active:scale-[0.98]'
    )
    for (const name of NAMED_CONTROLS) {
      expect(screen.getByRole('button', { name }).className).toContain(
        name === 'Remove from history' ? 'active:scale-90' : 'active:opacity-70'
      )
    }
    expect(screen.getByTestId('mute-toggle').className).toContain(
      'desktop-icon-button'
    )

    // No hand cursor anywhere in the rendered sidebar.
    expect(container.querySelector('.cursor-pointer')).toBeNull()
  })
})
