import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { editText, findEditorWithText } from '@/test/text-editor'
import {
  commands,
  type CreationMaterial,
  type CreationWorkspace,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { CreationView } from './CreationView'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { saveGitVersion } from '@/lib/creation-git-workflow'
import { confirmDiscardCreationDrafts } from '@/lib/creation-lifecycle'
import { useCreationPendingStore } from '@/store/creation-pending-store'
import { creationFileButton } from '@/test/desktop-actions'

let documents: CreationMaterial[] = []
let texts = new Map<string, string>()
const original: CreationMaterial = {
  id: '0123456789abcdef0123456789abcdef',
  name: 'Tide.js',
  version: 'saved-1',
  size: 15,
  totalCharacters: 15,
}

function Keyboard() {
  useCommandKeyboard()
  return null
}

const workspace: CreationWorkspace = {
  project: {
    identity: 'pending-project',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.startPendingAudioPreview)
    .mockReset()
    .mockResolvedValue({ status: 'error', error: 'playback' })
  vi.mocked(commands.controlPendingAudioPreview)
    .mockReset()
    .mockResolvedValue({ status: 'error', error: 'cancelled' })
  useSessionStore.setState({
    outputDevice: 'System default',
    volume: 80,
    muted: false,
    sessionStatus: 'idle',
    latestSnapshot: null,
  })
  useCreationStore.setState({
    active: true,
    workspace: null,
    opening: false,
    modePhase: 'idle',
  })
  useCreationStore.setState({ workspace })
  useCreationFilesStore.getState().clear()
  documents = []
  texts = new Map()
  vi.mocked(commands.listCreationPendingMedia)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: [] })
  vi.mocked(commands.listCreationMaterials).mockImplementation(async () => ({
    status: 'ok',
    data: [...documents],
  }))
  vi.mocked(commands.readCreationPendingDocument).mockImplementation(
    async (_identity, id, version) => {
      const document = documents.find(item => item.id === id)
      return document && document.version === version
        ? { status: 'ok', data: { document, text: texts.get(id) ?? '' } }
        : { status: 'error', error: 'versionConflict' }
    }
  )
  vi.mocked(commands.saveCreationPendingDocument).mockImplementation(
    async (_identity, input) => {
      const old = documents.find(item => item.id === input.id)
      if ((old?.version ?? null) !== input.version)
        return { status: 'error', error: 'versionConflict' }
      if (
        documents.some(item => item.id !== input.id && item.name === input.name)
      )
        return { status: 'error', error: 'nameConflict' }
      const saved = {
        id: input.id,
        name: input.name,
        version: `saved-${Number(old?.version.split('-').at(-1) ?? 0) + 1}`,
        size: input.text.length,
        totalCharacters: input.text.length,
      }
      documents = [...documents.filter(item => item.id !== input.id), saved]
      texts.set(input.id, input.text)
      return { status: 'ok', data: saved }
    }
  )
  vi.mocked(confirm).mockReset().mockResolvedValue(false)
  vi.mocked(message).mockReset().mockResolvedValue('Cancel')
})

it('creates a draft in the main editor and saves a private independent document only on Save', async () => {
  const user = userEvent.setup()
  render(<CreationView />)
  await user.click(await screen.findByRole('button', { name: 'New text file' }))
  const name = await screen.findByRole('textbox', { name: 'Document name' })
  await user.type(name, 'Tide.js{Enter}')
  editText(await findEditorWithText(''), 'const tide = 7')
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(commands.saveCreationPendingDocument).toHaveBeenCalledWith(
      'pending-project',
      {
        id: expect.stringMatching(/^[a-f0-9]{32}$/),
        name: 'Tide.js',
        text: 'const tide = 7',
        version: null,
      }
    )
  )
  expect(await screen.findByText('Saved')).toBeVisible()
})

