import { render, screen, fireEvent, waitFor } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { commands, type ProjectFolder } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { FolderReadme } from './FolderReadme'

function seedFolder(
  overrides: Partial<ProjectFolder> & { id: string }
): ProjectFolder {
  const folder: ProjectFolder = {
    name: 'Gig',
    projectPaths: [],
    ...overrides,
  }
  useProjectStore.setState({
    projectFolders: useProjectStore.getState().projectFolders.concat([folder]),
  })
  const seeded = useProjectStore
    .getState()
    .projectFolders.find(candidate => candidate.id === folder.id)
  if (!seeded) throw new Error(`Folder seeding failed: ${folder.id}`)
  return seeded
}

/**
 * v1.5.0 (#124): the folder's self-description in the main area — the
 * display, the in-app form (name read-only + multi-line intro), the
 * protected-folder guard (no edit entry), and the bottom-docked
 * preflight feedback that coexists with the README panel.
 */
describe('FolderReadme', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      projectFolders: [],
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('renders the folder name and the stored intro', () => {
    seedFolder({ id: 'f1', intro: 'Spring tour set\nTwo sets, 20 min each' })

    render(<FolderReadme folderId="f1" />)

    expect(screen.getByText('Gig')).toBeInTheDocument()
    // testing-library normalizes whitespace — the raw newline rendering is
    // carried by whitespace-pre-wrap, human-verified like other CSS.
    expect(
      screen.getByText('Spring tour set Two sets, 20 min each')
    ).toBeInTheDocument()
  })

  it('renders nothing for an unknown folder id', () => {
    const { container } = render(<FolderReadme folderId="missing" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the editable empty state when no intro is stored', () => {
    seedFolder({ id: 'f1' })

    render(<FolderReadme folderId="f1" />)

    expect(
      screen.getByText('No intro yet. Choose Edit to write one.')
    ).toBeInTheDocument()
  })

  it('gives a protected folder no edit entry', () => {
    seedFolder({ id: UTILITIES_FOLDER_ID, name: 'Utilities' })

    render(<FolderReadme folderId={UTILITIES_FOLDER_ID} />)

    expect(
      screen.queryByRole('button', { name: 'Edit' })
    ).not.toBeInTheDocument()
    // #125: the protected empty state is guidance, not a bare "none".
    expect(
      screen.getByText(
        'This folder is maintained by the App — there is no intro to edit.'
      )
    ).toBeInTheDocument()
  })

  it('edits the intro through the form and persists on save', async () => {
    seedFolder({ id: 'f1', intro: 'Old text' })

    render(<FolderReadme folderId="f1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    // The form prefills both fields; the name is editable (user report
    // after #124 — the read-only box read as broken).
    const nameInput = screen.getByLabelText('Folder name') as HTMLInputElement
    expect(nameInput.value).toBe('Gig')
    expect(nameInput.readOnly).toBe(false)
    const introField = screen.getByLabelText('Intro') as HTMLTextAreaElement
    expect(introField.value).toBe('Old text')

    fireEvent.change(introField, { target: { value: 'New programme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The commit went through the store's structural action — the intro
    // landed in state AND in the persisted index.
    expect(
      useProjectStore.getState().projectFolders.find(f => f.id === 'f1')?.intro
    ).toBe('New programme')
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectFolders: [
            expect.objectContaining({ id: 'f1', intro: 'New programme' }),
          ],
        })
      )
    })
    // Saving closes the form and shows the fresh text.
    expect(screen.queryByLabelText('Intro')).not.toBeInTheDocument()
    expect(screen.getByText('New programme')).toBeInTheDocument()
  })

  // User report after #124: the name box must actually rename — through
  // the sidebar's own renameFolder seam, so its guards apply here too.
  it('renames the folder on save alongside the intro', async () => {
    seedFolder({ id: 'f1', name: 'Gig', intro: 'Old text' })

    render(<FolderReadme folderId="f1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Folder name'), {
      target: { value: 'Gig Night' },
    })
    fireEvent.change(screen.getByLabelText('Intro'), {
      target: { value: 'New programme' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const folder = useProjectStore
      .getState()
      .projectFolders.find(f => f.id === 'f1')
    expect(folder?.name).toBe('Gig Night')
    expect(folder?.intro).toBe('New programme')
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectFolders: [expect.objectContaining({ name: 'Gig Night' })],
        })
      )
    })
    // The panel follows the live folder — the header shows the new name.
    expect(
      screen.getByRole('heading', { name: 'Gig Night' })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Intro')).not.toBeInTheDocument()
  })

  it('refuses a duplicate name with the reason and saves nothing', () => {
    seedFolder({ id: 'f1', name: 'Gig', intro: 'Old text' })
    seedFolder({ id: 'f2', name: 'Taken' })

    render(<FolderReadme folderId="f1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Folder name'), {
      target: { value: 'Taken' },
    })
    fireEvent.change(screen.getByLabelText('Intro'), {
      target: { value: 'New programme' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The form stays open with the reason; neither field committed.
    expect(screen.getByLabelText('Intro')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A folder named “Taken” already exists.'
    )
    const folder = useProjectStore
      .getState()
      .projectFolders.find(f => f.id === 'f1')
    expect(folder?.name).toBe('Gig')
    expect(folder?.intro).toBe('Old text')
  })

  it('refuses a blank name with the reason and saves nothing', () => {
    seedFolder({ id: 'f1', name: 'Gig', intro: 'Old text' })

    render(<FolderReadme folderId="f1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Folder name'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The folder name cannot be empty.'
    )
    expect(screen.getByLabelText('Intro')).toBeInTheDocument()
    expect(
      useProjectStore.getState().projectFolders.find(f => f.id === 'f1')?.intro
    ).toBe('Old text')
  })

  it('discards the draft on cancel', () => {
    seedFolder({ id: 'f1', intro: 'Old text' })

    render(<FolderReadme folderId="f1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Intro'), {
      target: { value: 'Discarded' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Intro')).not.toBeInTheDocument()
    expect(screen.getByText('Old text')).toBeInTheDocument()
    expect(
      useProjectStore.getState().projectFolders.find(f => f.id === 'f1')?.intro
    ).toBe('Old text')
  })

  it('saving blank text clears the intro back to the empty state', () => {
    seedFolder({ id: 'f1', intro: 'Old text' })

    render(<FolderReadme folderId="f1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Intro'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      useProjectStore.getState().projectFolders.find(f => f.id === 'f1')?.intro
    ).toBeUndefined()
    expect(
      screen.getByText('No intro yet. Choose Edit to write one.')
    ).toBeInTheDocument()
  })

  it('docks the preflight feedback alongside the README', () => {
    seedFolder({ id: 'f1', intro: 'Spring tour set' })
    useProjectStore.setState({
      preflightStatus: 'error',
      preflightError: 'score server port taken',
    })

    render(<FolderReadme folderId="f1" />)

    expect(screen.getByText('Spring tour set')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('port taken')
  })
})
