import { render, screen } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { ReadmePanel } from './ReadmePanel'

/**
 * v1.5.0 (#125): the main area's README display routing — the spec's
 * three selection states plus its two empty states, five routes total:
 *
 * 1. home, nothing selected → starting page
 * 2. a drilled-in folder, nothing selected → the folder's 自述
 * 3. a drilled-in PROTECTED folder → its 自述 (app-maintained empty
 *    state, no edit entry) — never the starting page
 * 4. a selected project card → the project's README.md (the selection
 *    wins over the drilled-in folder)
 * 5. a selected card with no README.md → the project empty state
 *
 * Every route keeps the bottom-docked preflight feedback.
 */
describe('ReadmePanel (#125 display routing)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      failedPreflightPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('route 1: home with nothing selected keeps the starting page', () => {
    render(<ReadmePanel />)

    expect(
      screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).toBeInTheDocument()
    expect(screen.queryByTestId('folder-readme')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-readme')).not.toBeInTheDocument()
  })

  it('route 2: a drilled-in folder shows its 自述 instead of the starting page', () => {
    useProjectStore.setState({
      activeFolderId: 'f1',
      projectFolders: [
        { id: 'f1', name: 'Gig', projectPaths: [], intro: 'Spring tour set' },
      ],
    })

    render(<ReadmePanel />)

    expect(screen.getByTestId('folder-readme')).toBeInTheDocument()
    expect(screen.getByText('Spring tour set')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('route 2 empty state: a folder without intro gives guidance, not the starting page', () => {
    useProjectStore.setState({
      activeFolderId: 'f1',
      projectFolders: [{ id: 'f1', name: 'Gig', projectPaths: [] }],
    })

    render(<ReadmePanel />)

    expect(
      screen.getByText('No intro yet. Choose Edit to write one.')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('route 3: the protected Utilities folder shows its 自述, not the starting page', () => {
    useProjectStore.setState({
      activeFolderId: UTILITIES_FOLDER_ID,
      projectFolders: [
        { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
      ],
    })

    render(<ReadmePanel />)

    expect(screen.getByTestId('folder-readme')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'This folder is maintained by the App — there is no intro to edit.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('route 4: a selected card shows the project README, winning over the drilled-in folder', async () => {
    useProjectStore.setState({
      activeFolderId: 'f1',
      projectFolders: [
        {
          id: 'f1',
          name: 'Gig',
          projectPaths: ['/p'],
          intro: 'Spring tour set',
        },
      ],
      pendingPreflightPath: '/p',
    })
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: '# Night Sky',
    })

    render(<ReadmePanel />)

    expect(screen.getByTestId('project-readme')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Night Sky' })
    ).toBeInTheDocument()
    expect(screen.queryByTestId('folder-readme')).not.toBeInTheDocument()
  })

  it('route 5: a selected card without README.md lands on the project empty state', async () => {
    useProjectStore.setState({
      pendingPreflightPath: '/p',
      recentProjectPaths: ['/p'],
    })
    // An earlier test's mockResolvedValue survives clearAllMocks — pin
    // the missing-README answer explicitly.
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: null,
    })

    render(<ReadmePanel />)

    expect(
      await screen.findByText('This project has no README.md yet.')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('keeps a failed selection on its README route with the error docked', async () => {
    useProjectStore.setState({
      pendingPreflightPath: null,
      failedPreflightPath: '/p',
      recentProjectPaths: ['/p'],
      preflightStatus: 'error',
      preflightError: 'score server port taken',
    })

    render(<ReadmePanel />)

    expect(screen.getByTestId('project-readme')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('port taken')
  })
})
