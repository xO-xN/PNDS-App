import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/notifications', () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

const RESOURCES = '/Applications/PNDS.app/Contents/Resources/utilities'
const TOOL_PATHS = [
  `${RESOURCES}/multichannel-signal-generator`,
  `${RESOURCES}/local-network-diagnostics`,
  `${RESOURCES}/telematic-network-diagnostics`,
]

/**
 * v1.3.3 (#85): bundled tool cards carry an illustrative icon in the
 * left slot (the same 20px the bare spacer occupies), one per tool and
 * keyed by registry id — while regular project cards keep the spacer.
 */
describe('Sidebar utility card icons (#85)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [...TOOL_PATHS],
      projectFolders: [
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: [...TOOL_PATHS],
        },
      ],
      activeFolderId: UTILITIES_FOLDER_ID,
      pendingPreflightPath: null,
      preflightStatus: 'idle',
      preflightError: null,
      manifestProjectNames: {},
      projectDisplayNames: {},
      utilityPaths: [...TOOL_PATHS],
    })
    useSessionStore.getState().resetSession()
  })

  it('gives each bundled tool card its illustrative icon, in order', () => {
    render(<Sidebar variant="static" />)

    const icons = screen.getAllByTestId('utility-card-icon')
    expect(icons.map(el => el.dataset.utilityIcon)).toEqual([
      'multichannel-signal-generator',
      'local-network-diagnostics',
      'telematic-network-diagnostics',
    ])
    // lucide stamps its glyph name into the svg class — the generator
    // card shows the waveform, not the fallback wrench.
    expect(icons[0]?.querySelector('svg')?.getAttribute('class')).toContain(
      'lucide-audio-waveform'
    )
    expect(icons[2]?.querySelector('svg')?.getAttribute('class')).toContain(
      'lucide-globe'
    )
  })

  it('keeps the bare spacer for regular project cards', () => {
    useProjectStore.setState({
      recentProjectPaths: ['/Users/test/My Score'],
      projectFolders: [],
      activeFolderId: null,
    })

    render(<Sidebar variant="static" />)

    expect(screen.queryByTestId('utility-card-icon')).toBeNull()
    expect(screen.getByText('My Score')).toBeTruthy()
  })
})
