import { seedCreationDraft } from '@/test/creation-files'
import { creationProjectAction } from '@/test/desktop-actions'
import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { open, confirm } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import {
  commands,
  type AppPreferences,
  type CreationWorkspace,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationView } from './CreationView'
import { useGithubAuthStore } from './creation-github-data'
import i18n from '@/i18n/config'
import { useProjectStore, visibleProjectPaths } from '@/store/project-store'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

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
  useGithubAuthStore.setState({ status: null, error: null, generation: 0 })
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: { configured: false, account: null, installationUrl: null },
  })
  useCreationStore.setState({
    active: true,
    workspace: null,
    lastCreationParent: null,
    opening: false,
    request: null,
    modePhase: 'idle',
    error: null,
    modeError: null,
  })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useCreationFilesStore.getState().clear()
  useCreationHandoffStore.getState().clear()
  useCreationTestStore.setState({ tab: 'file', expanded: false })
  useProjectStore.setState({
    recentProjectPaths: [],
    projectFolders: [],
    activeFolderId: null,
    lastUserFolderId: null,
    manifestProjectNames: {},
    projectDisplayNames: {},
    currentProject: null,
    utilityPaths: [],
  })
})

async function openNewProject() {
  const name = i18n.t('creation.newProject.open')
  const entry =
    screen.queryByRole('menuitem', { name }) ??
    screen.getByRole('button', { name })
  fireEvent.click(entry)
  await screen.findByRole('dialog', {
    name: i18n.t('creation.newProject.title'),
  })
}

it('preserves the live project on directory, form and discard cancellation with Blank', async () => {
  const old = {
    ...created,
    project: {
      ...created.project,
      identity: 'old',
      root: '/old',
      name: 'Old',
    },
  }
  useCreationStore.setState({ workspace: old })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/old',
  })
  seedCreationDraft('README.md', 'Old intro', 'old-v1')
  useCreationFilesStore.getState().edit('README.md', 'Unsaved old intro')
  render(<CreationView />)
  await creationProjectAction('Switch to another project')
  await openNewProject()
  expect(
    screen.getByText('Source: PNDS App Blank · v1.7.0')
  ).toBeInTheDocument()
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
  fireEvent.click(screen.getByRole('button', { name: 'Create locally' }))
  await waitFor(() => expect(confirm).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(useCreationStore.getState().workspace).toEqual(old)
  expect(useCreationFilesStore.getState().drafts['README.md']?.text).toBe(
    'Unsaved old intro'
  )
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
  expect(commands.createBlankProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(useProjectStore.getState().recentProjectPaths).not.toContain(
    created.project.root
  )
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
  await creationProjectAction('Switch to another project')
  await openNewProject()
  vi.mocked(open).mockResolvedValueOnce('/scores')
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'error',
    error: {
      code: 'permission',
      detail: '/scores is not writable',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create locally' }))
  await screen.findByText('/scores is not writable')
  expect(screen.getByRole('button', { name: 'Create locally' })).toBeEnabled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(useCreationStore.getState().workspace).toEqual(old)
})

it('keeps all creation inputs when a late native selection belongs to an old workspace', async () => {
  useCreationStore.setState({ lastCreationParent: '/remembered' })
  render(<CreationView />)
  await openNewProject()
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
  expect(screen.getByRole('textbox', { name: 'Parent folder' })).toHaveValue(
    '/remembered'
  )
  expect(useCreationStore.getState().lastCreationParent).toBe('/remembered')
  expect(commands.savePreferences).not.toHaveBeenCalled()
  expect(commands.createBlankProject).not.toHaveBeenCalled()
})

it('creates from the home form using the chosen parent and enters the new workspace without starting', async () => {
  const folders = [
    { id: 'set', name: 'Concert set', projectPaths: ['/existing'] },
  ]
  useProjectStore.setState({
    recentProjectPaths: ['/existing'],
    projectFolders: folders,
    activeFolderId: 'set',
  })
  render(<CreationView />)
  await openNewProject()
  fireEvent.change(screen.getByRole('textbox', { name: 'Work name' }), {
    target: { value: 'New Score' },
  })
  fireEvent.click(screen.getByText('Advanced options'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), {
    target: { value: 'new-score' },
  })
  vi.mocked(open).mockResolvedValueOnce('/scores')
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'ok',
    data: created,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create locally' }))
  await screen.findByRole('treeitem', { name: 'README.md' })
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(commands.createBlankProject).toHaveBeenCalledWith({
    parent: '/scores',
    folderName: 'new-score',
    name: 'New Score',
    author: '',
    gitName: 'PNDS Creator',
    gitEmail: '',
    description: '',
    locale: 'en',
  })
  expect(useCreationStore.getState().workspace).toEqual(created)
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  const index = useProjectStore.getState()
  expect(
    visibleProjectPaths(index.recentProjectPaths, index.projectFolders, null)
  ).toEqual([created.project.root])
  expect(index.projectFolders).toEqual(folders)
  expect(index.manifestProjectNames[created.project.root]).toBe('New Score')
  await waitFor(() =>
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        recentProjects: [created.project.root, '/existing'],
        projectFolders: folders,
        projectManifestNames: { [created.project.root]: 'New Score' },
      })
    )
  )
  await act(async () => {
    await useCreationStore.getState().leave()
  })
  expect(useCreationStore.getState().active).toBe(false)
  expect(useProjectStore.getState().activeFolderId).toBeNull()
  expect(useProjectStore.getState().currentProject).toBeNull()
  const home = useProjectStore.getState()
  expect(
    visibleProjectPaths(
      home.recentProjectPaths,
      home.projectFolders,
      home.activeFolderId
    )
  ).toEqual([created.project.root])
})

