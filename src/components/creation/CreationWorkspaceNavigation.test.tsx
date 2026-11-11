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
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import i18n from '@/i18n/config'
import { CreationView } from './CreationView'

const workspace: CreationWorkspace = {
  project: {
    identity: 'navigation',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [
    { path: 'manifest.json', kind: 'text', category: 'system', size: 10 },
    { path: 'README.md', kind: 'text', category: 'system', size: 10 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationFilesStore.getState().clear()
  useCreationHandoffStore.getState().clear()
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationTestStore.setState({ expanded: false, tab: 'file' })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useCreationStore.setState({
    active: true,
    workspace,
    opening: false,
    modePhase: 'idle',
    error: null,
  })
})

it('pins root declarations and keeps one resource entry and file/folder creation', async () => {
  render(<CreationView />)
  const tree = screen.getByRole('tree', { name: i18n.t('creation.files') })
  expect(
    within(tree)
      .getAllByRole('treeitem')
      .map(row => row.textContent)
  ).toEqual([
    `${i18n.t('creation.tree.role.contract')}｜manifest.json`,
    `${i18n.t('creation.tree.role.readme')}｜README.md`,
    i18n.t('creation.dependencies.title'),
  ])
  expect(
    screen.getByRole('button', { name: i18n.t('creation.resources.open') })
  ).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: i18n.t('creation.modules.open') })
  ).not.toBeInTheDocument()
  const manifest = screen.getByRole('treeitem', { name: 'manifest.json' })
  await userEvent.hover(manifest)
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(manifest).not.toHaveAttribute('title')
  await userEvent.unhover(manifest)

  vi.mocked(commands.createCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: { path: 'notes.md', kind: 'text', category: 'system', size: 0 },
  })
  await userEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.tree.new') })
  )
  await userEvent.click(
    screen.getByRole('menuitem', { name: i18n.t('creation.newFile.open') })
  )
  const form = screen.getByRole('form', {
    name: i18n.t('creation.newFile.open'),
  })
  fireEvent.change(within(form).getByRole('textbox'), {
    target: { value: 'notes.md' },
  })
  await userEvent.click(
    within(form).getByRole('button', {
      name: i18n.t('creation.newFile.create'),
    })
  )
  await waitFor(() =>
    expect(useCreationFilesStore.getState().activePath).toBe('notes.md')
  )
  expect(commands.createCreationFile).toHaveBeenCalledWith(
    'navigation',
    'notes.md',
    []
  )
  expect(screen.getByRole('treeitem', { name: 'notes.md' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('retains file filtering and keyboard quick open without requiring a visible file group', async () => {
  render(<CreationView />)
  fireEvent.change(
    screen.getByRole('searchbox', { name: i18n.t('creation.searchFiles') }),
    {
      target: { value: 'does-not-exist' },
    }
  )
  expect(screen.getByText(i18n.t('creation.noFiles'))).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true })
  const dialog = await screen.findByRole('dialog', {
    name: i18n.t('creation.editor.quickOpen'),
  })
  const query = within(dialog).getByRole('combobox')
  fireEvent.change(query, { target: { value: 'README' } })
  fireEvent.keyDown(query, { key: 'Enter' })
  await waitFor(() =>
    expect(useCreationFilesStore.getState().activePath).toBe('README.md')
  )
})

it('opens the pinned handoff file without a dedicated entry and retains its draft across pages', async () => {
  const path = 'docs/creator-handoff.md'
  useCreationStore.setState({
    workspace: {
      ...workspace,
      files: [
        ...workspace.files,
        { path, kind: 'text', category: 'system', size: 8 },
      ],
    },
  })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: '# Handoff\nOriginal plan', version: 'h1' },
  })
  render(<CreationView />)
  const navigation = within(
    screen.getByRole('navigation', { name: i18n.t('assistant.readingViews') })
  )
  await userEvent.click(screen.getByRole('treeitem', { name: path }))
  expect(await screen.findByRole('heading', { name: 'Handoff' })).toBeVisible()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(
    navigation.queryByRole('button', { name: i18n.t('creation.handoff.menu') })
  ).not.toBeInTheDocument()
  act(() => useCreationFilesStore.getState().edit(path, '# Draft handoff'))
  await userEvent.click(
    navigation.getByRole('button', { name: i18n.t('assistant.discussion') })
  )
  expect(useCreationReadingStore.getState().view).toBe('discussion')
  await userEvent.click(
    navigation.getByRole('button', { name: /creator-handoff\.md/ })
  )
  expect(
    await screen.findByRole('heading', { name: 'Draft handoff' })
  ).toBeVisible()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('uses one titlebar control to expand and restore Monitor', async () => {
  render(<CreationView />)
  const toggle = screen.getByRole('button', {
    name: i18n.t('creation.expandMonitor'),
  })
  const topbar = toggle.closest('[data-creation-topbar]')
  expect(topbar?.lastElementChild).toBe(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(
    screen.getByRole('button', {
      name: i18n.t('creation.restoreWorkspace'),
    })
  ).toBe(toggle)
  expect(topbar).toHaveTextContent('Score')
  expect(
    screen.queryByRole('button', { name: i18n.t('creation.switchProject') })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: i18n.t('creation.git.location') })
  ).not.toBeInTheDocument()
  act(() => useCreationStore.setState({ modePhase: 'settling' }))
  expect(toggle).toBeDisabled()
  act(() => useCreationStore.setState({ modePhase: 'idle' }))
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.getByRole('button', { name: i18n.t('creation.switchProject') })
  ).toBeEnabled()
})

it('opens Git in the existing middle workspace and returns to discussion without a dialog', async () => {
  render(<CreationView />)
  const navigation = within(
    screen.getByRole('navigation', { name: i18n.t('assistant.readingViews') })
  )
  await userEvent.click(
    navigation.getByRole('button', { name: i18n.t('creation.versions.tab') })
  )
  expect(useCreationReadingStore.getState().view).toBe('git')
  expect(
    screen.getByRole('region', { name: i18n.t('creation.versions.title') })
  ).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: i18n.t('assistant.discussion') })
  )
  expect(useCreationReadingStore.getState().view).toBe('discussion')
  expect(
    navigation.getByRole('button', { name: i18n.t('creation.versions.tab') })
  ).toHaveAttribute('aria-pressed', 'false')
  expect(commands.stopProject).not.toHaveBeenCalled()
})
