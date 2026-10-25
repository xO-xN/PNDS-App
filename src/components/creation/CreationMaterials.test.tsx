import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { open } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { act, render, screen, waitFor, within } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { useCreationMaterialsStore } from '@/store/creation-materials-store'
import {
  commands,
  type CreationMaterial,
  type CreationWorkspace,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationView } from './CreationView'
import { CreationMaterials } from './CreationMaterials'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }))

const workspace: CreationWorkspace = {
  project: {
    identity: 'material-project',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [],
}
const material: CreationMaterial = {
  id: 'material-grid',
  name: 'Grid.js',
  version: 'saved-copy-1',
  size: 13,
  totalCharacters: 13,
}

function migrationAction() {
  const action = vi
    .mocked(toast.error)
    .mock.calls.find(
      ([, options]) => options?.id === 'creation-materials-material-project'
    )?.[1]?.action
  if (!action || typeof action !== 'object' || !('onClick' in action))
    throw new Error('Expected the materials action')
  return action
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationMaterialsStore.getState().close()
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    active: true,
    workspace,
    opening: false,
    modePhase: 'idle',
  })
  useCreationTestStore.setState({ tab: 'file', expanded: false })
  vi.mocked(open).mockReset().mockResolvedValue(null)
  vi.mocked(commands.listCreationMaterials)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: [] })
  vi.mocked(commands.addCreationMaterial)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: material })
  vi.mocked(commands.readCreationMaterial)
    .mockReset()
    .mockResolvedValue({
      status: 'ok',
      data: {
        material,
        text: 'class Grid {}',
        offset: 0,
        endOffset: 13,
        totalCharacters: 13,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      },
    })
  vi.mocked(commands.removeCreationMaterial)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: null })
})

it('initializes portable materials when a workspace opens with the dialog closed', async () => {
  render(<CreationView />)
  await waitFor(() =>
    expect(commands.listCreationMaterials).toHaveBeenCalledExactlyOnceWith(
      'material-project'
    )
  )
  expect(
    screen.queryByRole('dialog', { name: 'Creation materials' })
  ).not.toBeInTheDocument()
  expect(commands.readCreationMaterial).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(useCreationMaterialsStore.getState().request).toBeNull()
})

it.each(['rejected', 'invalidRecord'] as const)(
  'reports %s background migration while preserving chat and dialog retry',
  async failure => {
    const user = userEvent.setup()
    const list = vi.mocked(commands.listCreationMaterials)
    if (failure === 'rejected')
      list.mockRejectedValueOnce(new Error('Background storage failure'))
    else list.mockResolvedValueOnce({ status: 'error', error: failure })
    list
      .mockResolvedValueOnce({ status: 'error', error: 'invalidRecord' })
      .mockResolvedValue({ status: 'ok', data: [material] })
    render(<CreationView />)
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        i18n.t('creation.materials.migrationFailed'),
        {
          id: 'creation-materials-material-project',
          duration: 8000,
          description: i18n.t(
            `creation.materials.error.${failure === 'rejected' ? 'storage' : failure}`
          ),
          action: {
            label: i18n.t('creation.materials.openAction'),
            onClick: expect.any(Function),
          },
        }
      )
    )
    await user.click(
      screen.getByRole('button', { name: 'Conversation options' })
    )
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'New chat' })).toBeEnabled()
    )
    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('dialog', { name: 'Creation materials' })
    ).not.toBeInTheDocument()
    const action = migrationAction()
    act(() => action.onClick?.({} as React.MouseEvent<HTMLButtonElement>))
    const dialog = await screen.findByRole('dialog', {
      name: 'Creation materials',
    })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      i18n.t('creation.materials.error.invalidRecord')
    )
    const request = useCreationMaterialsStore.getState().request
    act(() => action.onClick?.({} as React.MouseEvent<HTMLButtonElement>))
    expect(useCreationMaterialsStore.getState().request).toBe(request)
    expect(dialog).toBeVisible()
    expect(list).toHaveBeenCalledTimes(2)
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Grid.js' })).toBeVisible()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
    expect(commands.addCreationMaterial).not.toHaveBeenCalled()
  }
)

it('suppresses a background migration failure after the workspace unmounts', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.listCreationMaterials>>
  ) => void
  vi.mocked(commands.listCreationMaterials).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const mounted = render(<CreationView />)
  await waitFor(() => expect(commands.listCreationMaterials).toHaveBeenCalled())
  mounted.unmount()
  await act(async () => finish({ status: 'error', error: 'invalidRecord' }))
  expect(toast.error).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: 'creation-materials-material-project' })
  )
})