it('names the completed directory and preserves the old drafts when generation succeeds but workspace commit fails', async () => {
  const old = {
    ...created,
    project: { ...created.project, identity: 'old', root: '/old', name: 'Old' },
  }
  useCreationStore.setState({ workspace: old })
  seedCreationDraft('README.md', 'Old intro', 'v1')
  useCreationFilesStore.getState().edit('README.md', 'Unsaved old intro')
  render(<CreationView />)
  await creationProjectAction('Switch to another project')
  await openNewProject()
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
  fireEvent.click(screen.getByRole('button', { name: 'Create locally' }))
  await screen.findByText(
    /The project was created at \/scores\/new-score; switching the workspace did not complete/
  )
  expect(useCreationStore.getState().workspace).toEqual(old)
  expect(useCreationFilesStore.getState().drafts['README.md']?.text).toBe(
    'Unsaved old intro'
  )
  expect(commands.closeCreationProject).toHaveBeenCalledWith('new')
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(useProjectStore.getState().recentProjectPaths).not.toContain(
    created.project.root
  )
})

it('keeps all existing Home entries when registering a completed creation beyond the manual-addition limit', async () => {
  const existing = Array.from({ length: 30 }, (_, index) => `/score-${index}`)
  useProjectStore.setState({ recentProjectPaths: existing })
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'ok',
    data: created,
  })
  await act(async () => {
    expect(
      await useCreationStore.getState().create({
        parent: '/scores',
        folderName: 'new-score',
        name: 'New Score',
        author: '',
        description: '',
        locale: 'en',
      })
    ).toBe(true)
  })
  const state = useProjectStore.getState()
  expect(
    visibleProjectPaths(state.recentProjectPaths, state.projectFolders, null)
  ).toEqual([created.project.root, ...existing])
  expect(state.addRecentProject('/manual-import')).toBe(false)
})

it('shows the required Blank shared versions and preserves the running workspace when creation fails', async () => {
  const old = {
    ...created,
    project: { ...created.project, identity: 'old', root: '/old' },
  }
  useCreationStore.setState({ workspace: old })
  const runtime = await commands.getCreationRuntime()
  if (runtime.status === 'error') throw runtime.error
  const live = {
    ...runtime.data,
    projectRoot: '/old',
    snapshot: {
      ...runtime.data.snapshot,
      status: 'ready' as const,
      projectPath: '/old',
    },
  }
  vi.mocked(commands.getCreationRuntime).mockResolvedValue({
    status: 'ok',
    data: live,
  })
  render(<CreationView />)
  await creationProjectAction('Switch to another project')
  await openNewProject()
  vi.mocked(open).mockResolvedValueOnce('/scores')
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'error',
    error: {
      code: 'invalidProject',
      detail:
        'Required shared libraries [express 5.3.0, osc-min 2.1.2] cannot be verified',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create locally' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent(
    'express 5.3.0, osc-min 2.1.2'
  )
  expect(useCreationStore.getState().workspace).toEqual(old)
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Create locally' })).toBeEnabled()
  vi.mocked(commands.getCreationRuntime).mockReset().mockResolvedValue(runtime)
})

