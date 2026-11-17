import userEvent from '@testing-library/user-event'
import i18n from '@/i18n/config'
import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { editText, findEditorWithText } from '@/test/text-editor'
import { creationFileAction, creationFileButton } from '@/test/desktop-actions'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { CreationView } from './CreationView'

const path = 'supercollider/source/潮汐 synth.scd'
const workspace: CreationWorkspace = {
  project: {
    identity: 'scd-project',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [
    { path, category: 'audio', kind: 'text', size: 20 },
    { path: 'server.js', category: 'system', kind: 'text', size: 10 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.openCreationScd)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: null })
  useCreationStore.setState({
    active: true,
    workspace: null,
    opening: false,
    modePhase: 'idle',
  })
  useCreationStore.setState({ workspace })
  useCreationFilesStore.getState().clear()
  useCreationTestStore.setState({ expanded: false })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
    commandPending: false,
  })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: '// saved SCD', version: 'disk-1' },
  })
})

it('opens the saved SCD through its trusted identity while preserving the App draft and performance', async () => {
  render(<CreationView />)
  fireEvent.click(creationFileButton(path))
  editText(await findEditorWithText('// saved SCD'), '// App draft')
  const reloadNonce = useSessionStore.getState().monitorReloadNonce
  const audioMode = useSessionStore.getState().audioMode
  await creationFileAction('Open saved file in SuperCollider')
  await waitFor(() =>
    expect(commands.openCreationScd).toHaveBeenCalledWith('scd-project', path)
  )
  expect(
    await screen.findByText(
      'The saved file was opened in SuperCollider. Your App draft stays here.'
    )
  ).toBeVisible()
  await findEditorWithText('// App draft')
  expect(useCreationFilesStore.getState().drafts[path]?.diskText).toBe(
    '// saved SCD'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.setMasterVolume).not.toHaveBeenCalled()
  expect(commands.authorizeCreationPreview).not.toHaveBeenCalled()
  expect(useSessionStore.getState().monitorReloadNonce).toBe(reloadNonce)
  expect(useSessionStore.getState().audioMode).toBe(audioMode)
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
})

it.each(['supercolliderMissing', 'externalOpen'] as const)(
  'retains the draft on %s and retries the current saved target',
  async code => {
    vi.mocked(commands.openCreationScd).mockResolvedValueOnce({
      status: 'error',
      error: { code, detail: 'system open failed' },
    })
    render(<CreationView />)
    fireEvent.click(creationFileButton(path))
    editText(await findEditorWithText('// saved SCD'), '// keep this draft')
    await creationFileAction('Open saved file in SuperCollider')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'system open failed'
    )
    const retry = screen.getByRole('button', {
      name: 'Retry opening in SuperCollider',
    })
    fireEvent.click(retry)
    await screen.findByText(
      'The saved file was opened in SuperCollider. Your App draft stays here.'
    )
    expect(commands.openCreationScd).toHaveBeenNthCalledWith(
      2,
      'scd-project',
      path
    )
    await findEditorWithText('// keep this draft')
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  }
)

it('reports an IPC rejection and keeps retry available without losing the file', async () => {
  vi.mocked(commands.openCreationScd).mockRejectedValueOnce(
    new Error('IPC unavailable')
  )
  render(<CreationView />)
  fireEvent.click(creationFileButton(path))
  await findEditorWithText('// saved SCD')
  await creationFileAction('Open saved file in SuperCollider')
  expect(await screen.findByRole('alert')).toHaveTextContent('IPC unavailable')
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry opening in SuperCollider' })
  )
  await screen.findByText(
    'The saved file was opened in SuperCollider. Your App draft stays here.'
  )
})

