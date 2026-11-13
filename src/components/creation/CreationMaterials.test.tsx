import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { open } from '@tauri-apps/plugin-dialog'
import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@/test/test-utils'
import i18n from '@/i18n/config'
import { useCreationPendingStore } from '@/store/creation-pending-store'
import {
  commands,
  type CreationMaterial,
  type CreationWorkspace,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { CreationMaterials } from './CreationMaterials'

const workspace: CreationWorkspace = {
  project: {
    identity: 'material-project',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [],
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: null,
    opening: false,
    modePhase: 'idle',
  })
  useCreationStore.setState({ workspace })
  vi.mocked(commands.listCreationMaterials)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: [] })
  vi.mocked(commands.addCreationMaterial)
    .mockReset()
    .mockResolvedValue({ status: 'error', error: 'storage' })
  vi.mocked(open).mockReset().mockResolvedValue(null)
})

it('shows only the two resource actions while the list is empty', async () => {
  const user = userEvent.setup()
  render(<CreationMaterials identity="material-project" disabled={false} />)
  const region = await screen.findByRole('region', {
    name: 'Creation resources',
  })
  const resources = within(region)
  const create = resources.getByRole('button', { name: 'New text file' })
  const inbox = resources.getByRole('button', { name: 'Inbox' })
  expect(resources.getAllByRole('button')).toEqual([create, inbox])
  expect(region).toHaveTextContent(/^Creation resources$/)
  expect(create).toBeEnabled()
  expect(inbox).toBeEnabled()
  await user.hover(inbox)
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'Drop text files here'
  )
  await waitFor(() =>
    expect(commands.listCreationMaterials).toHaveBeenCalledWith(
      'material-project'
    )
  )
  expect(commands.readCreationPendingDocument).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('lists files picked through the inbox without opening them, even during a catalog poll', async () => {
  const names = ['Notes.md', 'Grid.js']
  const documents: CreationMaterial[] = []
  let finishPoll!: () => void
  vi.mocked(open).mockResolvedValueOnce(names.map(name => `/external/${name}`))
  vi.mocked(commands.listCreationMaterials)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishPoll = () => resolve({ status: 'ok', data: [] })
        })
    )
    .mockImplementation(async () => ({
      status: 'ok',
      data: [...documents],
    }))
  vi.mocked(commands.addCreationMaterial).mockImplementation(
    async (_identity, path) => {
      const material = {
        id: `material-${documents.length}`,
        name: path.slice('/external/'.length),
        version: 'version-1',
        size: 13,
        totalCharacters: 13,
      }
      documents.push(material)
      return { status: 'ok', data: material }
    }
  )

  const user = userEvent.setup()
  render(<CreationMaterials identity="material-project" disabled={false} />)
  await waitFor(() => expect(commands.listCreationMaterials).toHaveBeenCalled())
  await user.click(screen.getByRole('button', { name: 'Inbox' }))

  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ directory: false, multiple: true })
  )
  for (const name of names) {
    const file = await screen.findByRole('button', { name })
    expect(file).toBeVisible()
    expect(file).toHaveAttribute('aria-pressed', 'false')
    expect(commands.addCreationMaterial).toHaveBeenCalledWith(
      'material-project',
      `/external/${name}`
    )
  }
  await act(async () => finishPoll())
  for (const name of names)
    expect(screen.getByRole('button', { name })).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(commands.readCreationPendingDocument).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})

it('shows migration failure as a retryable error and preserves the document catalog', async () => {
  vi.mocked(commands.listCreationMaterials)
    .mockResolvedValueOnce({ status: 'error', error: 'invalidRecord' })
    .mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'legacy-grid',
          name: 'Grid.js',
          version: 'old-version',
          size: 13,
          totalCharacters: 13,
        },
      ],
    })
  const user = userEvent.setup()
  render(<CreationMaterials identity="material-project" disabled={false} />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    i18n.t('creation.materials.error.invalidRecord')
  )
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: 'Grid.js' })).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})

it('cancels a text picker and rejects its late choice after changing projects', async () => {
  const user = userEvent.setup()
  const mounted = render(
    <CreationMaterials identity="material-project" disabled={false} />
  )
  await user.click(screen.getByRole('button', { name: 'Inbox' }))
  expect(commands.addCreationMaterial).not.toHaveBeenCalled()
  let finish!: (path: string | null) => void
  vi.mocked(open).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  await user.click(screen.getByRole('button', { name: 'Inbox' }))
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: { ...workspace.project, identity: 'other' },
      },
    })
  )
  mounted.unmount()
  await act(async () => finish('/external/Grid.js'))
  expect(commands.addCreationMaterial).not.toHaveBeenCalled()
  expect(useCreationPendingStore.getState().identity).toBe('other')
})

it('ignores a catalog reply from the previous project', async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof commands.listCreationMaterials>>
  ) => void
  vi.mocked(commands.listCreationMaterials).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const mounted = render(
    <CreationMaterials identity="material-project" disabled={false} />
  )
  await waitFor(() => expect(commands.listCreationMaterials).toHaveBeenCalled())
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: { ...workspace.project, identity: 'other' },
      },
    })
  )
  mounted.rerender(<CreationMaterials identity="other" disabled={false} />)
  await act(async () =>
    finish({
      status: 'ok',
      data: [
        {
          id: 'old',
          name: 'Old.js',
          version: '1',
          size: 1,
          totalCharacters: 1,
        },
      ],
    })
  )
  expect(
    screen.queryByRole('button', { name: 'Old.js' })
  ).not.toBeInTheDocument()
  expect(useCreationPendingStore.getState().documents).toEqual([])
})

it.each(['en', 'zh-CN'])(
  'creates and cancels an empty draft with localized keyboard controls in %s',
  async language => {
    await act(async () => {
      await i18n.changeLanguage(language)
    })
    try {
      const user = userEvent.setup()
      render(<CreationMaterials identity="material-project" disabled={false} />)
      const trigger = screen.getByRole('button', {
        name: i18n.t('creation.pending.new'),
      })
      trigger.focus()
      await user.keyboard('{Enter}')
      const name = await screen.findByRole('textbox', {
        name: i18n.t('creation.pending.name'),
      })
      expect(name).toHaveFocus()
      fireEvent.keyDown(name, { key: 'Escape' })
      await waitFor(() => expect(trigger).toHaveFocus())
      expect(useCreationPendingStore.getState().drafts).toEqual({})
      expect(commands.saveCreationPendingDocument).not.toHaveBeenCalled()
      expect(commands.deleteCreationPendingDocument).not.toHaveBeenCalled()
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  }
)