it('can create Blank when a creator types Test as the work and folder name', async () => {
  const user = userEvent.setup()
  render(<CreationView />)
  await openNewProject()
  const name = screen.getByRole('textbox', { name: 'Work name' })
  fireEvent.click(screen.getByText('Advanced options'))
  const folder = screen.getByRole('textbox', { name: 'Folder name' })
  await user.clear(name)
  await user.type(name, 'Test')
  expect(folder).toHaveValue('test-pnds')
  await user.clear(folder)
  await user.type(folder, 'Test')
  vi.mocked(open).mockResolvedValueOnce('/scores')
  await user.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  const create = screen.getByRole('button', { name: 'Create locally' })
  expect(create).toBeEnabled()
  expect(folder).toHaveValue('test')
  expect(name).toHaveValue('Test')
  expect(screen.getByText('New project: /scores/test')).toBeInTheDocument()
  const command = commands.createBlankProject
  vi.mocked(command).mockResolvedValueOnce({ status: 'ok', data: created })
  await user.click(create)
  await screen.findByRole('treeitem', { name: 'README.md' })
  expect(command).toHaveBeenCalledWith({
    parent: '/scores',
    folderName: 'test',
    name: 'Test',
    author: '',
    gitName: 'PNDS Creator',
    gitEmail: '',
    description: '',
    locale: 'en',
  })
  expect(useCreationStore.getState().workspace).toEqual(created)
})

it('explains invalid folder characters and boundaries inline until the creator corrects them', async () => {
  const user = userEvent.setup()
  render(<CreationView />)
  await openNewProject()
  vi.mocked(open).mockResolvedValueOnce('/scores')
  await user.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  fireEvent.click(screen.getByText('Advanced options'))
  const folder = screen.getByRole('textbox', { name: 'Folder name' })
  const create = screen.getByRole('button', { name: 'Create locally' })
  await user.clear(folder)
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a folder name.')
  expect(folder).toHaveAccessibleDescription(/Enter a folder name/)
  for (const invalid of ['test score', 'test/score', 'test_score', 'test.']) {
    await user.type(folder, invalid)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Use letters, digits and hyphens.'
    )
    expect(folder).toHaveAttribute('aria-invalid', 'true')
    expect(create).toBeDisabled()
    await user.clear(folder)
  }
  for (const invalid of ['-test', 'test-']) {
    await user.type(folder, invalid)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Start and end the folder name with a letter or digit.'
    )
    expect(create).toBeDisabled()
    await user.clear(folder)
  }
  await user.type(folder, 'a'.repeat(65))
  expect(folder).toHaveValue('a'.repeat(64))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(create).toBeEnabled()
  await user.clear(folder)
  await user.type(folder, 'Valid-Score')
  expect(folder).toHaveValue('valid-score')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(folder).toHaveAttribute('aria-invalid', 'false')
  expect(folder).toHaveAttribute(
    'aria-describedby',
    'creation-folder-name-hint'
  )
  expect(create).toBeEnabled()
  expect(commands.createBlankProject).not.toHaveBeenCalled()
})

it('remembers an owned native parent selection after cancelling and reopening the form', async () => {
  const user = userEvent.setup()
  render(<CreationView />)
  await openNewProject()
  vi.mocked(open).mockResolvedValueOnce('/scores')
  await user.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  await waitFor(() =>
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ lastCreationParent: '/scores' })
    )
  )
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await openNewProject()
  expect(screen.getByRole('textbox', { name: 'Parent folder' })).toHaveValue(
    '/scores'
  )
  expect(
    screen.getByText('New project: /scores/untitled-score-pnds')
  ).toBeInTheDocument()
  expect(commands.createBlankProject).not.toHaveBeenCalled()
})