it('ignores a late open result after switching files or replacing the project identity', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.openCreationScd>>
  ) => void
  vi.mocked(commands.openCreationScd).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(<CreationView />)
  fireEvent.click(creationFileButton(path))
  await findEditorWithText('// saved SCD')
  await creationFileAction('Open saved file in SuperCollider')
  await screen.findByText('Opening the saved file in SuperCollider…')
  fireEvent.click(creationFileButton('server.js'))
  await findEditorWithText('// saved SCD')
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: { ...workspace.project, identity: 'replacement-project' },
      },
    })
  )
  fireEvent.click(creationFileButton(path))
  await findEditorWithText('// saved SCD')
  await act(async () =>
    finish({
      status: 'error',
      error: { code: 'externalOpen', detail: 'obsolete open error' },
    })
  )
  expect(screen.queryByText('obsolete open error')).not.toBeInTheDocument()
  expect(
    screen.queryByText('Opening the saved file in SuperCollider…')
  ).not.toBeInTheDocument()
  await creationFileAction('Open saved file in SuperCollider')
  await screen.findByText(
    'The saved file was opened in SuperCollider. Your App draft stays here.'
  )
  expect(commands.openCreationScd).toHaveBeenLastCalledWith(
    'replacement-project',
    path
  )
})

it.each([false, true])(
  'adopts external saves or preserves both sides of a dirty conflict (dirty=%s)',
  async dirty => {
    render(<CreationView />)
    fireEvent.click(creationFileButton(path))
    const editor = await findEditorWithText('// saved SCD')
    if (dirty) editText(editor, '// local draft')
    await creationFileAction('Open saved file in SuperCollider')
    await screen.findByText(
      'The saved file was opened in SuperCollider. Your App draft stays here.'
    )
    const reloadNonce = useSessionStore.getState().monitorReloadNonce
    vi.mocked(commands.readCreationFile).mockResolvedValue({
      status: 'ok',
      data: { kind: 'text', text: '// SuperCollider saved', version: 'disk-2' },
    })
    vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
      status: 'ok',
      data: { files: workspace.files, changed: [path], revision: 1 },
    })
    await act(async () => {
      await useCreationFilesStore.getState().poll()
    })
    if (dirty) {
      expect(
        await screen.findByRole('dialog', { name: 'The file changed on disk' })
      ).toHaveTextContent('// SuperCollider saved')
      expect(useCreationFilesStore.getState().drafts[path]).toMatchObject({
        text: '// local draft',
        conflict: { text: '// SuperCollider saved', version: 'disk-2' },
      })
    } else {
      await findEditorWithText('// SuperCollider saved')
      expect(useCreationFilesStore.getState().drafts[path]?.conflict).toBeNull()
    }
    expect(useSessionStore.getState().monitorReloadNonce).toBe(reloadNonce)
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
    expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  }
)