it.each(['owner-changed', 'disabled', 'unmounted'] as const)(
  'does not open materials from an old migration action when %s',
  async change => {
    vi.mocked(commands.listCreationMaterials).mockResolvedValueOnce({
      status: 'error',
      error: 'invalidRecord',
    })
    const mounted = render(
      <CreationMaterials identity="material-project" disabled={false} />
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce())
    const action = migrationAction()
    if (change === 'owner-changed')
      act(() =>
        useCreationStore.setState({
          workspace: {
            ...workspace,
            project: { ...workspace.project, identity: 'other-project' },
          },
        })
      )
    else if (change === 'disabled')
      mounted.rerender(
        <CreationMaterials identity="material-project" disabled />
      )
    else mounted.unmount()
    act(() => action.onClick?.({} as React.MouseEvent<HTMLButtonElement>))
    expect(useCreationMaterialsStore.getState().request).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(commands.listCreationMaterials).toHaveBeenCalledOnce()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  }
)

it.each([
  'unsupportedType',
  'binary',
  'tooLarge',
  'unreadable',
  'storage',
] as const)(
  'reports %s without discarding saved materials and permits a manual retry',
  async error => {
    const user = userEvent.setup()
    vi.mocked(commands.listCreationMaterials).mockResolvedValue({
      status: 'ok',
      data: [material],
    })
    vi.mocked(commands.addCreationMaterial).mockResolvedValueOnce({
      status: 'error',
      error,
    })
    vi.mocked(open).mockResolvedValue('/external/failed.js')
    render(<CreationView />)
    await user.click(screen.getByRole('button', { name: 'Creation materials' }))
    await user.click(await screen.findByRole('button', { name: 'Grid.js' }))
    await screen.findByText('class Grid {}')
    await user.click(screen.getByRole('button', { name: 'Add text material' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t(`creation.materials.error.${error}`)
    )
    expect(screen.getByText('class Grid {}')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Grid.js' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add text material' }))
    await waitFor(() =>
      expect(commands.addCreationMaterial).toHaveBeenCalledTimes(2)
    )
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    )
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  }
)

it('retains readable material on failed removal and keeps keyboard focus for retry', async () => {
  const user = userEvent.setup()
  vi.mocked(commands.listCreationMaterials).mockResolvedValue({
    status: 'ok',
    data: [material],
  })
  vi.mocked(commands.removeCreationMaterial).mockResolvedValueOnce({
    status: 'error',
    error: 'storage',
  })
  render(<CreationView />)
  await user.click(screen.getByRole('button', { name: 'Creation materials' }))
  await user.click(await screen.findByRole('button', { name: 'Grid.js' }))
  await screen.findByText('class Grid {}')
  const remove = screen.getByRole('button', { name: 'Remove material' })
  remove.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Existing saved materials are kept'
  )
  expect(screen.getByText('class Grid {}')).toBeVisible()
  expect(remove).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(await screen.findByText('No creation materials yet.')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Add text material' })
  ).toHaveFocus()
})

it('cancels a picker and rejects its late selection after closing or switching projects', async () => {
  const user = userEvent.setup()
  let finish!: (path: string | null) => void
  vi.mocked(open).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(<CreationView />)
  const trigger = screen.getByRole('button', { name: 'Creation materials' })
  await user.click(trigger)
  await user.click(
    await screen.findByRole('button', { name: 'Add text material' })
  )
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveFocus())
  await act(async () => finish('/external/late.js'))
  expect(commands.addCreationMaterial).not.toHaveBeenCalled()
  let next!: (path: string | null) => void
  vi.mocked(open).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        next = resolve
      })
  )
  await user.click(trigger)
  await user.click(
    await screen.findByRole('button', { name: 'Add text material' })
  )
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: {
          ...workspace.project,
          identity: 'other-project',
          root: '/other',
        },
      },
    })
  )
  await act(async () => next('/external/late-other.js'))
  expect(commands.addCreationMaterial).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('dialog', { name: 'Creation materials' })
  ).not.toBeInTheDocument()
})

it.each(['en', 'zh-CN'])(
  'uses localized keyboard actions, cancellation and focus restoration in %s',
  async language => {
    await act(async () => {
      await i18n.changeLanguage(language)
    })
    try {
      const user = userEvent.setup()
      render(<CreationView />)
      const trigger = screen.getByRole('button', {
        name: i18n.t('creation.materials.open'),
      })
      trigger.focus()
      await user.keyboard('{Enter}')
      const add = await screen.findByRole('button', {
        name: i18n.t('creation.materials.add'),
      })
      add.focus()
      await user.keyboard('{Enter}')
      expect(commands.addCreationMaterial).not.toHaveBeenCalled()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(trigger).toHaveFocus())
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  }
)