it('normalizes uppercase folder typing for Blank and explains corrections in Chinese', async () => {
  await i18n.changeLanguage('zh-CN')
  const user = userEvent.setup()
  render(<CreationView />)
  await openNewProject()
  const name = screen.getByRole('textbox', { name: '作品名称' })
  fireEvent.click(screen.getByText('高级选项'))
  const folder = screen.getByRole('textbox', { name: '文件夹名称' })
  await user.clear(name)
  await user.type(name, 'Test')
  await user.clear(folder)
  await user.type(folder, 'Test Score')
  expect(screen.getByRole('alert')).toHaveTextContent(
    '请使用字母、数字与连字符。'
  )
  expect(folder).toHaveAccessibleDescription(/请使用字母/)
  expect(screen.getByRole('button', { name: '在本机创建' })).toBeDisabled()
  await user.clear(folder)
  await user.type(folder, 'Test')
  vi.mocked(open).mockResolvedValueOnce('/scores')
  await user.click(screen.getByRole('button', { name: '选择父目录' }))
  await screen.findByDisplayValue('/scores')
  expect(folder).toHaveValue('test')
  expect(name).toHaveValue('Test')
  expect(screen.getByText('新工程：/scores/test')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  const create = screen.getByRole('button', { name: '在本机创建' })
  expect(create).toBeEnabled()
  const command = commands.createBlankProject
  vi.mocked(command).mockResolvedValueOnce({ status: 'ok', data: created })
  await user.click(create)
  await screen.findByRole('treeitem', { name: 'README.md' })
  expect(command).toHaveBeenCalledWith({
    parent: '/scores',
    folderName: 'test',
    name: 'Test',
    author: '',
    gitName: 'PNDS Creator',
    gitEmail: '',
    description: '',
    locale: 'zh-CN',
  })
})

it('keeps the remembered parent when its native picker is cancelled', async () => {
  useCreationStore.setState({ lastCreationParent: '/remembered' })
  const user = userEvent.setup()
  render(<CreationView />)
  await openNewProject()
  vi.mocked(open).mockResolvedValueOnce(null)
  await user.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  expect(screen.getByRole('textbox', { name: 'Parent folder' })).toHaveValue(
    '/remembered'
  )
  expect(useCreationStore.getState().lastCreationParent).toBe('/remembered')
  expect(commands.savePreferences).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await openNewProject()
  expect(screen.getByRole('textbox', { name: 'Parent folder' })).toHaveValue(
    '/remembered'
  )
})

it('leaves a removed remembered parent available for retry when creation reports it missing', async () => {
  useCreationStore.setState({ lastCreationParent: '/removed' })
  const user = userEvent.setup()
  render(<CreationView />)
  await openNewProject()
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'missing', detail: '/removed is no longer available' },
  })
  await user.click(screen.getByRole('button', { name: 'Create locally' }))
  await screen.findByText('/removed is no longer available')
  expect(screen.getByRole('textbox', { name: 'Parent folder' })).toHaveValue(
    '/removed'
  )
  expect(useCreationStore.getState().lastCreationParent).toBe('/removed')
  expect(screen.getByRole('button', { name: 'Create locally' })).toBeEnabled()
  expect(commands.savePreferences).not.toHaveBeenCalled()
})

it('shows an independent editable local Git identity and the placeholder before creation', async () => {
  render(<CreationView />)
  await openNewProject()
  expect(screen.getByLabelText('Version author name')).not.toBeVisible()
  fireEvent.click(screen.getByText('Advanced options'))
  const name = screen.getByRole('textbox', { name: 'Version author name' })
  expect(name).toHaveValue('PNDS Creator')
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Creator (optional)' }),
    { target: { value: 'Composer' } }
  )
  expect(name).toHaveValue('Composer')
  fireEvent.change(name, { target: { value: 'Version Author' } })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Creator (optional)' }),
    { target: { value: 'Another Composer' } }
  )
  expect(name).toHaveValue('Version Author')
  expect(screen.getByText(/creator@pnds.local/)).toBeInTheDocument()
})

