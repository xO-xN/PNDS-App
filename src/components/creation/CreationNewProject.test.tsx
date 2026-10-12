import { beforeEach, expect, it, vi } from 'vitest'
import { open, confirm } from '@tauri-apps/plugin-dialog'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationDraftsStore } from '@/store/creation-drafts-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationView } from './CreationView'
import i18n from '@/i18n/config'

const created: CreationWorkspace = {
  project: {
    identity: 'new',
    root: '/scores/new-score',
    name: 'New Score',
    source: 'folder',
  },
  files: [{ path: 'README.md', kind: 'text', category: 'system', size: 100 }],
}
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: null,
    opening: false,
    request: null,
    modePhase: 'idle',
    error: null,
    modeError: null,
  })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useCreationDraftsStore.getState().clear()
  useCreationHandoffStore.getState().clear()
  useCreationTestStore.setState({ tab: 'file', expanded: false })
})

it('offers creation in the project picker and preserves the live project on directory, form and discard cancellation', async () => {
  const old = {
    ...created,
    project: { ...created.project, identity: 'old', root: '/old', name: 'Old' },
  }
  useCreationStore.setState({ workspace: old })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/old',
  })
  useCreationDraftsStore.getState().loaded('README.md', 'Old intro', 'old-v1')
  useCreationDraftsStore.getState().edit('README.md', 'Unsaved old intro')
  render(<CreationView />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Switch to another project' })
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'New blank project' })
  )
  vi.mocked(open).mockResolvedValueOnce(null)
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  )
  expect(screen.getByRole('textbox', { name: 'Parent folder' })).toHaveValue('')
  const result = await commands.getCreationRuntime()
  if (result.status === 'error') throw result.error
  const live = {
    ...result.data,
    generation: 'old-run',
    projectRoot: '/old',
    snapshot: {
      ...result.data.snapshot,
      status: 'ready' as const,
      projectPath: '/old',
    },
  }
  vi.mocked(commands.getCreationRuntime).mockResolvedValueOnce({
    status: 'ok',
    data: live,
  })
  vi.mocked(open).mockResolvedValueOnce('/scores')
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(confirm).mockResolvedValueOnce(false)
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  await waitFor(() => expect(confirm).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(useCreationStore.getState().workspace).toEqual(old)
  expect(useCreationDraftsStore.getState().drafts['README.md']?.text).toBe(
    'Unsaved old intro'
  )
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
  expect(commands.createBlankProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('reports creation failure before stopping the live project and keeps the form available for retry', async () => {
  const old = {
    ...created,
    project: { ...created.project, identity: 'old', root: '/old', name: 'Old' },
  }
  useCreationStore.setState({ workspace: old })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/old',
  })
  const result = await commands.getCreationRuntime()
  if (result.status === 'error') throw result.error
  const live = {
    ...result.data,
    generation: 'old-run',
    projectRoot: '/old',
    snapshot: {
      ...result.data.snapshot,
      status: 'ready' as const,
      projectPath: '/old',
    },
  }
  vi.mocked(commands.getCreationRuntime)
    .mockResolvedValueOnce({ status: 'ok', data: live })
    .mockResolvedValueOnce({ status: 'ok', data: live })
  render(<CreationView />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Switch to another project' })
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'New blank project' })
  )
  vi.mocked(open).mockResolvedValueOnce('/scores')
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'error',
    error: {
      code: 'targetExists',
      detail: '/scores/untitled-score already exists',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  await screen.findByText('/scores/untitled-score already exists')
  expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(useCreationStore.getState().workspace).toEqual(old)
})

it('keeps all creation inputs when a late native selection belongs to an old workspace', async () => {
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'New blank project' }))
  let selected: ((path: string) => void) | undefined
  vi.mocked(open).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        selected = resolve
      })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await act(async () => {
    useCreationStore.setState({ workspace: created })
    selected?.('/stale')
  })
  expect(screen.getByRole('textbox', { name: 'Parent folder' })).toHaveValue('')
  expect(commands.createBlankProject).not.toHaveBeenCalled()
})

it('creates from the home form using the chosen parent and enters the new workspace without starting', async () => {
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'New blank project' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Work name' }), {
    target: { value: 'New Score' },
  })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Folder name / project ID' }),
    { target: { value: 'new-score' } }
  )
  vi.mocked(open).mockResolvedValueOnce('/scores')
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'ok',
    data: created,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  await screen.findByRole('button', { name: 'README.md' })
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(commands.createBlankProject).toHaveBeenCalledWith({
    parent: '/scores',
    folderName: 'new-score',
    name: 'New Score',
    author: '',
    description: '',
    locale: 'en',
  })
  expect(useCreationStore.getState().workspace).toEqual(created)
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})

it('names the completed directory and preserves the old drafts when generation succeeds but workspace commit fails', async () => {
  const old = {
    ...created,
    project: { ...created.project, identity: 'old', root: '/old', name: 'Old' },
  }
  useCreationStore.setState({ workspace: old })
  useCreationDraftsStore.getState().loaded('README.md', 'Old intro', 'v1')
  useCreationDraftsStore.getState().edit('README.md', 'Unsaved old intro')
  render(<CreationView />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Switch to another project' })
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'New blank project' })
  )
  vi.mocked(open).mockResolvedValueOnce('/scores')
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(confirm).mockResolvedValueOnce(true)
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'ok',
    data: created,
  })
  vi.mocked(commands.commitCreationProject).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'invalidIdentity', detail: 'Disk changed before commit' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  await screen.findByText(
    /The project was created at \/scores\/new-score; switching the workspace did not complete/
  )
  expect(useCreationStore.getState().workspace).toEqual(old)
  expect(useCreationDraftsStore.getState().drafts['README.md']?.text).toBe(
    'Unsaved old intro'
  )
  expect(commands.closeCreationProject).toHaveBeenCalledWith('new')
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})
