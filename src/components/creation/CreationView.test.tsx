import { beforeEach, describe, expect, it, vi } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import { within } from '@testing-library/react'
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
import { useCreationDraftsStore } from '@/store/creation-drafts-store'
import { useSessionStore } from '@/store/session-store'
import { CreationView } from './CreationView'

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
    useCreationDraftsStore.setState({
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
    render(<CreationView />)
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
      screen.queryByRole('button', { name: /new project|assistant|console/i })
    ).not.toBeInTheDocument()
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
    render(<CreationView />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to another project' })
    )
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
    render(<CreationView />)
    fireEvent.click(screen.getByRole('button', { name: 'public/score.js' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'public/score.js' }))
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
    render(<CreationView />)
    expect(commands.readCreationFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'image.gif' }))
    fireEvent.error(await screen.findByRole('img', { name: 'image.gif' }))
    await screen.findByText(/could not be decoded/)
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'binary' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'audio.wav' }))
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
      useCreationDraftsStore.setState({
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
      render(<CreationView />)
      fireEvent.click(screen.getByRole('button', { name: 'public/score.js' }))
      const editor = (await screen.findByDisplayValue(
        'score contents'
      )) as HTMLTextAreaElement
      fireEvent.change(editor, { target: { value: 'score edited' } })
      expect(
        document.querySelectorAll('.creation-file-row .creation-dirty-dot')
          .length
      ).toBe(1)
      fireEvent.click(screen.getByRole('button', { name: 'public/notes.js' }))
      await screen.findByDisplayValue('note contents')
      // Switching back restores the draft exactly, without re-reading disk.
      fireEvent.click(screen.getByRole('button', { name: 'public/score.js' }))
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
            'End testing, close test windows and projection, and discard 1 unsaved files. Esc cancels.'
          )
        ).toBeInTheDocument()
      )
      // Esc cancels the switch and keeps the draft, run and windows.
      fireEvent.keyDown(window, { key: 'Escape' })
      await waitFor(() =>
        expect(useCreationStore.getState().modePhase).toBe('idle')
      )
      expect(
        useCreationDraftsStore.getState().drafts['public/score.js']?.text
      ).toBe('score edited')
    })

    it('resolves save conflicts through reload or an overwrite bound to the displayed version', async () => {
      vi.mocked(commands.readCreationFile).mockResolvedValue({
        status: 'ok',
        data: { kind: 'text', text: 'score contents', version: 'v1' },
      })
      render(<CreationView />)
      fireEvent.click(screen.getByRole('button', { name: 'public/score.js' }))
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
      fireEvent.click(screen.getByRole('button', { name: 'Reload from disk' }))
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
      render(<CreationView />)
      fireEvent.click(screen.getByRole('button', { name: 'public/score.js' }))
      fireEvent.change(await screen.findByDisplayValue('score contents'), {
        target: { value: 'score edited' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
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
        'public/renamed.js'
      )
      expect(
        screen.getByRole('button', { name: 'public/renamed.js' })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'public/score.js' })
      ).not.toBeInTheDocument()
      expect(screen.getByText(/File renamed\./)).toBeInTheDocument()
      expect(
        useCreationDraftsStore.getState().drafts['public/renamed.js']?.text
      ).toBe('score edited')

      // Existing targets surface readable failures without touching disk.
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
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
      fireEvent.click(screen.getByRole('button', { name: 'public/score.js' }))
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
      fireEvent.click(screen.getByRole('button', { name: 'Reload from disk' }))
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
      fireEvent.click(screen.getByRole('button', { name: 'public/score.js' }))
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
})
