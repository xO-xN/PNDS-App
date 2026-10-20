import { seedCreationDraft } from '@/test/creation-files'
import { creationProjectAction } from '@/test/desktop-actions'
import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { open, confirm } from '@tauri-apps/plugin-dialog'
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
import i18n from '@/i18n/config'
import { useProjectStore, visibleProjectPaths } from '@/store/project-store'

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

it.each(['Blank', 'PNDS Classic'])(
  'preserves the live project on directory, form and discard cancellation with %s',
  async template => {
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
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(template) }))
    vi.mocked(open).mockResolvedValueOnce(null)
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose parent folder' })
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    )
    expect(screen.getByRole('textbox', { name: 'Parent folder' })).toHaveValue(
      ''
    )
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
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose parent folder' })
    )
    await screen.findByDisplayValue('/scores')
    vi.mocked(confirm).mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
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
    expect(commands.createClassicProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().recentProjectPaths).not.toContain(
      created.project.root
    )
  }
)

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
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
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

it('selects the fixed Classic source, creates it and enters the workbench without starting', async () => {
  render(<CreationView />)
  await openNewProject()
  const classic = screen.getByRole('radio', { name: /PNDS Classic/ })
  classic.focus()
  await userEvent.keyboard(' ')
  expect(classic).toBeChecked()
  expect(screen.getByText(/PNDS Template 0.7.0/)).toBeInTheDocument()
  expect(screen.getByText(/Two-fader example/)).toBeInTheDocument()
  vi.mocked(open).mockResolvedValueOnce('/scores')
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(commands.createClassicProject).mockResolvedValueOnce({
    status: 'ok',
    data: created,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  await screen.findByRole('treeitem', { name: 'README.md' })
  expect(useCreationStore.getState().workspace).toEqual(created)
  expect(commands.createBlankProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})

it('shows the required Classic shared versions and preserves the running workspace when creation fails', async () => {
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
  fireEvent.click(screen.getByRole('radio', { name: /PNDS Classic/ }))
  vi.mocked(open).mockResolvedValueOnce('/scores')
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  vi.mocked(commands.createClassicProject).mockResolvedValueOnce({
    status: 'error',
    error: {
      code: 'invalidProject',
      detail:
        'Required shared libraries [express 5.3.0, p5 2.3.4] cannot be verified',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('express 5.3.0, p5 2.3.4')
  expect(useCreationStore.getState().workspace).toEqual(old)
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(screen.getByRole('radio', { name: /PNDS Classic/ })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
  vi.mocked(commands.getCreationRuntime).mockReset().mockResolvedValue(runtime)
})

it.each(['Blank', 'PNDS Classic'])(
  'can create %s when a creator types Test as the work and folder name',
  async template => {
    const user = userEvent.setup()
    render(<CreationView />)
    await openNewProject()
    await user.click(screen.getByRole('radio', { name: new RegExp(template) }))
    const name = screen.getByRole('textbox', { name: 'Work name' })
    const folder = screen.getByRole('textbox', { name: 'Folder name' })
    await user.clear(name)
    await user.type(name, 'Test')
    expect(folder).toHaveValue('test-pnds')
    await user.clear(folder)
    await user.type(folder, 'Test')
    vi.mocked(open).mockResolvedValueOnce('/scores')
    await user.click(
      screen.getByRole('button', { name: 'Choose parent folder' })
    )
    await screen.findByDisplayValue('/scores')
    const create = screen.getByRole('button', { name: 'Create project' })
    expect(create).toBeEnabled()
    expect(folder).toHaveValue('test')
    expect(name).toHaveValue('Test')
    expect(screen.getByText('New project: /scores/test')).toBeInTheDocument()
    const command =
      template === 'Blank'
        ? commands.createBlankProject
        : commands.createClassicProject
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
  }
)

it('explains invalid folder characters and boundaries inline until the creator corrects them', async () => {
  const user = userEvent.setup()
  render(<CreationView />)
  await openNewProject()
  vi.mocked(open).mockResolvedValueOnce('/scores')
  await user.click(screen.getByRole('button', { name: 'Choose parent folder' }))
  await screen.findByDisplayValue('/scores')
  const folder = screen.getByRole('textbox', { name: 'Folder name' })
  const create = screen.getByRole('button', { name: 'Create project' })
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
  expect(commands.createClassicProject).not.toHaveBeenCalled()
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
  expect(commands.createClassicProject).not.toHaveBeenCalled()
})

it.each(['Blank', 'PNDS Classic'])(
  'normalizes uppercase folder typing for %s and explains corrections in Chinese',
  async template => {
    await i18n.changeLanguage('zh-CN')
    const user = userEvent.setup()
    render(<CreationView />)
    await openNewProject()
    await user.click(screen.getByRole('radio', { name: new RegExp(template) }))
    const name = screen.getByRole('textbox', { name: '作品名称' })
    const folder = screen.getByRole('textbox', { name: '文件夹名称' })
    await user.clear(name)
    await user.type(name, 'Test')
    await user.clear(folder)
    await user.type(folder, 'Test Score')
    expect(screen.getByRole('alert')).toHaveTextContent(
      '请使用字母、数字与连字符。'
    )
    expect(folder).toHaveAccessibleDescription(/请使用字母/)
    expect(screen.getByRole('button', { name: '创建工程' })).toBeDisabled()
    await user.clear(folder)
    await user.type(folder, 'Test')
    vi.mocked(open).mockResolvedValueOnce('/scores')
    await user.click(screen.getByRole('button', { name: '选择父目录' }))
    await screen.findByDisplayValue('/scores')
    expect(folder).toHaveValue('test')
    expect(name).toHaveValue('Test')
    expect(screen.getByText('新工程：/scores/test')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const create = screen.getByRole('button', { name: '创建工程' })
    expect(create).toBeEnabled()
    const command =
      template === 'Blank'
        ? commands.createBlankProject
        : commands.createClassicProject
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
  }
)

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
  await user.click(screen.getByRole('button', { name: 'Create project' }))
  await screen.findByText('/removed is no longer available')
  expect(screen.getByRole('textbox', { name: 'Parent folder' })).toHaveValue(
    '/removed'
  )
  expect(useCreationStore.getState().lastCreationParent).toBe('/removed')
  expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
  expect(commands.savePreferences).not.toHaveBeenCalled()
})

it('shows an independent editable local Git identity and the placeholder before creation', async () => {
  render(<CreationView />)
  await openNewProject()
  expect(
    screen.getByRole('textbox', { name: 'Version author name' })
  ).not.toBeVisible()
  fireEvent.click(screen.getByText('Author, description and version identity'))
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

it('prefills saved Git identity and preserves a manually chosen folder when the work name changes', async () => {
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
  await user.click(screen.getByText('Author, description and version identity'))
  await waitFor(() =>
    expect(screen.getByLabelText('Version author name')).toHaveValue('Composer')
  )
  expect(screen.getByLabelText('Version email (optional)')).toHaveValue(
    'composer@example.com'
  )
  const name = screen.getByRole('textbox', { name: 'Work name' })
  const folder = screen.getByRole('textbox', { name: 'Folder name' })
  await user.clear(name)
  await user.type(name, 'My Score')
  expect(folder).toHaveValue('my-score-pnds')
  await user.clear(folder)
  await user.type(folder, 'custom-folder')
  await user.type(name, ' II')
  expect(folder).toHaveValue('custom-folder')
})

it('keeps optional metadata when collapsed and reveals invalid identity fields before submission', async () => {
  render(<CreationView />)
  await openNewProject()
  const summary = screen.getByText('Author, description and version identity')
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