it('preserves pending drafts and editor history while switching documents, and routes Command-S to the active pending identity', async () => {
  const user = userEvent.setup()
  render(
    <>
      <Keyboard />
      <CreationView />
    </>
  )
  await user.click(await screen.findByRole('button', { name: 'New text file' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Document name' }),
    'First.js{Enter}'
  )
  editText(await findEditorWithText(''), 'first draft')
  await user.click(screen.getByRole('button', { name: 'New text file' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Document name' }),
    'Second.md{Enter}'
  )
  editText(await findEditorWithText(''), 'second draft')
  await user.click(screen.getByRole('button', { name: 'First.js' }))
  const editor = await findEditorWithText('first draft')
  fireEvent.keyDown(editor, { key: 's', code: 'KeyS', metaKey: true })
  await waitFor(() =>
    expect(commands.saveCreationPendingDocument).toHaveBeenCalledWith(
      'pending-project',
      expect.objectContaining({
        name: 'First.js',
        text: 'first draft',
        version: null,
      })
    )
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Second.md' }))
  expect(await findEditorWithText('second draft')).toBeVisible()
})

it('refreshes a clean external edit and preserves a dirty draft behind an exact-version conflict choice', async () => {
  documents = [original]
  texts.set(original.id, 'original source')
  const user = userEvent.setup()
  render(<CreationView />)
  await user.click(await screen.findByRole('button', { name: 'Tide.js' }))
  await findEditorWithText('original source')
  documents = [{ ...original, version: 'saved-2' }]
  texts.set(original.id, 'external clean edit')
  fireEvent.focus(window)
  const editor = await findEditorWithText('external clean edit')
  editText(editor, 'my unsaved draft')
  documents = [{ ...original, version: 'saved-3' }]
  texts.set(original.id, 'external conflict edit')
  fireEvent.focus(window)
  await screen.findByText(
    'This document changed outside PNDS. Your draft is kept. Review the saved content before reloading or replacing that exact version.'
  )
  expect(await findEditorWithText('my unsaved draft')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(commands.saveCreationPendingDocument).not.toHaveBeenCalled()
  await user.click(
    screen.getByRole('button', { name: 'Replace displayed saved version' })
  )
  await waitFor(() =>
    expect(commands.saveCreationPendingDocument).toHaveBeenCalledWith(
      'pending-project',
      expect.objectContaining({
        id: original.id,
        text: 'my unsaved draft',
        version: 'saved-3',
      })
    )
  )
  expect(await screen.findByText('Saved')).toBeVisible()
})

it('keeps the draft and prevents a project-version record when private saving fails', async () => {
  const user = userEvent.setup()
  render(<CreationView />)
  await user.click(await screen.findByRole('button', { name: 'New text file' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Document name' }),
    'Notes{Enter}'
  )
  editText(await findEditorWithText(''), 'keep this text')
  vi.mocked(commands.saveCreationPendingDocument).mockResolvedValue({
    status: 'error',
    error: 'storage',
  })
  await act(async () => {
    await expect(
      saveGitVersion('pending-project', 'Version', '')
    ).rejects.toThrow()
  })
  expect(commands.previewCreationGitRecord).not.toHaveBeenCalled()
  expect(await findEditorWithText('keep this text')).toBeVisible()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Existing saved pending documents are kept'
  )
})

it('offers Save, Discard and Cancel before leaving a pending draft and refuses a failed save', async () => {
  const user = userEvent.setup()
  render(<CreationView />)
  await user.click(await screen.findByRole('button', { name: 'New text file' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Document name' }),
    'Notes{Enter}'
  )
  editText(await findEditorWithText(''), 'my notes')
  await act(async () => {
    expect(await confirmDiscardCreationDrafts()).toBe(false)
  })
  expect(vi.mocked(message).mock.lastCall?.[1]).toMatchObject({
    buttons: {
      yes: 'Save and continue',
      no: 'Discard drafts',
      cancel: 'Cancel',
    },
  })
  vi.mocked(message).mockResolvedValueOnce('Discard drafts')
  await act(async () => {
    expect(await confirmDiscardCreationDrafts()).toBe(true)
  })
  expect(await findEditorWithText('my notes')).toBeVisible()
  vi.mocked(message).mockResolvedValueOnce('Save and continue')
  vi.mocked(commands.saveCreationPendingDocument).mockResolvedValueOnce({
    status: 'error',
    error: 'storage',
  })
  await act(async () => {
    expect(await confirmDiscardCreationDrafts()).toBe(false)
  })
  expect(await findEditorWithText('my notes')).toBeVisible()
  vi.mocked(message).mockResolvedValueOnce('Save and continue')
  await act(async () => {
    expect(await confirmDiscardCreationDrafts()).toBe(true)
  })
  expect(await screen.findByText('Saved')).toBeVisible()
})

it('preserves the document identity on rename and confirms deletion of only the private copy', async () => {
  documents = [original]
  texts.set(original.id, 'original source')
  vi.mocked(commands.renameCreationPendingDocument).mockImplementation(
    async (_identity, id, _version, name) => ({
      status: 'ok',
      data: { ...original, id, name },
    })
  )
  vi.mocked(commands.revealCreationPendingDocument).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.deleteCreationPendingDocument).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  const user = userEvent.setup()
  render(<CreationView />)
  await user.click(await screen.findByRole('button', { name: 'Tide.js' }))
  editText(await findEditorWithText('original source'), 'dirty source')
  await user.click(screen.getByRole('button', { name: 'Rename' }))
  const field = screen.getByRole('textbox', { name: 'Document name' })
  await user.clear(field)
  await user.type(field, 'NewTide.js{Enter}')
  await waitFor(() =>
    expect(commands.renameCreationPendingDocument).toHaveBeenCalledWith(
      'pending-project',
      original.id,
      'saved-1',
      'NewTide.js'
    )
  )
  expect(await findEditorWithText('dirty source')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Show in Finder' }))
  expect(commands.revealCreationPendingDocument).toHaveBeenCalledWith(
    'pending-project',
    original.id,
    'saved-1'
  )
  await user.click(screen.getByRole('button', { name: 'Delete document' }))
  expect(commands.deleteCreationPendingDocument).not.toHaveBeenCalled()
  vi.mocked(confirm).mockResolvedValueOnce(true)
  await user.click(screen.getByRole('button', { name: 'Delete document' }))
  await waitFor(() =>
    expect(commands.deleteCreationPendingDocument).toHaveBeenCalledWith(
      'pending-project',
      original.id,
      'saved-1'
    )
  )
  expect(commands.removeCreationAssistantFile).not.toHaveBeenCalled()
  expect(useCreationPendingStore.getState().drafts).toEqual({})
})

it('keeps an externally deleted document draft reachable while ordinary file navigation selects the correct editor', async () => {
  documents = [original]
  texts.set(original.id, 'original source')
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        files: [
          { path: 'server.js', category: 'system', kind: 'text', size: 10 },
        ],
      },
    })
  )
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: 'ordinary source', version: 'ordinary-1' },
  })
  const user = userEvent.setup()
  render(<CreationView />)
  await user.click(await screen.findByRole('button', { name: 'Tide.js' }))
  editText(await findEditorWithText('original source'), 'recover this draft')
  documents = []
  fireEvent.focus(window)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'no longer available'
  )
  await user.click(creationFileButton('server.js'))
  expect(await findEditorWithText('ordinary source')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Tide.js' }))
  expect(await findEditorWithText('recover this draft')).toBeVisible()
  expect(commands.deleteCreationPendingDocument).not.toHaveBeenCalled()
})

it('retains both drafts when a new saved name conflicts with an existing document', async () => {
  documents = [original]
  texts.set(original.id, 'original source')
  const user = userEvent.setup()
  render(<CreationView />)
  await user.click(await screen.findByRole('button', { name: 'New text file' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Document name' }),
    'Tide.js{Enter}'
  )
  editText(await findEditorWithText(''), 'new source')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose a different name'
  )
  expect(await findEditorWithText('new source')).toBeVisible()
  expect(documents).toEqual([original])
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('previews an image on demand and keeps the pending text draft', async () => {
  documents = [original]
  texts.set(original.id, 'const tide = 1')
  const image = {
    id: 'pending-image',
    name: 'Still.png',
    version: 'image-version',
    size: 68,
    mime: 'image/png',
  }
  vi.mocked(commands.listCreationPendingMedia).mockResolvedValue({
    status: 'ok',
    data: [image],
  })
  vi.mocked(commands.readCreationPendingImage).mockResolvedValueOnce({
    status: 'ok',
    data: 'data:image/png;base64,AA==',
  })
  const user = userEvent.setup()
  render(<CreationView />)
  const resources = within(
    await screen.findByRole('region', { name: 'Creation resources' })
  )
  const preview = await resources.findByRole('button', { name: image.name })
  expect(commands.readCreationPendingImage).not.toHaveBeenCalled()
  await user.click(resources.getByRole('button', { name: original.name }))
  editText(await findEditorWithText('const tide = 1'), 'const tide = 2')

  await user.click(preview)
  const bitmap = await screen.findByRole('img', { name: image.name })
  Object.defineProperties(bitmap, {
    naturalWidth: { value: 600 },
    naturalHeight: { value: 400 },
  })
  fireEvent.load(bitmap)
  expect(screen.getByRole('status', { name: 'Image zoom' })).toHaveTextContent(
    'Fit'
  )
  await user.click(screen.getByRole('button', { name: '100%' }))
  expect(screen.getByRole('status', { name: 'Image zoom' })).toHaveTextContent(
    '100%'
  )
  await user.click(screen.getByRole('button', { name: 'Zoom in' }))
  expect(screen.getByRole('status', { name: 'Image zoom' })).toHaveTextContent(
    '125%'
  )

  const canvas = screen.getByRole('region', { name: 'Image canvas' })
  Object.defineProperties(canvas, {
    clientWidth: { value: 300 },
    clientHeight: { value: 200 },
    scrollWidth: { value: 750 },
    scrollHeight: { value: 500 },
    setPointerCapture: { value: vi.fn() },
  })
  fireEvent.pointerDown(canvas, {
    pointerId: 1,
    button: 0,
    clientX: 80,
    clientY: 90,
  })
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 35, clientY: 50 })
  expect(canvas.scrollLeft).toBe(45)
  expect(canvas.scrollTop).toBe(40)
  fireEvent.lostPointerCapture(canvas, { pointerId: 1 })
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 0, clientY: 0 })
  expect(canvas.scrollLeft).toBe(45)
  expect(canvas.scrollTop).toBe(40)

  await user.click(screen.getByRole('button', { name: 'Fit to window' }))
  expect(screen.getByRole('status', { name: 'Image zoom' })).toHaveTextContent(
    'Fit'
  )
  await user.click(resources.getByRole('button', { name: original.name }))
  await findEditorWithText('const tide = 2')
  expect(commands.saveCreationPendingDocument).not.toHaveBeenCalled()
})

it('starts audio only on Play, uses the applied Internal device, and stops on leaving the resource', async () => {
  const base = await commands.getSessionState()
  if (base.status !== 'ok') throw new Error('Missing session fixture')
  useSessionStore.setState({
    outputDevice: 'Next interface',
    sessionStatus: 'ready',
    latestSnapshot: {
      ...base.data,
      status: 'ready',
      projectPath: workspace.project.root,
      audioMode: 'internal',
      outputDevice: 'Live interface',
    },
  })
  const track = {
    id: 'pending-track',
    name: 'Take.wav',
    version: 'audio-version',
    size: 16_044,
    mime: 'audio/wav',
    durationMs: 1_000,
  }
  vi.mocked(commands.listCreationPendingMedia).mockResolvedValue({
    status: 'ok',
    data: [track],
  })
  vi.mocked(commands.startPendingAudioPreview).mockResolvedValue({
    status: 'ok',
    data: { positionMs: 0, durationMs: 1_000, playing: true },
  })
  const user = userEvent.setup()
  render(<CreationView />)
  const resources = await screen.findByRole('region', {
    name: 'Creation resources',
  })
  await user.click(
    await within(resources).findByRole('button', { name: track.name })
  )
  expect(commands.startPendingAudioPreview).not.toHaveBeenCalled()

  const audition = await screen.findByRole('region', { name: 'Audio audition' })
  expect(audition).toHaveTextContent('Live interface')
  await user.click(within(audition).getByRole('button', { name: 'Play' }))
  const started = vi.mocked(commands.startPendingAudioPreview).mock.calls[0]
  if (!started) throw new Error('Expected Play to start the preview')
  const [identity, id, version, preview] = started
  expect([identity, id, version]).toEqual([
    workspace.project.identity,
    track.id,
    track.version,
  ])
  expect(commands.startPendingAudioPreview).toHaveBeenCalledWith(
    identity,
    id,
    version,
    preview,
    'Live interface',
    0,
    0.75
  )
  expect(
    await within(audition).findByRole('button', { name: 'Pause' })
  ).toBeVisible()

  act(() => useSessionStore.setState({ outputDevice: 'System default' }))
  expect(audition).toHaveTextContent('Live interface')
  expect(commands.stopPendingAudioPreview).not.toHaveBeenCalled()

  act(() => useSessionStore.setState({ sessionStatus: 'idle' }))
  await waitFor(() =>
    expect(commands.stopPendingAudioPreview).toHaveBeenCalledWith(preview)
  )
  const next = await screen.findByRole('region', { name: 'Audio audition' })
  expect(next).toHaveTextContent('System default')
  expect(commands.startPendingAudioPreview).toHaveBeenCalledTimes(1)
  await user.click(within(next).getByRole('button', { name: 'Play' }))
  const restarted = vi.mocked(commands.startPendingAudioPreview).mock.calls[1]
  if (!restarted) throw new Error('Expected Play to use the next output')
  expect(restarted[4]).toBeNull()

  await user.click(
    screen.getByRole('button', { name: 'PNDS creation assistant' })
  )
  await waitFor(() =>
    expect(commands.stopPendingAudioPreview).toHaveBeenCalledWith(restarted[3])
  )
})

it('seeks and adjusts audition gain independently, then reports a disconnected output', async () => {
  const base = await commands.getSessionState()
  if (base.status !== 'ok') throw new Error('Missing session fixture')
  useSessionStore.setState({
    outputDevice: 'USB interface',
    volume: 0,
    muted: true,
    sessionStatus: 'ready',
    latestSnapshot: {
      ...base.data,
      status: 'ready',
      audioMode: 'external',
      projectPath: workspace.project.root,
      outputDevice: null,
    },
  })
  const track = {
    id: 'long-take',
    name: 'Rehearsal.mp3',
    version: 'audio-version',
    size: 72_000_000,
    mime: 'audio/mpeg',
    durationMs: 60 * 60 * 1_000,
  }
  vi.mocked(commands.listCreationPendingMedia).mockResolvedValue({
    status: 'ok',
    data: [track],
  })
  vi.mocked(commands.startPendingAudioPreview).mockResolvedValue({
    status: 'ok',
    data: { positionMs: 0, durationMs: track.durationMs, playing: true },
  })
  vi.mocked(commands.controlPendingAudioPreview).mockImplementation(
    async (_preview, action) => ({
      status: 'ok',
      data: {
        positionMs: action.action === 'seek' ? action.positionMs : 0,
        durationMs: track.durationMs,
        playing: action.action === 'resume',
      },
    })
  )
  const user = userEvent.setup()
  render(<CreationView />)
  const resources = await screen.findByRole('region', {
    name: 'Creation resources',
  })
  const resource = await within(resources).findByRole('button', {
    name: track.name,
  })
  expect(resource).toHaveTextContent('MP3')
  expect(resource).toHaveTextContent('60:00')
  await user.click(resource)

  const audition = await screen.findByRole('region', { name: 'Audio audition' })
  expect(audition).toHaveTextContent('USB interface')
  await user.click(within(audition).getByRole('button', { name: 'Play' }))
  const started = vi.mocked(commands.startPendingAudioPreview).mock.calls[0]
  if (!started) throw new Error('Expected Play to start the preview')
  const [identity, id, version, preview] = started
  expect(commands.startPendingAudioPreview).toHaveBeenCalledWith(
    identity,
    id,
    version,
    preview,
    'USB interface',
    0,
    0.75
  )
  await user.click(
    await within(audition).findByRole('button', { name: 'Pause' })
  )
  expect(commands.controlPendingAudioPreview).toHaveBeenCalledWith(preview, {
    action: 'pause',
  })

  const position = within(audition).getByRole('slider', {
    name: 'Playback position',
  })
  fireEvent.pointerDown(position, { pointerId: 1, button: 0 })
  fireEvent.change(position, { target: { value: 900_000 } })
  fireEvent.change(position, { target: { value: 1_800_000 } })
  expect(position).toHaveAttribute('aria-valuetext', '30:00')
  expect(commands.controlPendingAudioPreview).not.toHaveBeenCalledWith(
    preview,
    expect.objectContaining({ action: 'seek' })
  )
  fireEvent.pointerUp(position, { pointerId: 1 })
  await waitFor(() =>
    expect(position).toHaveAttribute('aria-valuetext', '30:00')
  )
  expect(commands.controlPendingAudioPreview).toHaveBeenCalledWith(preview, {
    action: 'seek',
    positionMs: 1_800_000,
  })

  const volume = within(audition).getByRole('slider', {
    name: 'Audition volume',
  })
  await waitFor(() => expect(volume).toBeEnabled())
  fireEvent.change(volume, { target: { value: 25 } })
  expect(commands.controlPendingAudioPreview).toHaveBeenCalledWith(preview, {
    action: 'volume',
    gain: 0.25,
  })
  expect(useSessionStore.getState().volume).toBe(0)

  const disconnected = vi
    .mocked(listen)
    .mock.calls.find(
      ([event]) => event === 'creation-audio-preview-disconnected'
    )?.[1]
  if (!disconnected)
    throw new Error('Expected the native disconnect subscription')
  act(() =>
    disconnected({
      event: 'creation-audio-preview-disconnected',
      id: 1,
      payload: { preview },
    })
  )
  expect(within(audition).getByRole('alert')).toHaveTextContent(
    'The selected output device disconnected'
  )
  expect(within(audition).getByRole('button', { name: 'Play' })).toBeEnabled()
  expect(commands.startPendingAudioPreview).toHaveBeenCalledTimes(1)
})
