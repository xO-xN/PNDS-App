import { beforeEach, describe, expect, it, vi } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import {
  commands,
  type CreationContent,
  type CreationError,
  type CreationWorkspace,
  type Result,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
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
  })

  it('opens a real directory selection, reads and finds text, and opens Finder through the trusted identity', async () => {
    vi.mocked(open).mockResolvedValueOnce('/draft')
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: first,
    })
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'text', text: 'alpha beta alpha' },
    })
    render(<CreationView />)
    fireEvent.click(screen.getByRole('button', { name: 'Open folder project' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'public/score.js' })
    )
    await screen.findByText('alpha beta alpha')
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Find in current file' }),
      { target: { value: 'alpha' } }
    )
    expect(document.querySelector('mark')).toHaveTextContent('alpha')
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
      data: { kind: 'text', text: 'new contents' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'public/score.js' }))
    await screen.findByText('new contents')
    await act(async () =>
      resolveRead({
        status: 'error',
        error: { code: 'missing', detail: 'old error' },
      })
    )
    expect(screen.queryByText(/old error/)).not.toBeInTheDocument()
    expect(screen.getByText('new contents')).toBeInTheDocument()
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
})
