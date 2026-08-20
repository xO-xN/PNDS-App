import { render, screen, within } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { Sidebar } from './Sidebar'
import type { Manifest } from '@/lib/tauri-bindings'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
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
 * v1.2.2 (issue #29): the project column's polish — the import entry at
 * the column's end, the running project's accent bar, and the icon empty
 * states. (Folder tags shipped with the first #29 cut's flat Home view
 * and went away with it — Home lists ungrouped projects only.) The
 * fade/avoidance scroll math lives in list-reveal.test.ts plus
 * Sidebar.scroll.test.tsx.
 */
describe('Sidebar project list (v1.2.2, issue #29)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useKeyboardStore.getState().setCommandKeyPressed(false)
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [FIRST_PATH, SECOND_PATH],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      renameTarget: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  describe('the import entry', () => {
    it('lives at the column end with its label; the switch row carries no "+"', () => {
      render(<Sidebar variant="static" />)

      const scroller = screen.getByTestId('project-list-scroll')
      const button = screen.getByTestId('add-project-button')
      expect(scroller).toContainElement(button)
      // It closes the column: the last content child after every card.
      expect(screen.getByTestId('project-list-content').lastElementChild).toBe(
        button
      )
      expect(button).toHaveTextContent('Import project')
      expect(button.querySelector('svg')).not.toBeNull()

      // The switch row is only the track now.
      expect(
        within(screen.getByRole('tablist')).queryByTestId('add-project-button')
      ).not.toBeInTheDocument()
    })

    it('still shows in the empty unfiled view, after the empty state', () => {
      useProjectStore.setState({ recentProjectPaths: [] })
      render(<Sidebar variant="static" />)

      const scroller = screen.getByTestId('project-list-scroll')
      const empty = screen.getByTestId('no-projects-empty')
      const button = screen.getByTestId('add-project-button')
      expect(scroller).toContainElement(empty)
      expect(screen.getByTestId('project-list-content').lastElementChild).toBe(
        button
      )
      expect(
        empty.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it('hides inside the fixed Utilities view — bundled tools, not imports', () => {
      useProjectStore.setState({
        projectFolders: [
          { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
        ],
        activeFolderId: UTILITIES_FOLDER_ID,
      })
      render(<Sidebar variant="static" />)

      expect(screen.queryByTestId('add-project-button')).not.toBeInTheDocument()
    })

    it('disables while a session is busy', () => {
      useSessionStore.setState({ sessionStatus: 'starting' })
      render(<Sidebar variant="static" />)

      expect(screen.getByTestId('add-project-button')).toBeDisabled()
    })
  })

  describe('the running bar', () => {
    it('appears on the current card once the session starts, not while idle', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      const { rerender } = render(<Sidebar variant="static" />)

      // Idle selection: white card, no bar.
      const idleCard = screen.getByTestId('current-project-card')
      expect(idleCard.className).toContain('bg-(--pnds-card)')
      expect(
        within(idleCard).queryByTestId('running-bar')
      ).not.toBeInTheDocument()

      useSessionStore.setState({ sessionStatus: 'starting' })
      rerender(<Sidebar variant="static" />)
      const startingCard = screen.getByTestId('current-project-card')
      expect(
        within(startingCard).getByTestId('running-bar')
      ).toBeInTheDocument()

      useSessionStore.setState({ sessionStatus: 'ready' })
      rerender(<Sidebar variant="static" />)
      expect(
        within(screen.getByTestId('current-project-card')).getByTestId(
          'running-bar'
        )
      ).toBeInTheDocument()

      // Stopping the session: the bar goes, the white selection stays.
      useSessionStore.setState({ sessionStatus: 'idle' })
      rerender(<Sidebar variant="static" />)
      const stoppedCard = screen.getByTestId('current-project-card')
      expect(
        within(stoppedCard).queryByTestId('running-bar')
      ).not.toBeInTheDocument()
      expect(stoppedCard.className).toContain('bg-(--pnds-card)')
    })

    it('never marks a non-current card, even mid-session', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      useSessionStore.setState({ sessionStatus: 'ready' })
      render(<Sidebar variant="static" />)

      const [entry] = screen.getAllByTestId('project-entry')
      if (!entry) throw new Error('Expected a non-current project card')
      expect(within(entry).queryByTestId('running-bar')).not.toBeInTheDocument()
    })
  })

  describe('empty states', () => {
    it('the unfiled empty state pairs its icon with the copy', () => {
      useProjectStore.setState({ recentProjectPaths: [] })
      render(<Sidebar variant="static" />)

      const empty = screen.getByTestId('no-projects-empty')
      expect(empty).toHaveTextContent('No projects opened yet')
      expect(empty.querySelector('svg')).not.toBeNull()
    })

    it('the folder empty state pairs its icon with the copy', () => {
      useProjectStore.setState({
        projectFolders: [{ id: 'f1', name: 'Set list', projectPaths: [] }],
        activeFolderId: 'f1',
      })
      render(<Sidebar variant="static" />)

      const empty = screen.getByTestId('folder-empty')
      expect(empty).toHaveTextContent('This folder is empty')
      expect(empty.querySelector('svg')).not.toBeNull()
    })

    it('renders identically in the overlay variant', () => {
      useProjectStore.setState({
        currentProject: { path: FIRST_PATH, manifest },
        preflightStatus: 'ready',
      })
      useSessionStore.setState({ sessionStatus: 'ready' })
      render(<Sidebar variant="overlay" />)

      expect(
        within(screen.getByTestId('current-project-card')).getByTestId(
          'running-bar'
        )
      ).toBeInTheDocument()
      expect(screen.getByTestId('add-project-button')).toBeInTheDocument()
    })
  })
})
