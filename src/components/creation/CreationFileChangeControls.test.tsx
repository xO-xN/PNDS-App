import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationFileChangeControls } from './CreationFileChangeControls'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'first',
        name: 'Score',
        root: '/score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  seedCreationDraft('server.js', 'original', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'edited')
})
it('reviews real draft changes, cancellation preserves work, then displays the actual saved change and undo result', async () => {
  render(<CreationFileChangeControls identity="first" path="server.js" />)
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }))
  expect(screen.getByLabelText('Text difference')).toHaveTextContent(
    '-original+edited'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'edited'
  )
  vi.mocked(commands.saveCreationFileChange).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'change',
      path: 'server.js',
      beforeText: 'original',
      afterText: 'edited',
      beforeVersion: 'v1',
      afterVersion: 'v2',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }))
  await act(async () =>
    fireEvent.click(
      screen.getByRole('button', { name: 'Save reviewed change' })
    )
  )
  expect(screen.getByText('Saved change')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Undo saved change' })
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'View changes' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  expect(screen.queryByLabelText('Text difference')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'View changes' }))
  expect(screen.getByLabelText('Text difference')).toHaveTextContent(
    '-original+edited'
  )
  fireEvent.click(screen.getByRole('button', { name: 'View changes' }))
  expect(screen.queryByLabelText('Text difference')).toBeNull()
  vi.mocked(commands.undoCreationFileChange).mockResolvedValueOnce({
    status: 'ok',
    data: { kind: 'text', text: 'original', version: 'v1' },
  })
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Undo saved change' }))
  )
  expect(screen.getByText('Original text restored.')).toBeVisible()
})

it('keeps saved undo unavailable while a newer draft or disk conflict needs attention', () => {
  useCreationFilesStore.setState({
    lastChange: {
      id: 'saved-change',
      path: 'server.js',
      beforeText: 'before',
      afterText: 'original',
      beforeVersion: 'v0',
      afterVersion: 'v1',
    },
  })
  render(<CreationFileChangeControls identity="first" path="server.js" />)
  const undo = screen.getByRole('button', { name: 'Undo saved change' })
  expect(undo).toBeVisible()
  expect(undo).toBeDisabled()
  act(() => useCreationFilesStore.getState().edit('server.js', 'original'))
  expect(undo).toBeEnabled()
  act(() => {
    const draft = useCreationFilesStore.getState().drafts['server.js']
    if (!draft) throw new Error('Expected current draft')
    useCreationFilesStore.setState({
      drafts: { 'server.js': { ...draft, diskChanged: true } },
    })
  })
  expect(undo).toBeDisabled()
  expect(commands.undoCreationFileChange).not.toHaveBeenCalled()
})

it('requires a new review when subsequent typing changes the candidate', () => {
  render(<CreationFileChangeControls identity="first" path="server.js" />)
  fireEvent.click(screen.getByRole('button', { name: 'Review change' }))
  act(() =>
    useCreationFilesStore.getState().edit('server.js', 'subsequent typing')
  )
  expect(
    screen.getByRole('button', { name: 'Save reviewed change' })
  ).toBeDisabled()
  expect(
    screen.getByText(
      'The draft or disk version changed. Cancel and review again.'
    )
  ).toBeVisible()
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
})
