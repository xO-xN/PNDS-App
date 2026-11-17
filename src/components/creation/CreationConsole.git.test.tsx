import { beforeEach, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { editorWithText, findEditorWithText } from '@/test/text-editor'
import { seedCreationDraft } from '@/test/creation-files'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { useCreationConsoleWindowStore } from '@/lib/creation-console-window'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { useWindowStore } from '@/store/window-store'
import { CreationView } from './CreationView'
import { DesktopBar } from '@/components/shell/DesktopBar'

const path = 'public/score.js'
const savedText = 'const voice = 1'
const draftText = 'const voice = 2'
const workspace: CreationWorkspace = {
  project: {
    identity: 'git-console',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [
    { path, kind: 'text', category: 'pages', size: 15 },
    {
      path: 'supercollider/source/voice.scd',
      kind: 'text',
      category: 'audio',
      size: 20,
    },
  ],
}

function Workspace() {
  useCommandKeyboard()
  return (
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  usePerformanceRoleStore.getState().selectRole('host')
  useCreationStore.setState({ workspace: null })
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationStore.setState({
    active: true,
    workspace,
    opening: false,
    modePhase: 'idle',
    error: null,
  })
  useCreationFilesStore.getState().clear()
  seedCreationDraft(path, savedText, 'saved-v1')
  useCreationFilesStore.getState().edit(path, draftText)
  useCreationFilesStore.getState().setActivePath(path)
  useCreationFilesStore.setState({
    pending: { compile: 1, refresh: 1, restart: 1 },
  })
  useCreationTestStore.setState({
    expanded: false,
    error: null,
    runtimeError: null,
    log: [],
  })
  useCreationConsoleWindowStore.setState({ open: false })
  useCreationCompileStore.setState({ busy: false, report: null, error: null })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useSettingsStore.setState({
    settingsOpen: false,
    nodeNameSetting: 'Test Host',
  })
  useWindowStore.setState({ confirmCloseOpen: false, quitConfirmOpen: false })
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      head: 'newer',
      branch: 'main',
      changes: [],
      detail: null,
    },
  })
  vi.mocked(commands.getCreationGitVersions).mockResolvedValue({
    status: 'ok',
    data: {
      head: 'newer',
      branches: [{ name: 'main', tip: 'newer' }],
      versions: [
        {
          id: 'newer',
          message: 'Saved sound',
          author: 'Creator',
          parents: ['older'],
          timestamp: 2,
          files: [path],
        },
        {
          id: 'older',
          message: 'Earlier sound',
          author: 'Creator',
          parents: [],
          timestamp: 1,
          files: [path],
        },
      ],
      nextOffset: null,
      limited: false,
    },
  })
})

async function enterGit() {
  const editor = await findEditorWithText(draftText)
  act(() => useCreationReadingStore.getState().showGit())
  const git = await screen.findByRole('region', {
    name: i18n.t('creation.versions.title'),
  })
  const version = await within(git).findByRole('button', {
    name: /Earlier sound/,
  })
  fireEvent.click(version)
  expect(version).toHaveAttribute('aria-pressed', 'true')
  return { editor, git, version }
}

it('opens and closes the native console from Git while preserving the selected version and editor draft', async () => {
  render(<Workspace />)
  const { editor, git, version } = await enterGit()
  const consoleButton = screen.getByRole('button', {
    name: i18n.t('creation.console'),
  })
  expect(consoleButton).toHaveTextContent(
    i18n.t('creation.consoleStatus.pendingCompile')
  )
  expect(consoleButton).toBeVisible()
  for (const key of [
    'creation.pendingCompile',
    'creation.pendingRefresh',
    'creation.pendingRestart',
    'creation.runningDiskHint',
  ])
    expect(screen.queryByText(i18n.t(key))).not.toBeInTheDocument()

  fireEvent.click(consoleButton)
  await waitFor(() =>
    expect(consoleButton).toHaveAttribute('aria-pressed', 'true')
  )
  expect(
    screen.queryByRole('region', {
      name: i18n.t('creation.compile.console'),
    })
  ).not.toBeInTheDocument()
  expect(commands.toggleCreationConsole).toHaveBeenCalledTimes(1)
  expect(git).toBeVisible()
  expect(
    screen.getByRole('region', { name: i18n.t('creation.versions.title') })
  ).toBe(git)
  expect(version).toHaveAttribute('aria-pressed', 'true')
  expect(useCreationReadingStore.getState().view).toBe('git')

  vi.mocked(commands.toggleCreationConsole).mockResolvedValueOnce({
    status: 'ok',
    data: false,
  })
  fireEvent.click(consoleButton)
  await waitFor(() =>
    expect(consoleButton).toHaveAttribute('aria-pressed', 'false')
  )
  expect(commands.toggleCreationConsole).toHaveBeenCalledTimes(2)
  expect(git).toBeVisible()
  expect(version).toHaveAttribute('aria-pressed', 'true')
  expect(editorWithText(draftText)).toBe(editor)
  expect(useCreationFilesStore.getState().drafts[path]?.text).toBe(draftText)
  act(() => useCreationReadingStore.getState().showFile())
  expect(await findEditorWithText(draftText)).toBe(editor)
  expect(editor).toBeVisible()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('opens the same native console with Command-backtick without changing the Git selection', async () => {
  render(<Workspace />)
  const { editor, git, version } = await enterGit()
  const press = () => {
    const event = new KeyboardEvent('keydown', {
      key: '`',
      code: 'Backquote',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(window, event)
    expect(event.defaultPrevented).toBe(true)
  }
  press()
  await waitFor(() =>
    expect(commands.toggleCreationConsole).toHaveBeenCalledOnce()
  )
  expect(git).toBeVisible()
  expect(useCreationReadingStore.getState().view).toBe('git')
  expect(version).toHaveAttribute('aria-pressed', 'true')
  expect(editorWithText(draftText)).toBe(editor)
})