it('rechecks a removed saved target on retry and retains its recoverable draft', async () => {
  vi.mocked(commands.openCreationScd)
    .mockResolvedValueOnce({
      status: 'error',
      error: { code: 'supercolliderMissing', detail: 'GUI missing' },
    })
    .mockResolvedValueOnce({
      status: 'error',
      error: { code: 'missing', detail: 'saved SCD removed' },
    })
  render(<CreationView />)
  fireEvent.click(creationFileButton(path))
  editText(await findEditorWithText('// saved SCD'), '// recoverable draft')
  await creationFileAction('Open saved file in SuperCollider')
  await screen.findByRole('button', { name: 'Retry opening in SuperCollider' })
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: {
      files: workspace.files.filter(file => file.path !== path),
      changed: [path],
      revision: 1,
    },
  })
  vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'missing', detail: 'saved source removed' },
  })
  await act(async () => {
    await useCreationFilesStore.getState().poll()
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry opening in SuperCollider' })
  )
  await waitFor(() => expect(commands.openCreationScd).toHaveBeenCalledTimes(2))
  expect(await screen.findByText('saved SCD removed')).toBeVisible()
  expect(useCreationFilesStore.getState().drafts[path]?.text).toBe(
    '// recoverable draft'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('exposes the Chinese action to keyboard navigation and restores menu-trigger focus', async () => {
  await act(async () => {
    await i18n.changeLanguage('zh-CN')
  })
  try {
    render(<CreationView />)
    fireEvent.click(creationFileButton(path))
    await findEditorWithText('// saved SCD')
    const trigger = screen.getByRole('button', {
      name: i18n.t('desktop.fileActions'),
    })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const action = await screen.findByRole('menuitem', {
      name: '在 SuperCollider 中打开保存版',
    })
    action.focus()
    await userEvent.keyboard('{Enter}')
    expect(
      await screen.findByText(
        '已在 SuperCollider 中打开保存版，App 草稿仍保留在此处。'
      )
    ).toBeVisible()
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(commands.openCreationScd).toHaveBeenCalledWith('scd-project', path)
  } finally {
    await act(async () => {
      await i18n.changeLanguage('en')
    })
  }
})

it('offers the SCD action for an uppercase extension and omits it for ordinary scripts', async () => {
  const upper = 'supercollider/source/潮汐 synth.SCD'
  useCreationStore.setState({
    workspace: {
      ...workspace,
      files: workspace.files.map(file =>
        file.path === path ? { ...file, path: upper } : file
      ),
    },
  })
  render(<CreationView />)
  fireEvent.click(creationFileButton(upper))
  await findEditorWithText('// saved SCD')
  await creationFileAction('Open saved file in SuperCollider')
  expect(commands.openCreationScd).toHaveBeenCalledWith('scd-project', upper)
  fireEvent.click(creationFileButton('server.js'))
  await findEditorWithText('// saved SCD')
  await userEvent.click(screen.getByRole('button', { name: 'File actions' }))
  expect(
    screen.queryByRole('menuitem', { name: 'Open saved file in SuperCollider' })
  ).not.toBeInTheDocument()
})

it.each(['en', 'zh-CN'])(
  'keeps keyboard retry focus through waiting, repeated failure and success in %s',
  async language => {
    let finish!: (
      result: Awaited<ReturnType<typeof commands.openCreationScd>>
    ) => void
    vi.mocked(commands.openCreationScd)
      .mockResolvedValueOnce({
        status: 'error',
        error: { code: 'externalOpen', detail: 'first open failure' },
      })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve
          })
      )
      .mockResolvedValueOnce({ status: 'ok', data: null })
    await act(async () => {
      await i18n.changeLanguage(language)
    })
    try {
      render(<CreationView />)
      fireEvent.click(creationFileButton(path))
      editText(
        await findEditorWithText('// saved SCD'),
        '// keyboard retry draft'
      )
      await creationFileAction(i18n.t('creation.supercollider.action'))
      const retry = await screen.findByRole('button', {
        name: i18n.t('creation.supercollider.retry'),
      })
      retry.focus()
      await userEvent.keyboard('{Enter}')
      await screen.findByText(i18n.t('creation.supercollider.busy'))
      expect(retry).toBeInTheDocument()
      expect(retry).toHaveFocus()
      expect(retry).toHaveAttribute('aria-disabled', 'true')
      await userEvent.keyboard('{Enter}')
      expect(commands.openCreationScd).toHaveBeenCalledTimes(2)
      await act(async () =>
        finish({
          status: 'error',
          error: { code: 'externalOpen', detail: 'retry failed again' },
        })
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'retry failed again'
      )
      expect(retry).toHaveFocus()
      expect(retry).toHaveAttribute('aria-disabled', 'false')
      await userEvent.keyboard('{Enter}')
      await screen.findByText(i18n.t('creation.supercollider.opened'))
      expect(
        screen.getByRole('button', { name: i18n.t('desktop.fileActions') })
      ).toHaveFocus()
      await findEditorWithText('// keyboard retry draft')
      expect(commands.openCreationScd).toHaveBeenCalledTimes(3)
      expect(commands.saveCreationFile).not.toHaveBeenCalled()
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  }
)