it('keeps the app-wide email out of a new project and preserves a manually chosen folder', async () => {
  vi.mocked(commands.loadPreferences).mockResolvedValueOnce({
    status: 'ok',
    data: {
      theme: 'system',
      gitName: 'Composer',
      gitEmail: 'composer@example.com',
    } as AppPreferences,
  })
  const user = userEvent.setup()
  render(<CreationView />)
  await openNewProject()
  await user.click(screen.getByText('Advanced options'))
  await waitFor(() =>
    expect(screen.getByLabelText('Version author name')).toHaveValue('Composer')
  )
  expect(screen.getByLabelText('Version email (optional)')).toHaveValue('')
  const name = screen.getByRole('textbox', { name: 'Work name' })
  const folder = screen.getByRole('textbox', { name: 'Folder name' })
  await user.clear(name)
  await user.type(name, 'My Score')
  expect(folder).toHaveValue('my-score-pnds')
  await user.clear(folder)
  await user.type(folder, 'custom-folder')
  await user.type(name, ' II')
  expect(folder).toHaveValue('custom-folder')
  vi.mocked(open).mockResolvedValueOnce('/scores')
  await user.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'ok',
    data: created,
  })
  await user.click(screen.getByRole('button', { name: 'Create locally' }))
  await screen.findByRole('treeitem', { name: 'README.md' })
  expect(commands.createBlankProject).toHaveBeenCalledWith(
    expect.objectContaining({ gitEmail: '' })
  )
})

it('previews a Chinese name and retains its edited local folder on a collision', async () => {
  const old = { ...created, project: { ...created.project, identity: 'old' } }
  useCreationStore.setState({ workspace: old, lastCreationParent: '/scores/' })
  render(<CreationView />)
  await creationProjectAction(i18n.t('creation.newProject.open'))
  await screen.findByRole('dialog', { name: 'New project' })

  const name = screen.getByRole('textbox', { name: 'Work name' })
  fireEvent.change(name, { target: { value: '潮汐之声' } })
  expect(screen.getByText('New project: /scores/潮汐之声-pnds')).toBeVisible()
  const advanced = screen.getByText('Advanced options')
  const folder = screen.getByLabelText('Folder name')
  expect(folder).not.toBeVisible()
  fireEvent.click(advanced)
  fireEvent.change(folder, { target: { value: '潮汐排练' } })
  fireEvent.click(advanced)
  expect(screen.getByText('New project: /scores/潮汐排练')).toBeVisible()

  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'targetExists', detail: '/scores/潮汐排练' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create locally' }))
  await screen.findByRole('alert')
  expect(name).toHaveValue('潮汐之声')
  expect(folder).toHaveValue('潮汐排练')
  expect(useCreationStore.getState().workspace).toEqual(old)
  expect(commands.createBlankProject).toHaveBeenCalledWith(
    expect.objectContaining({ name: '潮汐之声', folderName: '潮汐排练' })
  )
  expect(commands.githubVerifyTemplateBackup).not.toHaveBeenCalled()
  expect(commands.githubBindRepository).not.toHaveBeenCalled()
})

it('passes a deliberately entered noreply address to the local project after collapsing advanced options', async () => {
  useCreationStore.setState({ lastCreationParent: '/scores' })
  render(<CreationView />)
  await openNewProject()
  const advanced = screen.getByText('Advanced options')
  fireEvent.click(advanced)
  fireEvent.change(screen.getByLabelText('Version email (optional)'), {
    target: { value: '123+composer@users.noreply.github.com' },
  })
  fireEvent.click(advanced)
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'ok',
    data: created,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create locally' }))
  await screen.findByRole('treeitem', { name: 'README.md' })
  expect(commands.createBlankProject).toHaveBeenCalledWith(
    expect.objectContaining({
      gitEmail: '123+composer@users.noreply.github.com',
    })
  )
  expect(commands.githubPrepareTemplateBackup).not.toHaveBeenCalled()
  expect(commands.githubPushTemplateBackup).not.toHaveBeenCalled()
})