it('ignores late list, read and imported-copy replies after the project identity changes', async () => {
  const user = userEvent.setup()
  let finish!: (
    result: Awaited<ReturnType<typeof commands.addCreationMaterial>>
  ) => void
  vi.mocked(open).mockResolvedValueOnce('/external/Grid.js')
  vi.mocked(commands.addCreationMaterial).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(<CreationView />)
  await user.click(screen.getByRole('button', { name: 'Creation materials' }))
  await user.click(
    await screen.findByRole('button', { name: 'Add text material' })
  )
  await waitFor(() =>
    expect(commands.addCreationMaterial).toHaveBeenCalledOnce()
  )
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: {
          ...workspace.project,
          identity: 'other-project',
          root: '/other',
        },
      },
    })
  )
  await act(async () => finish({ status: 'ok', data: material }))
  expect(commands.readCreationMaterial).not.toHaveBeenCalled()
  expect(screen.queryByText('class Grid {}')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Creation materials' }))
  expect(await screen.findByText('No creation materials yet.')).toBeVisible()
  expect(commands.listCreationMaterials).toHaveBeenLastCalledWith(
    'other-project'
  )
  await user.keyboard('{Escape}')
  let finishList!: (
    result: Awaited<ReturnType<typeof commands.listCreationMaterials>>
  ) => void
  vi.mocked(commands.listCreationMaterials).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishList = resolve
      })
  )
  await user.click(screen.getByRole('button', { name: 'Creation materials' }))
  await user.keyboard('{Escape}')
  await act(async () => finishList({ status: 'ok', data: [material] }))
  expect(
    screen.queryByRole('button', { name: 'Grid.js' })
  ).not.toBeInTheDocument()
  vi.mocked(commands.listCreationMaterials).mockResolvedValue({
    status: 'ok',
    data: [material],
  })
  let finishRead!: (
    result: Awaited<ReturnType<typeof commands.readCreationMaterial>>
  ) => void
  vi.mocked(commands.readCreationMaterial).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishRead = resolve
      })
  )
  await user.click(screen.getByRole('button', { name: 'Creation materials' }))
  await user.click(await screen.findByRole('button', { name: 'Grid.js' }))
  await user.keyboard('{Escape}')
  await act(async () => finishRead({ status: 'error', error: 'missing' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps loaded text on a failed next-page read and retries the exact remaining range', async () => {
  const user = userEvent.setup()
  const larger = { ...material, size: 80, totalCharacters: 80 }
  vi.mocked(commands.listCreationMaterials).mockResolvedValue({
    status: 'ok',
    data: [larger],
  })
  vi.mocked(commands.readCreationMaterial)
    .mockResolvedValueOnce({
      status: 'ok',
      data: {
        material: larger,
        text: 'first page',
        offset: 0,
        endOffset: 64,
        totalCharacters: 80,
        nextOffset: 64,
        startLine: 1,
        endLine: 1,
      },
    })
    .mockResolvedValueOnce({ status: 'error', error: 'storage' })
    .mockResolvedValueOnce({
      status: 'ok',
      data: {
        material: larger,
        text: '\nlast page',
        offset: 64,
        endOffset: 80,
        totalCharacters: 80,
        nextOffset: null,
        startLine: 2,
        endLine: 2,
      },
    })
  render(<CreationView />)
  await user.click(screen.getByRole('button', { name: 'Creation materials' }))
  await user.click(await screen.findByRole('button', { name: 'Grid.js' }))
  await screen.findByText('first page')
  await user.click(screen.getByRole('button', { name: 'Load more' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Existing saved materials are kept'
  )
  expect(screen.getByText('first page')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Load more' }))
  expect(await screen.findByLabelText('Material contents')).toHaveTextContent(
    'first page last page'
  )
  expect(commands.readCreationMaterial).toHaveBeenLastCalledWith(
    'material-project',
    {
      id: material.id,
      version: material.version,
      offset: 64,
      pageLength: 65536,
    }
  )
})

it('adds a private copy, reads its actual contents after reopening and only removes the material', async () => {
  const user = userEvent.setup()
  vi.mocked(open).mockResolvedValueOnce('/external/Grid.js')
  const first = render(<CreationView />)
  await user.click(screen.getByRole('button', { name: 'Creation materials' }))
  await user.click(
    await screen.findByRole('button', { name: 'Add text material' })
  )
  expect(await screen.findByText('class Grid {}')).toBeVisible()
  expect(commands.addCreationMaterial).toHaveBeenCalledWith(
    'material-project',
    '/external/Grid.js'
  )
  expect(commands.readCreationMaterial).toHaveBeenCalledWith(
    'material-project',
    { id: material.id, version: material.version, offset: 0, pageLength: 65536 }
  )
  vi.mocked(commands.listCreationMaterials).mockResolvedValue({
    status: 'ok',
    data: [material],
  })
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Conversation options' }))
  const newChat = await screen.findByRole('menuitem', { name: 'New chat' })
  await waitFor(() => expect(newChat).toBeEnabled())
  await user.click(newChat)
  await user.click(screen.getByRole('button', { name: 'Creation materials' }))
  await user.click(await screen.findByRole('button', { name: 'Grid.js' }))
  expect(await screen.findByText('class Grid {}')).toBeVisible()
  first.unmount()
  render(<CreationView />)
  await user.click(screen.getByRole('button', { name: 'Creation materials' }))
  await user.click(await screen.findByRole('button', { name: 'Grid.js' }))
  await screen.findByText('class Grid {}')
  await user.click(screen.getByRole('button', { name: 'Remove material' }))
  await waitFor(() =>
    expect(commands.removeCreationMaterial).toHaveBeenCalledWith(
      'material-project',
      material.id
    )
  )
  expect(await screen.findByText('No creation materials yet.')).toBeVisible()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.removeCreationAssistantFile).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})
