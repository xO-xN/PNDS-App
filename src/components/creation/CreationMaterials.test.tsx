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
  vi.mocked(commands.importCreationResource)
    .mockReset()
    .mockResolvedValue({ status: 'error', error: 'storage' })
  vi.mocked(open).mockReset().mockResolvedValue(null)
})

it('offers the two resource actions from one button and dismisses without acting', async () => {
  const user = userEvent.setup()
  render(<CreationMaterials identity="material-project" disabled={false} />)
  const region = await screen.findByRole('region', {
    name: 'Creation resources',
  })
  const resources = within(region)
  const trigger = resources.getByRole('button', { name: 'Add resource' })
  expect(resources.getAllByRole('button')).toEqual([trigger])
  expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  await user.click(resources.getByText('Drop resource files here'))
  expect(open).not.toHaveBeenCalled()
  await user.click(trigger)
  const create = await screen.findByRole('menuitem', { name: 'New text file' })
  const inbox = screen.getByRole('menuitem', { name: 'Import files' })
  expect(screen.getAllByRole('menuitem')).toEqual([create, inbox])
  expect(create).not.toHaveAttribute('aria-disabled', 'true')
  expect(inbox).not.toHaveAttribute('aria-disabled', 'true')
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  )
  expect(trigger).toHaveFocus()
  await user.click(trigger)
  await screen.findByRole('menu')
  fireEvent.pointerDown(document.body, { button: 0, pointerType: 'mouse' })
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  )
  expect(useCreationPendingStore.getState().drafts).toEqual({})
  expect(open).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(commands.listCreationMaterials).toHaveBeenCalledWith(
      'material-project'
    )
  )
  expect(commands.readCreationPendingDocument).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('disables the resource entry while the workspace is disabled', async () => {
  const user = userEvent.setup()
  render(<CreationMaterials identity="material-project" disabled />)
  const trigger = screen.getByRole('button', { name: 'Add resource' })
  expect(trigger).toBeDisabled()
  await user.click(trigger)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(useCreationPendingStore.getState().drafts).toEqual({})
  expect(open).not.toHaveBeenCalled()
})

it.each(['picker', 'import'])(
  'blocks repeated imports while the %s is pending and still allows a new text file',
  async busy => {
    let finishPicker!: (paths: string[] | null) => void
    let finishImport!: (
      result: Awaited<ReturnType<typeof commands.importCreationResource>>
    ) => void
    if (busy === 'picker')
      vi.mocked(open).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishPicker = resolve
          })
      )
    else {
      vi.mocked(open).mockResolvedValueOnce(['/external/Notes.md'])
      vi.mocked(commands.importCreationResource).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishImport = resolve
          })
      )
    }
    const user = userEvent.setup()
    render(<CreationMaterials identity="material-project" disabled={false} />)
    const trigger = screen.getByRole('button', { name: 'Add resource' })
    await user.click(trigger)
    await user.click(
      await screen.findByRole('menuitem', { name: 'Import files' })
    )
    if (busy === 'import')
      await waitFor(() =>
        expect(commands.importCreationResource).toHaveBeenCalled()
      )
    expect(trigger).toBeEnabled()
    await user.click(trigger)
    const inbox = await screen.findByRole('menuitem', { name: 'Import files' })
    expect(inbox).toHaveAttribute('aria-disabled', 'true')
    await user.click(inbox)
    expect(open).toHaveBeenCalledTimes(1)
    const create = screen.getByRole('menuitem', { name: 'New text file' })
    expect(create).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(create)
    expect(
      await screen.findByRole('textbox', { name: 'Document name' })
    ).toHaveFocus()
    if (busy === 'picker') await act(async () => finishPicker(null))
    else
      await act(async () => finishImport({ status: 'error', error: 'storage' }))
  }
)

it('lists files picked through the inbox without opening them, even during a catalog poll', async () => {
  const names = ['Notes.md', 'Still.png', 'Grid.js']
  const rejected = 'recording.zip'
  const documents: CreationMaterial[] = []
  let finishPoll!: () => void
  vi.mocked(open).mockResolvedValueOnce(
    [...names, rejected].map(name => `/external/${name}`)
  )
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
  vi.mocked(commands.importCreationResource).mockImplementation(
    async (_identity, path) => {
      if (path.endsWith(rejected))
        return { status: 'error', error: 'unsupportedType' }
      const material = {
        id: `material-${documents.length}`,
        name: path.slice('/external/'.length),
        version: 'version-1',
        size: 13,
        totalCharacters: 13,
      }
      if (path.endsWith('.png')) {
        return {
          status: 'ok',
          data: { ...material, id: 'image', mime: 'image/png' },
        }
      }
      documents.push(material)
      return { status: 'ok', data: material }
    }
  )

  const user = userEvent.setup()
  render(<CreationMaterials identity="material-project" disabled={false} />)
  await waitFor(() => expect(commands.listCreationMaterials).toHaveBeenCalled())
  await user.click(screen.getByRole('button', { name: 'Add resource' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'Import files' })
  )

  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ directory: false, multiple: true })
  )
  for (const name of names) {
    const file = await screen.findByRole('button', { name })
    expect(file).toBeVisible()
    expect(file).toHaveAttribute('aria-pressed', 'false')
    expect(commands.importCreationResource).toHaveBeenCalledWith(
      'material-project',
      `/external/${name}`
    )
  }
  expect(await screen.findByRole('alert')).toHaveTextContent(rejected)
  expect(screen.getByRole('alert')).toHaveTextContent(
    'This file type is not supported'
  )
  await act(async () => finishPoll())
  for (const name of names)
    expect(screen.getByRole('button', { name })).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(commands.readCreationPendingDocument).not.toHaveBeenCalled()
  expect(commands.readCreationPendingImage).not.toHaveBeenCalled()
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
  await user.click(screen.getByRole('button', { name: 'Add resource' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'Import files' })
  )
  expect(commands.importCreationResource).not.toHaveBeenCalled()
  let finish!: (path: string | null) => void
  vi.mocked(open).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  await user.click(screen.getByRole('button', { name: 'Add resource' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'Import files' })
  )
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
  expect(commands.importCreationResource).not.toHaveBeenCalled()
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
        name: i18n.t('creation.pending.add'),
      })
      trigger.focus()
      await user.keyboard('{Enter}')
      const create = await screen.findByRole('menuitem', {
        name: i18n.t('creation.pending.new'),
      })
      await waitFor(() => expect(create).toHaveFocus())
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