it('keeps optional metadata when collapsed and reveals invalid identity fields before submission', async () => {
  render(<CreationView />)
  await openNewProject()
  const summary = screen.getByText('Advanced options')
  const details = summary.closest('details')
  expect(details).not.toHaveAttribute('open')
  expect(screen.getByRole('textbox', { name: 'Work name' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Parent folder' })).toBeVisible()
  fireEvent.click(summary)
  const author = screen.getByLabelText('Creator (optional)')
  const email = screen.getByLabelText('Version email (optional)')
  fireEvent.change(author, { target: { value: 'Composer' } })
  fireEvent.change(email, { target: { value: 'bad-email' } })
  fireEvent.click(summary)
  expect(author).not.toBeVisible()
  fireEvent.invalid(email)
  expect(details).toHaveAttribute('open')
  expect(author).toHaveValue('Composer')
  expect(email).toHaveValue('bad-email')
  expect(commands.createBlankProject).not.toHaveBeenCalled()
})

it('offers only the Blank starting point from the public creation entry', async () => {
  render(<CreationView />)
  await openNewProject()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByText('PNDS Classic')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Advanced options'))
  expect(screen.getByText('Blank')).toBeVisible()
  expect(
    screen.getByText('Source: PNDS App Blank · v1.7.0')
  ).toBeInTheDocument()
})

it('shows the confirmed public GitHub target and uploads the exact initial version after adopting Blank', async () => {
  const account = { id: '42', login: 'composer', avatarUrl: null }
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: { configured: true, account, installationUrl: null },
  })
  vi.mocked(commands.githubNewRepositoryOwners).mockResolvedValue({
    status: 'ok',
    data: ['composer', 'score-studio'],
  })
  useCreationStore.setState({ lastCreationParent: '/scores' })
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'ok',
    data: { ...created, initialGitHead: 'initial-commit' },
  })
  vi.mocked(commands.githubUploadNewProject).mockImplementationOnce(
    async () => {
      expect(useCreationStore.getState().workspace?.project.identity).toBe(
        'new'
      )
      return commands.githubSyncStatus('new', false)
    }
  )
  render(<CreationView />)
  await openNewProject()
  fireEvent.change(screen.getByRole('textbox', { name: 'Work name' }), {
    target: { value: 'New Score' },
  })
  expect(await screen.findByText('composer/new-score')).toBeVisible()
  expect(screen.getByText('Public', { selector: 'span' })).toBeVisible()
  expect(commands.githubUploadNewProject).not.toHaveBeenCalled()
  const submit = screen.getByRole('button', {
    name: 'Create and publish to GitHub',
  })
  await waitFor(() => expect(submit).toBeEnabled())
  fireEvent.click(submit)
  await waitFor(() =>
    expect(commands.githubUploadNewProject).toHaveBeenCalledExactlyOnceWith(
      'new',
      'initial-commit',
      { accountId: '42', owner: 'composer', name: 'new-score', private: false }
    )
  )
  await screen.findByRole('treeitem', { name: 'README.md' })
})

it('lets a creator change a conflicting organization target to a private repository without recreating Blank', async () => {
  const account = { id: '42', login: 'composer', avatarUrl: null }
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: { configured: true, account, installationUrl: null },
  })
  vi.mocked(commands.githubNewRepositoryOwners).mockResolvedValue({
    status: 'ok',
    data: ['composer', 'score-studio'],
  })
  useCreationStore.setState({ lastCreationParent: '/scores' })
  vi.mocked(commands.createBlankProject).mockResolvedValueOnce({
    status: 'ok',
    data: { ...created, initialGitHead: 'initial-commit' },
  })
  vi.mocked(commands.githubUploadNewProject)
    .mockResolvedValueOnce({
      status: 'error',
      error: { type: 'repositoryNameUnavailable' },
    })
    .mockImplementationOnce(() => commands.githubSyncStatus('new', false))
  render(<CreationView />)
  await openNewProject()
  const workName = screen.getByRole('textbox', { name: 'Work name' })
  fireEvent.change(workName, { target: { value: '潮汐之声' } })
  expect(screen.getByText('New project: /scores/潮汐之声-pnds')).toBeVisible()

  const advanced = screen.getByText('Advanced options')
  fireEvent.click(advanced)
  const repoOwner = await screen.findByRole('combobox', {
    name: 'Repository owner',
  })
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create and publish to GitHub' })
    ).toBeEnabled()
  )
  fireEvent.keyDown(repoOwner, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: 'score-studio' }))
  const repoName = screen.getByRole('textbox', { name: 'Repository name' })
  fireEvent.change(repoName, { target: { value: 'tide-score' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Private' }))
  fireEvent.click(advanced)
  expect(screen.getByText('score-studio/tide-score')).toBeVisible()
  expect(screen.getByText('Private', { selector: 'span' })).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Create and upload to private GitHub repository',
    })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/)
  expect(workName).toHaveValue('潮汐之声')
  expect(workName).toBeDisabled()
  expect(useCreationStore.getState().workspace?.project.identity).toBe('new')

  fireEvent.click(advanced)
  fireEvent.change(repoName, { target: { value: 'tide-score-two' } })
  fireEvent.click(
    screen.getByRole('button', { name: 'Upload initial version' })
  )
  await screen.findByRole('treeitem', { name: 'README.md' })
  expect(commands.createBlankProject).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ name: '潮汐之声', folderName: '潮汐之声-pnds' })
  )
  expect(commands.githubUploadNewProject).toHaveBeenLastCalledWith(
    'new',
    'initial-commit',
    {
      accountId: '42',
      owner: 'score-studio',
      name: 'tide-score-two',
      private: true,
    }
  )
})

