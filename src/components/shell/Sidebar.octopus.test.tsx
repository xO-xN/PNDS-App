import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}))

/** r6-final retires the decoration while keeping the full project list reachable. */
describe('compact performance sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/Users/test/Score 1'],
      projectFolders: [],
      pendingPreflightPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })
  it.each(['pond', 'sand', 'stage', 'brutal'] as const)(
    'keeps the project and import entry reachable under %s',
    theme => {
      useSettingsStore.setState({ colorThemeSetting: theme })
      render(<Sidebar variant="static" />)
      expect(screen.queryByTestId('octo-sidebar')).not.toBeInTheDocument()
      expect(screen.getByTestId('project-list-scroll')).toContainElement(
        screen.getByTestId('project-entry')
      )
      expect(screen.getByTestId('project-list-scroll')).toContainElement(
        screen.getByTestId('add-project-button')
      )
      expect(screen.getByTestId('settings-footer')).toHaveTextContent(
        '1 projects'
      )
    }
  )
})
