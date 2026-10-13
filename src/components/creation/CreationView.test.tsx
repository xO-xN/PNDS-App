import { seedCreationDraft } from '@/test/creation-files'
import {
  creationProjectAction,
  creationFileButton,
  creationFileAction,
} from '@/test/desktop-actions'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import { within } from '@testing-library/react'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import {
  commands,
  type CreationContent,
  type CreationError,
  type CreationWorkspace,
  type Result,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { CreationView } from './CreationView'
import { DesktopBar } from '@/components/shell/DesktopBar'

const first: CreationWorkspace = {
  project: {
    identity: 'first',
    root: '/draft',
    name: 'Draft',
    source: 'folder',
  },
  files: [
    { path: 'public/score.js', kind: 'text', category: 'pages', size: 13 },
  ],
}

describe('creation reading workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.setState({ sessionStatus: 'idle' })
    useCreationStore.setState({
      modePhase: 'idle',
      modePlan: null,
      modeError: null,
      hoverPaused: false,
      modePointerInside: false,
      restoreModeFocus: false,
      active: true,
      workspace: null,
      recentPaths: ['/draft'],
      opening: false,
      request: null,
      error: null,
    })
    useCreationFilesStore.setState({
      drafts: {},
      activePath: null,
      renameNote: null,
    })
  })

  it('opens a real directory selection, reads and finds text, and opens Finder through the trusted identity', async () => {
    vi.mocked(open).mockResolvedValueOnce('/draft')
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: first,
    })
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'text', text: 'alpha beta alpha', version: 'v1' },
    })
    render(
      <>
        <CreationView />
        <DesktopBar />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open folder project' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'public/score.js' })
    )
    await screen.findByDisplayValue('alpha beta alpha')
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Find in current file' }),
      { target: { value: 'alpha' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    const editor = screen.getByRole('textbox', {
      name: 'public/score.js',
    }) as HTMLTextAreaElement
    expect(editor.selectionStart).toBe(0)
    expect(editor.selectionEnd).toBe(5)
    fireEvent.click(
      screen.getByRole('button', { name: 'Open project folder in Finder' })
    )
    await waitFor(() =>
      expect(commands.revealCreationPath).toHaveBeenCalledWith('first', null)
    )
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: /assistant/i })
    ).not.toBeInTheDocument()
  })

  it('removes a recent creation without opening or deleting the project', async () => {
    useCreationStore.setState({ recentPaths: ['/draft', '/older'] })
    render(<CreationView />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove draft from recent creations' })
    )
    expect(useCreationStore.getState().recentPaths).toEqual(['/older'])
    expect(
      screen.queryByRole('button', { name: 'draft' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'older' })).toBeInTheDocument()
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ recentCreationProjects: ['/older'] })
      )
    )
    expect(commands.prepareCreationProject).not.toHaveBeenCalled()
    expect(commands.closeCreationProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('opens the existing project picker from the titlebar while retaining the file draft', async () => {
    useCreationStore.setState({ workspace: first })
    seedCreationDraft('public/score.js', 'saved', 'v1')
    useCreationFilesStore.getState().edit('public/score.js', 'unsaved')
    useCreationFilesStore.getState().setActivePath('public/score.js')
    render(<CreationView />)
    const topbar = document.querySelector<HTMLElement>('[data-creation-topbar]')
    if (!topbar) throw new Error('Expected the creation titlebar')
    expect(
      within(topbar).getByRole('button', { name: 'Project actions' })
    ).toBeEnabled()
    expect(topbar).toHaveTextContent('Draft')
    expect(
      within(topbar).getByRole('button', { name: 'Generate .pnds' })
    ).toBeEnabled()
    const editor = await screen.findByDisplayValue('unsaved')
    await creationProjectAction('Switch to another project')
    const picker = await screen.findByRole('dialog', {
      name: 'Switch to another project',
    })
    expect(
      useCreationFilesStore.getState().drafts['public/score.js']?.text
    ).toBe('unsaved')
    fireEvent.click(within(picker).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByDisplayValue('unsaved')).toBe(editor)
    expect(commands.prepareCreationProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('watches external removal, keeps the draft accessible and explains the saved-disk runtime boundary', async () => {
    useCreationStore.setState({ workspace: first })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/draft',
    })
    seedCreationDraft('public/score.js', 'my page', 'v1')
    useCreationFilesStore.getState().edit('public/score.js', 'my unsaved page')
    vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
      status: 'ok',
      data: { files: [], changed: ['public/score.js'], revision: 1 },
    })
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'missing', detail: 'public/score.js' },
    })
    render(
      <>
        <CreationView />
        <DesktopBar />
      </>
    )
    await screen.findByText('Pages changed on disk · refresh pending')
    expect(screen.getByText(/unsaved drafts are excluded/i)).toBeInTheDocument()
    fireEvent.click(creationFileButton('public/score.js'))
    await screen.findByDisplayValue('my unsaved page')
    expect(await screen.findByLabelText('Disk changed')).toBeInTheDocument()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('shows source-tagged runtime errors in the console, copies details and keeps the edited file intact across tabs', async () => {
    useCreationStore.setState({ workspace: first })
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'text', text: 'original', version: 'v1' },
    })
    render(
      <>
        <CreationView />
        <DesktopBar />
      </>
    )
    fireEvent.click(creationFileButton('public/score.js'))
    const editor = await screen.findByRole('textbox', {
      name: 'public/score.js',
    })
    await screen.findByDisplayValue('original')
    fireEvent.change(editor, { target: { value: 'unsaved text' } })
    const result = await commands.getSessionState()
    if (result.status === 'error') throw new Error(result.error)
    vi.mocked(commands.getSessionState).mockResolvedValueOnce({
      status: 'ok',
      data: {
        ...result.data,
        status: 'error',
        projectPath: '/draft',
        error: 'Node exited',
        outputTail: ['[node] stopped unexpectedly'],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Console' }))
    expect(editor).toBeVisible()
    expect(editor).toHaveValue('unsaved text')
    await screen.findByText('[node] stopped unexpectedly')
    fireEvent.click(screen.getByRole('button', { name: 'Copy test details' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('Node exited')
      )
    )
    fireEvent.click(creationFileButton('public/score.js'))
    expect(screen.getByRole('textbox', { name: 'public/score.js' })).toBe(
      editor
    )
    expect(editor).toHaveValue('unsaved text')
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  })

  it('keeps the workspace when either selector is cancelled and explains protected source choices', async () => {
    useCreationStore.setState({ workspace: first })
    vi.mocked(commands.describeCreationProjects).mockResolvedValueOnce({
      status: 'ok',
      data: [
        { path: '/draft', project: first.project, error: null },
        {
          path: '/installed',
          project: { ...first.project, source: 'bundle', root: '/installed' },
          error: null,
        },
      ],
    })
    render(
      <>
        <CreationView />
        <DesktopBar />
      </>
    )
    await creationProjectAction('Switch to another project')
    await screen.findByText('Read-only · installed .pnds bundle')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useCreationStore.getState().workspace).toEqual(first)
    expect(commands.prepareCreationProject).not.toHaveBeenCalled()
  })

  it('isolates late reads and clears file search and errors when the project changes', async () => {
    let resolveRead!: (result: Result<CreationContent, CreationError>) => void
    vi.mocked(commands.readCreationFile).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRead = resolve
        })
    )
    useCreationStore.setState({ workspace: first })
    render(
      <>
        <CreationView />
        <DesktopBar />
      </>
    )
    fireEvent.click(creationFileButton('public/score.js'))
    await waitFor(() => expect(commands.readCreationFile).toHaveBeenCalled())
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search file paths' }),
      { target: { value: 'old' } }
    )
    await act(async () =>
      useCreationStore.setState({
        workspace: {
          ...first,
          project: { ...first.project, identity: 'second', name: 'Second' },
        },
      })
    )
    expect(
      screen.getByRole('textbox', { name: 'Search file paths' })
    ).toHaveValue('')
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'text', text: 'new contents', version: 'v2' },
    })
    fireEvent.click(creationFileButton('public/score.js'))
    await screen.findByDisplayValue('new contents')
    await act(async () =>
      resolveRead({
        status: 'error',
        error: { code: 'missing', detail: 'old error' },
      })
    )
    expect(screen.queryByText(/old error/)).not.toBeInTheDocument()
    expect(
      (
        screen.getByRole('textbox', {
          name: 'public/score.js',
        }) as HTMLTextAreaElement
      ).value
    ).toBe('new contents')
  })

  it('previews images on demand and falls back after decoding fails; audio has only file information', async () => {
    useCreationStore.setState({
      workspace: {
        ...first,
        files: [
          { path: 'image.gif', kind: 'image', category: 'assets', size: 12 },
          { path: 'audio.wav', kind: 'binary', category: 'audio', size: 100 },
        ],
      },
    })
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'image', url: 'data:image/gif;base64,AA==' },
    })
    render(
      <>
        <CreationView />
        <DesktopBar />
      </>
    )
    expect(commands.readCreationFile).not.toHaveBeenCalled()
    fireEvent.click(creationFileButton('image.gif'))
    fireEvent.error(await screen.findByRole('img', { name: 'image.gif' }))
    await screen.findByText(/could not be decoded/)
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'binary' },
    })
    fireEvent.click(creationFileButton('audio.wav'))
    await screen.findByText('WAV · 100 bytes')
    expect(document.querySelector('audio')).toBeNull()
  })

  describe('creation draft editing (#154)', () => {
    const twoFiles: CreationWorkspace = {
      project: first.project,
      files: [
        { path: 'public/score.js', kind: 'text', category: 'pages', size: 13 },
        { path: 'public/notes.js', kind: 'text', category: 'pages', size: 8 },
      ],
    }

    beforeEach(() => {
      vi.clearAllMocks()
      useSessionStore.setState({ sessionStatus: 'idle' })
      useCreationStore.setState({
        modePhase: 'idle',
        modePlan: null,
        modeError: null,
        hoverPaused: false,
        modePointerInside: false,
        restoreModeFocus: false,
        active: true,
        workspace: twoFiles,
        recentPaths: ['/draft'],
        opening: false,
        request: null,
        error: null,
      })
      useCreationFilesStore.setState({
        drafts: {},
        activePath: null,
        renameNote: null,
      })
    })

    it('keeps per-file drafts across file switches and shows the unsaved consequence', async () => {
      vi.mocked(commands.readCreationFile)
        .mockResolvedValueOnce({
          status: 'ok',
          data: { kind: 'text', text: 'score contents', version: 'v1' },
        })
        .mockResolvedValueOnce({
          status: 'ok',
          data: { kind: 'text', text: 'note contents', version: 'n1' },
        })
      render(
        <>
          <CreationView />
          <DesktopBar />
        </>
      )
      fireEvent.click(creationFileButton('public/score.js'))
      const editor = (await screen.findByDisplayValue(
        'score contents'
      )) as HTMLTextAreaElement
      fireEvent.change(editor, { target: { value: 'score edited' } })
      expect(
        document.querySelectorAll('.creation-file-row .creation-dirty-dot')
          .length
      ).toBe(1)
      fireEvent.click(creationFileButton('public/notes.js'))
      await screen.findByDisplayValue('note contents')
      // Switching back restores the draft exactly, without re-reading disk.
      fireEvent.click(creationFileButton('public/score.js'))
      expect(
        (await screen.findByDisplayValue('score edited')) as HTMLTextAreaElement
      ).toBeTruthy()
      expect(commands.readCreationFile).toHaveBeenCalledTimes(2)
      // The mode button's confirm shows the real discard consequence.
      fireEvent.click(
        screen.getByRole('button', { name: 'Return to performance mode' })
      )
      await waitFor(() =>
        expect(
          screen.getByText(
            'End testing, close test windows and projection, and discard 1 unsaved files or handoff tasks. Esc cancels.'
          )
        ).toBeInTheDocument()
      )
      // Esc cancels the switch and keeps the draft, run and windows.
      fireEvent.keyDown(window, { key: 'Escape' })
      await waitFor(() =>
        expect(useCreationStore.getState().modePhase).toBe('idle')
      )
      expect(
        useCreationFilesStore.getState().drafts['public/score.js']?.text
      ).toBe('score edited')
    })

    it('resolves save conflicts through reload or an overwrite bound to the displayed version', async () => {
      vi.mocked(commands.readCreationFile).mockResolvedValue({
        status: 'ok',
        data: { kind: 'text', text: 'score contents', version: 'v1' },
      })
      render(
        <>
          <CreationView />
          <DesktopBar />
        </>
      )
      fireEvent.click(creationFileButton('public/score.js'))
      fireEvent.change(await screen.findByDisplayValue('score contents'), {
        target: { value: 'score edited' },
      })
      vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: { kind: 'text', text: 'external agent text', version: 'v2' },
      })
      vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
        status: 'error',
        error: { code: 'versionConflict', detail: 'public/score.js' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(
        await screen.findByText('The file changed on disk')
      ).toBeInTheDocument()
      // The draft is untouched while the choice is open.
      expect(screen.getByDisplayValue('score edited')).toBeInTheDocument()
      await creationFileAction('Reload from disk')
      await screen.findByDisplayValue('external agent text')
      expect(
        screen.queryByText('The file changed on disk')
      ).not.toBeInTheDocument()

      // After the reload the draft bases on v2. Editing and saving again
      // carries v2; the disk moved to v3, so the choice re-opens.
      fireEvent.change(screen.getByDisplayValue('external agent text'), {
        target: { value: 'overwritten draft' },
      })
      vi.mocked(commands.saveCreationFile)
        .mockResolvedValueOnce({
          status: 'error',
          error: { code: 'versionConflict', detail: 'public/score.js' },
        })
        .mockResolvedValueOnce({
          status: 'error',
          error: { code: 'versionConflict', detail: 'public/score.js' },
        })
        .mockResolvedValueOnce({ status: 'ok', data: 'v5' })
      vi.mocked(commands.readCreationFile)
        .mockResolvedValueOnce({
          status: 'ok',
          data: { kind: 'text', text: 'newer external', version: 'v3' },
        })
        .mockResolvedValueOnce({
          status: 'ok',
          data: { kind: 'text', text: 'final external', version: 'v4' },
        })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await screen.findByText('The file changed on disk')
      // Overwrite binds to the displayed v3; the disk moving to v4 during
      // the attempt refuses that overwrite and re-opens the choice.
      fireEvent.click(
        screen.getByRole('button', { name: 'Overwrite and save' })
      )
      await waitFor(() =>
        expect(commands.saveCreationFile).toHaveBeenLastCalledWith(
          'first',
          'public/score.js',
          'overwritten draft',
          'v3'
        )
      )
      expect(
        await screen.findByText('The file changed on disk')
      ).toBeInTheDocument()
      expect(screen.getByDisplayValue('overwritten draft')).toBeInTheDocument()
      // Confirming again against the now-displayed v4 finally lands.
      fireEvent.click(
        screen.getByRole('button', { name: 'Overwrite and save' })
      )
      await waitFor(() =>
        expect(
          screen.queryByText('The file changed on disk')
        ).not.toBeInTheDocument()
      )
      expect(commands.saveCreationFile).toHaveBeenLastCalledWith(
        'first',
        'public/score.js',
        'overwritten draft',
        'v4'
      )
    })

    it('renames through the command boundary, keeps the draft and hints at external references', async () => {
      vi.mocked(commands.readCreationFile).mockResolvedValue({
        status: 'ok',
        data: { kind: 'text', text: 'score contents', version: 'v1' },
      })
      render(
        <>
          <CreationView />
          <DesktopBar />
        </>
      )
      fireEvent.click(creationFileButton('public/score.js'))
      fireEvent.change(await screen.findByDisplayValue('score contents'), {
        target: { value: 'score edited' },
      })
      await creationFileAction('Rename')
      const dialog = await screen.findByRole('dialog')
      expect(
        within(dialog).getByText(
          'Related code references may need an external agent to adjust.'
        )
      ).toBeInTheDocument()
      fireEvent.change(
        within(dialog).getByRole('textbox', {
          name: 'Path inside the project',
        }),
        { target: { value: 'public/renamed.js' } }
      )
      vi.mocked(commands.renameCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: 'public/renamed.js',
      })
      vi.mocked(commands.listCreationFiles).mockResolvedValueOnce({
        status: 'ok',
        data: [
          {
            path: 'public/renamed.js',
            kind: 'text',
            category: 'pages',
            size: 13,
          },
        ],
      })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
      await screen.findByDisplayValue('score edited')
      expect(commands.renameCreationFile).toHaveBeenCalledWith(
        'first',
        'public/score.js',
        'public/renamed.js',
        []
      )
      expect(creationFileButton('public/renamed.js')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'public/score.js' })
      ).not.toBeInTheDocument()
      expect(screen.getByText(/File renamed\./)).toBeInTheDocument()
      expect(
        useCreationFilesStore.getState().drafts['public/renamed.js']?.text
      ).toBe('score edited')

      // Existing targets surface readable failures without touching disk.
      await creationFileAction('Rename')
      const retry = await screen.findByRole('dialog')
      fireEvent.change(
        within(retry).getByRole('textbox', { name: 'Path inside the project' }),
        { target: { value: 'public/taken.js' } }
      )
      vi.mocked(commands.renameCreationFile).mockResolvedValueOnce({
        status: 'error',
        error: { code: 'targetExists', detail: 'public/taken.js' },
      })
      fireEvent.click(within(retry).getByRole('button', { name: 'Rename' }))
      expect(
        await screen.findByText(
          'The target file already exists; nothing was overwritten.'
        )
      ).toBeInTheDocument()
    })

    it('saves the active draft with ⌘S and keeps read-only sources read-only', async () => {
      function KeyboardHarness() {
        useCommandKeyboard()
        return <CreationView />
      }
      vi.mocked(commands.readCreationFile).mockResolvedValue({
        status: 'ok',
        data: { kind: 'text', text: 'score contents', version: 'v1' },
      })
      const { rerender } = render(<KeyboardHarness />)
      fireEvent.click(creationFileButton('public/score.js'))
      fireEvent.change(await screen.findByDisplayValue('score contents'), {
        target: { value: 'score edited' },
      })
      vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: 'v2',
      })
      fireEvent(
        window,
        new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          metaKey: true,
          bubbles: true,
        })
      )
      await waitFor(() =>
        expect(commands.saveCreationFile).toHaveBeenCalledWith(
          'first',
          'public/score.js',
          'score edited',
          'v1'
        )
      )

      // A clean draft can adopt an external disk change by reloading.
      vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: { kind: 'text', text: 'newer disk contents', version: 'v3' },
      })
      await creationFileAction('Reload from disk')
      await screen.findByDisplayValue('newer disk contents')

      useCreationStore.setState({
        workspace: {
          project: { ...first.project, identity: 'readonly', source: 'bundle' },
          files: [
            {
              path: 'public/score.js',
              kind: 'text',
              category: 'pages',
              size: 13,
            },
          ],
        },
      })
      rerender(<KeyboardHarness />)
      fireEvent.click(creationFileButton('public/score.js'))
      await screen.findByText('score contents')
      expect(
        screen.queryByRole('button', { name: 'Save' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Rename' })
      ).not.toBeInTheDocument()
      expect(
        screen.getByText('File reading · edits continue externally')
      ).toBeInTheDocument()
    })
  })

  describe('creation manifest form (#158)', () => {
    const manifestWorkspace: CreationWorkspace = {
      project: first.project,
      files: [
        { path: 'manifest.json', kind: 'text', category: 'system', size: 400 },
        { path: 'public/score.js', kind: 'text', category: 'pages', size: 13 },
      ],
    }
    const diskManifest = JSON.stringify({
      schemaVersion: 1,
      id: 'inarticulate-iii',
      name: 'Inarticulate III',
      version: '1.0.1',
      scoreServer: {
        entry: 'server.js',
        workingDirectory: '.',
        performerPort: 6868,
        monitorPort: 6869,
        routes: { '/health': 'stub' },
      },
      roles: ['alpha'],
      audio: {
        defaultMode: 'internal',
        supportedModes: ['internal', 'external'],
        outputChannels: 2,
        synthdefs: ['supercollider/synthdefs/a.scsyndef'],
        scsynth: { sampleRate: 96000, blockSize: 64, audioBusChannels: 128 },
      },
    })

    beforeEach(() => {
      vi.clearAllMocks()
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {
            /* No jsdom layout. */
          }
          unobserve() {
            /* No observed element. */
          }
          disconnect() {
            /* No observer to disconnect. */
          }
        }
      )
      useSessionStore.setState({ sessionStatus: 'idle' })
      useCreationStore.setState({
        modePhase: 'idle',
        modePlan: null,
        modeError: null,
        hoverPaused: false,
        modePointerInside: false,
        restoreModeFocus: false,
        active: true,
        workspace: manifestWorkspace,
        recentPaths: ['/draft'],
        opening: false,
        request: null,
        error: null,
      })
      useCreationFilesStore.setState({
        drafts: {},
        activePath: null,
        renameNote: null,
      })
    })

    it('edits declarations through the form and saves disk output that preserves unknown fields', async () => {
      vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: { kind: 'text', text: diskManifest, version: 'v1' },
      })
      vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: 'v2',
      })
      render(
        <>
          <CreationView />
          <DesktopBar />
        </>
      )
      fireEvent.click(screen.getByRole('button', { name: 'manifest.json' }))
      const name = (await screen.findByLabelText(
        'Work title'
      )) as HTMLInputElement
      expect(name.value).toBe('Inarticulate III')
      expect(
        screen.queryByRole('textbox', { name: 'manifest.json' })
      ).not.toBeInTheDocument()
      fireEvent.change(name, { target: { value: 'Renamed III' } })
      fireEvent.change(screen.getByLabelText('Performer port'), {
        target: { value: '6870' },
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'External' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(commands.saveCreationFile).toHaveBeenCalledTimes(1)
      )
      const saveCall = vi.mocked(commands.saveCreationFile).mock.calls.at(0)
      if (!saveCall) throw new Error('saveCreationFile was not called')
      const [identity, path, text, version] = saveCall
      expect(identity).toBe('first')
      expect(path).toBe('manifest.json')
      expect(version).toBe('v1')
      const saved = JSON.parse(text)
      expect(saved.name).toBe('Renamed III')
      expect(saved.scoreServer.performerPort).toBe(6870)
      expect(saved.audio.supportedModes).toEqual(['internal'])
      // Unknown and unedited fields survive the form round-trip untouched.
      expect(saved.roles).toEqual(['alpha'])
      expect(saved.scoreServer.routes).toEqual({ '/health': 'stub' })
      expect(saved.audio.scsynth.sampleRate).toBe(96000)
      expect(saved.audio.scsynth.blockSize).toBe(64)
      expect(text.endsWith('\n')).toBe(true)
    })

    it('shows the save-gate rejection readably and keeps the draft dirty', async () => {
      vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: { kind: 'text', text: diskManifest, version: 'v1' },
      })
      vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
        status: 'error',
        error: {
          code: 'manifestInvalid',
          detail:
            'audio.supportedModes must be a non-empty array of internal, external or none',
        },
      })
      render(
        <>
          <CreationView />
          <DesktopBar />
        </>
      )
      fireEvent.click(screen.getByRole('button', { name: 'manifest.json' }))
      await screen.findByLabelText('Work title')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Internal' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'External' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(
        await screen.findByText(/failed save validation/i)
      ).toBeInTheDocument()
      expect(
        screen.getByText(/non-empty array of internal/)
      ).toBeInTheDocument()
      expect(
        useCreationFilesStore.getState().drafts['manifest.json']?.text
      ).toContain('"supportedModes": []')
    })

    it('falls back to the text view for non-object JSON and recovers once fixed', async () => {
      vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: { kind: 'text', text: '{ not json', version: 'v1' },
      })
      render(
        <>
          <CreationView />
          <DesktopBar />
        </>
      )
      fireEvent.click(screen.getByRole('button', { name: 'manifest.json' }))
      expect(
        await screen.findByText(/not an editable JSON object/i)
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Text' }))
      const editor = screen.getByRole('textbox', {
        name: 'manifest.json',
      }) as HTMLTextAreaElement
      expect(editor.value).toBe('{ not json')
      fireEvent.change(editor, { target: { value: diskManifest } })
      fireEvent.click(screen.getByRole('button', { name: 'Form' }))
      expect(
        ((await screen.findByLabelText('Work title')) as HTMLInputElement).value
      ).toBe('Inarticulate III')
    })

    it('shares one draft across the form and text views', async () => {
      vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: { kind: 'text', text: diskManifest, version: 'v1' },
      })
      render(
        <>
          <CreationView />
          <DesktopBar />
        </>
      )
      fireEvent.click(screen.getByRole('button', { name: 'manifest.json' }))
      fireEvent.change(await screen.findByLabelText('Work title'), {
        target: { value: 'Form edit' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Text' }))
      const editor = screen.getByRole('textbox', {
        name: 'manifest.json',
      }) as HTMLTextAreaElement
      expect(editor.value).toContain('"name": "Form edit"')
      fireEvent.change(editor, {
        target: { value: editor.value.replace('"1.0.1"', '"1.0.2"') },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Form' }))
      expect(
        ((await screen.findByLabelText('Version')) as HTMLInputElement).value
      ).toBe('1.0.2')
      expect(
        ((await screen.findByLabelText('Work title')) as HTMLInputElement).value
      ).toBe('Form edit')
    })

    it('resolves manifest save conflicts through the shared reload-or-overwrite flow', async () => {
      vi.mocked(commands.readCreationFile)
        .mockResolvedValueOnce({
          status: 'ok',
          data: { kind: 'text', text: diskManifest, version: 'v1' },
        })
        .mockResolvedValueOnce({
          status: 'ok',
          data: {
            kind: 'text',
            text: JSON.stringify({
              ...JSON.parse(diskManifest),
              name: 'External edit',
            }),
            version: 'v9',
          },
        })
      vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
        status: 'error',
        error: { code: 'versionConflict', detail: 'manifest.json' },
      })
      render(
        <>
          <CreationView />
          <DesktopBar />
        </>
      )
      fireEvent.click(screen.getByRole('button', { name: 'manifest.json' }))
      fireEvent.change(await screen.findByLabelText('Work title'), {
        target: { value: 'Renamed III' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await screen.findByText('The file changed on disk')
      await creationFileAction('Reload from disk')
      expect(
        ((await screen.findByLabelText('Work title')) as HTMLInputElement).value
      ).toBe('External edit')
      const draft = useCreationFilesStore.getState().drafts['manifest.json']
      expect(draft?.conflict).toBeNull()
      expect(draft?.diskVersion).toBe('v9')
      expect(draft?.text).toBe(draft?.diskText)
    })

    it('flags non-integer numbers without snapping the field mid-keystroke', async () => {
      vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
        status: 'ok',
        data: { kind: 'text', text: diskManifest, version: 'v1' },
      })
      render(
        <>
          <CreationView />
          <DesktopBar />
        </>
      )
      fireEvent.click(screen.getByRole('button', { name: 'manifest.json' }))
      const port = (await screen.findByLabelText(
        'Performer port'
      )) as HTMLInputElement
      fireEvent.focus(port)
      fireEvent.change(port, { target: { value: '68a' } })
      expect(port.value).toBe('68a')
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /whole number/i
      )
      expect(
        useCreationFilesStore.getState().drafts['manifest.json']?.text
      ).not.toContain('performerPort')
      fireEvent.blur(port)
      expect(port.value).toBe('')
    })
  })
})