it('returns from account authorization and approval to the same unsubmitted form', async () => {
  const account = { id: '42', login: 'composer', avatarUrl: null }
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: {
      configured: true,
      account: null,
      installationUrl: 'https://github.com/apps/pnds/installations/new',
    },
  })
  vi.mocked(commands.githubBeginAuth).mockResolvedValue({
    status: 'ok',
    data: {
      id: 'device',
      userCode: '1234-5678',
      verificationUrl: 'https://github.com/login/device',
      intervalSecs: 1,
      expiresInSecs: 900,
    },
  })
  vi.mocked(commands.githubPollAuth).mockResolvedValue({
    status: 'ok',
    data: { status: 'connected', account },
  })
  vi.mocked(commands.githubNewRepositoryOwners)
    .mockResolvedValueOnce({ status: 'ok', data: [] })
    .mockResolvedValueOnce({ status: 'ok', data: ['composer'] })
  useCreationStore.setState({ lastCreationParent: '/scores' })
  render(<CreationView />)
  await openNewProject()
  const workName = screen.getByRole('textbox', { name: 'Work name' })
  fireEvent.change(workName, { target: { value: 'Tide Score' } })
  fireEvent.click(
    await screen.findByRole('button', { name: 'Sign in to GitHub' })
  )
  expect(await screen.findByText('1234-5678')).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.github.openGitHub') })
  )
  await waitFor(() =>
    expect(openUrl).toHaveBeenCalledWith('https://github.com/login/device')
  )
  const manage = await screen.findByRole(
    'button',
    { name: 'Open GitHub App permissions' },
    { timeout: 2000 }
  )
  fireEvent.click(manage)
  await waitFor(() =>
    expect(openUrl).toHaveBeenCalledWith(
      'https://github.com/apps/pnds/installations/new'
    )
  )
  expect(workName).toHaveValue('Tide Score')
  expect(screen.getByText('composer/tide-score')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Create and publish to GitHub' })
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check access again' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create and publish to GitHub' })
    ).toBeEnabled()
  )
  expect(commands.createBlankProject).not.toHaveBeenCalled()
  expect(commands.githubUploadNewProject).not.toHaveBeenCalled()
})

it('can switch to local creation while GitHub authorization is still pending', async () => {
  const account = { id: '42', login: 'composer', avatarUrl: null }
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: { configured: true, account: null, installationUrl: null },
  })
  vi.mocked(commands.githubBeginAuth).mockResolvedValue({
    status: 'ok',
    data: {
      id: 'device',
      userCode: '1234-5678',
      verificationUrl: 'https://github.com/login/device',
      intervalSecs: 10,
      expiresInSecs: 900,
    },
  })
  useCreationStore.setState({ lastCreationParent: '/scores' })
  vi.mocked(commands.createBlankProject).mockImplementationOnce(async () => {
    useGithubAuthStore.setState({
      status: { configured: true, account, installationUrl: null },
    })
    return {
      status: 'ok',
      data: { ...created, initialGitHead: 'initial-commit' },
    }
  })
  render(<CreationView />)
  await openNewProject()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Sign in to GitHub' })
  )
  await screen.findByText('1234-5678')
  fireEvent.click(screen.getByRole('button', { name: 'Start locally' }))
  expect(screen.queryByText('1234-5678')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Create locally' }))
  await screen.findByRole('treeitem', { name: 'README.md' })
  expect(commands.githubUploadNewProject).not.toHaveBeenCalled()
})
