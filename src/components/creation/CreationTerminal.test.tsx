import { confirm, message } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { StrictMode } from 'react'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { editText, findEditorWithText } from '@/test/text-editor'
import { seedCreationDraft } from '@/test/creation-files'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationPendingStore } from '@/store/creation-pending-store'
import { useSessionStore } from '@/store/session-store'
import {
  endCreationTerminal,
  showCreationTerminal,
  useCreationTerminalStore,
} from '@/store/creation-terminal-store'
import { CreationModeButton } from './CreationModeButton'
import { CreationGitRestore } from './CreationGitRestore'
import { useGithubAuthStore } from './creation-github-data'
import { CreationView } from './CreationView'
import { QuitConfirmDialog } from '@/components/shell/QuitConfirmDialog'
import { AppShell } from '@/components/shell/AppShell'
import { requestQuit, useWindowStore } from '@/store/window-store'

const drawing: { text: string; color: unknown }[] = []
type Read = Awaited<ReturnType<typeof commands.readProjectTerminal>>
let deliver: ((value: Read) => void) | undefined
let pendingClose:
  | ((value: Awaited<ReturnType<typeof commands.closeProjectTerminal>>) => void)
  | undefined
let pendingFileSave:
  | ((value: Awaited<ReturnType<typeof commands.saveCreationFile>>) => void)
  | undefined
let pendingOpen:
  | ((value: Awaited<ReturnType<typeof commands.openProjectTerminal>>) => void)
  | undefined
let sequence = 0
let session = 0
let themeCss = ''
const initialRuntime = await commands.getCreationRuntime()
function currentWorkspace() {
  const workspace = useCreationStore.getState().workspace
  if (!workspace) throw new Error('No fixture workspace')
  return workspace
}
function applyTheme(theme: string) {
  document.documentElement.dataset.colorTheme = theme
  // jsdom has no browser stylesheet invalidation after repeated sheet replacement.
  // Resolve the shipped rule at the CSS system boundary, retaining literal samples below.
  const selector = theme === 'pond' ? ':root' : `[data-color-theme='${theme}']`
  const block =
    themeCss.slice(themeCss.indexOf(`${selector} {`)).split('}')[0] ?? ''
  for (const match of block.matchAll(
    /(--pnds-terminal-[\w-]+):\s*(#[0-9a-f]+);/g
  ))
    if (match[1] && match[2])
      document.documentElement.style.setProperty(match[1], match[2])
}
const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
const nav = () =>
  within(screen.getByRole('navigation', { name: 'Workspace reading views' }))
async function output(text: string) {
  await waitFor(() => expect(deliver).toBeDefined())
  await act(async () => {
    const send = deliver
    if (!send) throw new Error('No pending terminal read')
    deliver = undefined
    send({
      status: 'ok',
      data: {
        sessionId: `terminal-${session}`,
        sequence: ++sequence,
        bytes: [...new TextEncoder().encode(text)],
        eof: false,
        exitCode: null,
        error: null,
      },
    })
  })
}
beforeEach(async () => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useWindowStore.getState().setQuitConfirmOpen(false)
  vi.mocked(commands.getCreationRuntime)
    .mockReset()
    .mockResolvedValue(initialRuntime)
  vi.mocked(confirm).mockReset().mockResolvedValue(false)
  vi.mocked(message).mockReset().mockResolvedValue('Cancel')
  vi.mocked(commands.beginProjectTerminalQuit)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: 1 })
  vi.mocked(commands.finishProjectTerminalQuit)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: null })
  drawing.length = 0
  deliver = undefined
  pendingClose = undefined
  pendingOpen = undefined
  pendingFileSave = undefined
  sequence = 0
  session = 0
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationFilesStore.getState().clear()
  useCreationPendingStore.getState().reset(null)
  useCreationTestStore.setState({ expanded: false })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useCreationStore.setState({
    active: true,
    modePlan: null,
    modeError: null,
    request: null,
    error: null,
    modePhase: 'idle',
    opening: false,
    workspace: {
      project: {
        identity: 'terminal-project',
        root: '/工程 with space',
        name: 'Score',
        source: 'folder',
      },
      files: [
        { path: 'README.md', category: 'system', kind: 'text', size: 10 },
      ],
    },
  })
  themeCss = await readFile('src/theme-variables.css', 'utf8')
  applyTheme('pond')
  const bytes = await readFile('src/assets/project-terminal/ghostty-vt.wasm')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ),
    })
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* No browser layout in jsdom. */
      }
      disconnect() {
        /* No layout subscription. */
      }
    }
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      let context = contexts.get(this)
      if (!context) {
        const target = {
          fillStyle: '',
          measureText: () => ({
            width: 8,
            actualBoundingBoxAscent: 10,
            actualBoundingBoxDescent: 3,
          }),
          fillText(text: string) {
            drawing.push({ text, color: target.fillStyle })
          },
        }
        context = new Proxy(target, {
          get(object, key) {
            return (
              Reflect.get(object, key) ??
              (() => {
                /* Canvas OS boundary. */
              })
            )
          },
        }) as unknown as CanvasRenderingContext2D
        contexts.set(this, context)
      }
      return context
    } as never
  )
  vi.mocked(commands.pollCreationChanges).mockImplementation(async () => ({
    status: 'ok',
    data: {
      files: currentWorkspace().files,
      changed: [],
      revision: 0,
    },
  }))
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'error',
    error: { code: 'missing', detail: 'No file fixture' },
  })
  vi.mocked(commands.writeProjectTerminal).mockReset().mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.openProjectTerminal)
    .mockReset()
    .mockImplementation(async identity => ({
      status: 'ok',
      data: {
        id: `terminal-${++session}`,
        identity,
        state: 'running',
        exitCode: null,
      },
    }))
  vi.mocked(commands.getProjectTerminal).mockReset().mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.readProjectTerminal)
    .mockReset()
    .mockImplementation(
      () =>
        new Promise(resolve => {
          deliver = resolve
        })
    )
  vi.mocked(commands.closeProjectTerminal).mockReset().mockResolvedValue({
    status: 'ok',
    data: null,
  })
})
afterEach(async () => {
  pendingOpen?.({ status: 'error', error: 'Fixture cleanup' })
  pendingFileSave?.({
    status: 'error',
    error: { code: 'io', detail: 'Fixture cleanup' },
  })
  pendingClose?.({ status: 'error', error: 'Fixture cleanup' })
  vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  await act(async () => {
    useWindowStore.getState().setQuitConfirmOpen(false)
    await endCreationTerminal(
      useCreationTerminalStore.getState().identity ?? ''
    )
    if (useCreationTerminalStore.getState().hasSession)
      await endCreationTerminal(
        useCreationTerminalStore.getState().identity ?? ''
      )
  })
  cleanup()
  await new Promise(resolve => setTimeout(resolve, 0))
  for (const key of [...document.documentElement.style])
    if (key.startsWith('--pnds-terminal-'))
      document.documentElement.style.removeProperty(key)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('opens one real terminal only on request and preserves its output across workspace views', async () => {
  render(<CreationView />)
  expect(commands.openProjectTerminal).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Terminal input')).not.toBeInTheDocument()
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  expect(await screen.findByText('Shell running')).toBeVisible()
  const input = screen.getByRole('textbox', { name: 'Terminal input' })
  expect(input).toHaveFocus()
  await output('SAVED TERMINAL OUTPUT\r\n')
  await waitFor(() =>
    expect(drawing.map(item => item.text).join('')).toContain(
      'SAVED TERMINAL OUTPUT'
    )
  )
  await userEvent.click(
    nav().getByRole('button', { name: 'PNDS creation assistant' })
  )
  expect(input).not.toBeVisible()
  await userEvent.click(screen.getByRole('treeitem', { name: 'README.md' }))
  await userEvent.click(nav().getByRole('button', { name: 'Version history' }))
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  expect(
    screen.getByLabelText('Terminal input', { selector: 'textarea' })
  ).toBe(input)
  expect(input).toHaveFocus()
  expect(commands.openProjectTerminal).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(input, { key: 'c', code: 'KeyC', ctrlKey: true })
  await waitFor(() =>
    expect(commands.writeProjectTerminal).toHaveBeenCalledWith(
      'terminal-project',
      'terminal-1',
      [3]
    )
  )
  const retiredRead = deliver
  await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
  expect(await screen.findByText('Terminal ended')).toBeVisible()
  expect(
    screen.queryByLabelText('Terminal input', { selector: 'textarea' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
  expect(await screen.findByText('Shell running')).toBeVisible()
  expect(commands.openProjectTerminal).toHaveBeenCalledTimes(2)
  if (!retiredRead) throw new Error('No retired read')
  await act(async () =>
    retiredRead({
      status: 'ok',
      data: {
        sessionId: 'terminal-1',
        sequence: 99,
        bytes: [...new TextEncoder().encode('LATE OLD OUTPUT')],
        eof: true,
        exitCode: 8,
        error: null,
      },
    })
  )
  expect(screen.getByText('Shell running')).toBeVisible()
  expect(drawing.map(item => item.text).join('')).not.toContain(
    'LATE OLD OUTPUT'
  )
})

it('finishes a slow open without stealing focus or drawing after the user switches views', async () => {
  let complete!: (
    value: Awaited<ReturnType<typeof commands.openProjectTerminal>>
  ) => void
  vi.mocked(commands.openProjectTerminal).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        complete = resolve
      })
  )
  render(<CreationView />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await waitFor(() => expect(complete).toBeDefined())
  const discussion = nav().getByRole('button', {
    name: 'PNDS creation assistant',
  })
  await userEvent.click(discussion)
  await act(async () =>
    complete({
      status: 'ok',
      data: {
        id: 'terminal-0',
        identity: 'terminal-project',
        state: 'running',
        exitCode: null,
      },
    })
  )
  const input = document.querySelector('textarea[aria-label="Terminal input"]')
  expect(input).not.toHaveFocus()
  expect(discussion).toHaveFocus()
  const frames = vi.spyOn(globalThis, 'requestAnimationFrame')
  await output('BACKGROUND OUTPUT\r\n')
  await new Promise(resolve => setTimeout(resolve, 40))
  expect(frames).not.toHaveBeenCalled()
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  expect(input).toHaveFocus()
  await waitFor(() =>
    expect(drawing.map(item => item.text).join('')).toContain(
      'BACKGROUND OUTPUT'
    )
  )
})

const paletteCases = [
  [
    'pond',
    '#fcfdff',
    '#293541',
    [
      '#293541',
      '#9d3043',
      '#30634f',
      '#755015',
      '#355b85',
      '#655080',
      '#006b80',
      '#d4e3f0',
      '#495b68',
      '#ac2758',
      '#16703a',
      '#a34200',
      '#155fc4',
      '#7e22ce',
      '#00788e',
      '#fcfdff',
    ],
  ],
  [
    'sand',
    '#fbf8f1',
    '#352e24',
    [
      '#352e24',
      '#93332b',
      '#315943',
      '#6b4918',
      '#445384',
      '#704764',
      '#005a72',
      '#ddc6a5',
      '#60523f',
      '#9d2350',
      '#185e29',
      '#8d3700',
      '#1b50a6',
      '#7c249c',
      '#006d80',
      '#fffdf8',
    ],
  ],
  [
    'stage',
    '#26332e',
    '#e7ece9',
    [
      '#171b1c',
      '#f4a3ac',
      '#a5c8b6',
      '#dfbd7d',
      '#acbee6',
      '#ccafd9',
      '#7dd3e8',
      '#e7ece9',
      '#adbbb4',
      '#ffb7c4',
      '#b7d8c6',
      '#ebcc93',
      '#c3d0ef',
      '#dec7e8',
      '#9ce2ed',
      '#ffffff',
    ],
  ],
  [
    'brutal',
    '#fffdf6',
    '#000000',
    [
      '#000000',
      '#8e1530',
      '#1c4c36',
      '#5a3e0b',
      '#2a417c',
      '#60386d',
      '#006b82',
      '#ffedb3',
      '#4a4028',
      '#b0184f',
      '#086b2e',
      '#aa3b00',
      '#004fcc',
      '#7800bf',
      '#00788c',
      '#ffffff',
    ],
  ],
] as const
const rgb = (hex: string) =>
  `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
it.each(paletteCases)(
  'initializes %s colors only when a new terminal opens',
  async (theme, background, foreground, ansi) => {
    applyTheme(theme)
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--pnds-terminal-foreground')
        .trim()
    ).toBe(foreground)
    render(<CreationView />)
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    await screen.findByText('Shell running')
    const colors = ansi
      .map(
        (_, index) =>
          `\x1b[${index < 8 ? 30 + index : 90 + index - 8}m${String.fromCharCode(65 + index)}`
      )
      .join('')
    await output(`\x1b[0mZ${colors}\x1b[38;2;1;2;3mX`)
    await waitFor(() => {
      expect(
        [...drawing].reverse().find(item => item.text === 'Z')?.color
      ).toBe(rgb(foreground))
      ansi.forEach((color, index) =>
        expect(
          [...drawing]
            .reverse()
            .find(item => item.text === String.fromCharCode(65 + index))?.color
        ).toBe(rgb(color))
      )
      expect(
        [...drawing].reverse().find(item => item.text === 'X')?.color
      ).toBe('rgb(1, 2, 3)')
    })
    const canvas = document.querySelector('[data-project-terminal]')
    expect(canvas).toHaveStyle({ background })
    applyTheme(theme === 'stage' ? 'pond' : 'stage')
    await userEvent.click(
      nav().getByRole('button', { name: 'PNDS creation assistant' })
    )
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    expect(document.querySelector('[data-project-terminal]')).toBe(canvas)
    expect(canvas).toHaveStyle({ background })
    expect(commands.openProjectTerminal).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
    await screen.findByText('Terminal ended')
    await userEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
    await screen.findByText('Shell running')
    expect(document.querySelector('[data-project-terminal]')).toHaveStyle({
      background: theme === 'stage' ? '#fcfdff' : '#26332e',
    })
    expect(commands.openProjectTerminal).toHaveBeenCalledTimes(2)
  }
)

it('keeps native startup ownership available for explicit cleanup and retries a failed end', async () => {
  vi.mocked(commands.openProjectTerminal).mockResolvedValueOnce({
    status: 'error',
    error: 'Shell startup failed; cleanup unconfirmed',
  })
  vi.mocked(commands.getProjectTerminal).mockResolvedValue({
    status: 'ok',
    data: {
      id: 'failed-owner',
      identity: 'terminal-project',
      state: 'exited',
      exitCode: 127,
    },
  })
  render(<CreationView />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Shell startup failed; cleanup unconfirmed'
  )
  expect(screen.queryByText('Shell running')).not.toBeInTheDocument()
  vi.mocked(commands.closeProjectTerminal).mockResolvedValueOnce({
    status: 'error',
    error: 'Managed job is still running',
  })
  await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Managed job is still running'
  )
  expect(
    screen.queryByRole('button', { name: 'Open terminal' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
  expect(await screen.findByText('Terminal ended')).toBeVisible()
  expect(commands.closeProjectTerminal).toHaveBeenLastCalledWith(
    'terminal-project',
    'failed-owner'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
  expect(await screen.findByText('Shell running')).toBeVisible()
})

it('reports a resource failure and retries only when explicitly opened', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 404,
    statusText: 'Missing asset',
  } as Response)
  render(<CreationView />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Failed to fetch WASM'
  )
  expect(commands.openProjectTerminal).not.toHaveBeenCalled()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(commands.openProjectTerminal).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
  expect(await screen.findByText('Shell running')).toBeVisible()
})

it('distinguishes output EOF, actual exit and explicit managed-job cleanup', async () => {
  render(<CreationView />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  vi.mocked(commands.getProjectTerminal).mockResolvedValue({
    status: 'ok',
    data: {
      identity: 'terminal-project',
      id: 'terminal-1',
      state: 'running',
      exitCode: null,
    },
  })
  await act(async () => {
    if (!deliver) throw new Error('No pending terminal read')
    deliver({
      status: 'ok',
      data: {
        sessionId: 'terminal-1',
        sequence: ++sequence,
        bytes: [],
        eof: true,
        exitCode: null,
        error: null,
      },
    })
  })
  expect(
    await screen.findByText('Output ended; shell exit not confirmed')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'End terminal' })).toBeEnabled()
  vi.mocked(commands.getProjectTerminal).mockResolvedValue({
    status: 'ok',
    data: {
      identity: 'terminal-project',
      id: 'terminal-1',
      state: 'exited',
      exitCode: 7,
    },
  })
  expect(
    await screen.findByText(
      'Shell exited (7); end terminal to release managed jobs'
    )
  ).toBeVisible()
  expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
  expect(await screen.findByText('Terminal ended')).toBeVisible()
})

it.each(['bundle', 'utility', 'readOnlyFolder'] as const)(
  'offers no terminal for a %s project',
  source => {
    const workspace = currentWorkspace()
    useCreationStore.setState({
      workspace: { ...workspace, project: { ...workspace.project, source } },
    })
    render(<CreationView />)
    expect(
      screen.queryByRole('button', { name: 'Terminal' })
    ).not.toBeInTheDocument()
    expect(commands.openProjectTerminal).not.toHaveBeenCalled()
  }
)

function KeyboardWorkspace() {
  useCommandKeyboard()
  return <CreationView />
}
it('keeps App save and console chords out of PTY input while preserving terminal control keys', async () => {
  seedCreationDraft('README.md', '# Original', 'readme-v1')
  useCreationFilesStore.getState().edit('README.md', '# Unsaved draft')
  useCreationFilesStore.getState().setActivePath('README.md')
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'readme-v2',
  })
  render(<KeyboardWorkspace />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  const input = screen.getByLabelText('Terminal input', {
    selector: 'textarea',
  })
  fireEvent.keyDown(input, { key: 's', code: 'KeyS', metaKey: true })
  await waitFor(() =>
    expect(commands.saveCreationFile).toHaveBeenCalledWith(
      'terminal-project',
      'README.md',
      '# Unsaved draft',
      'readme-v1'
    )
  )
  fireEvent.keyDown(input, { key: '`', code: 'Backquote', metaKey: true })
  await waitFor(() => expect(commands.toggleCreationConsole).toHaveBeenCalled())
  expect(commands.writeProjectTerminal).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'd', code: 'KeyD', ctrlKey: true })
  await waitFor(() =>
    expect(commands.writeProjectTerminal).toHaveBeenLastCalledWith(
      'terminal-project',
      'terminal-1',
      [4]
    )
  )
})

it('adopts CLI saved changes through the watcher while retaining the author draft and manual runtime boundary', async () => {
  const clean = 'public/clean.js',
    dirty = 'public/dirty.js'
  const workspace = currentWorkspace()
  useCreationStore.setState({
    workspace: {
      ...workspace,
      files: [clean, dirty].map(path => ({
        path,
        kind: 'text',
        category: 'pages',
        size: 10,
      })),
    },
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: workspace.project.root,
  })
  let changed = false
  vi.mocked(commands.pollCreationChanges).mockImplementation(async () => ({
    status: 'ok',
    data: {
      files: currentWorkspace().files,
      changed: changed ? [clean, dirty] : [],
      revision: changed ? 1 : 0,
    },
  }))
  vi.mocked(commands.readCreationFile).mockImplementation(
    async (_identity, path) => ({
      status: 'ok',
      data: {
        kind: 'text',
        text: changed
          ? path === clean
            ? 'CLI saved clean'
            : 'CLI saved dirty'
          : 'Original text',
        version: changed ? 'v2' : 'v1',
      },
    })
  )
  let shellInput = ''
  vi.mocked(commands.writeProjectTerminal).mockImplementation(
    async (_identity, _id, bytes) => {
      shellInput += new TextDecoder().decode(Uint8Array.from(bytes))
      if (shellInput.includes('fixture-edit\r')) changed = true
      return { status: 'ok', data: null }
    }
  )
  render(<CreationView />)
  await userEvent.click(screen.getByRole('treeitem', { name: clean }))
  await findEditorWithText('Original text')
  await userEvent.click(screen.getByRole('treeitem', { name: dirty }))
  editText(
    await screen.findByRole('textbox', { name: dirty }),
    'Author unsaved draft'
  )
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  const input = screen.getByLabelText('Terminal input', {
    selector: 'textarea',
  })
  fireEvent.paste(input, { clipboardData: { getData: () => 'fixture-edit' } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  await waitFor(() => expect(changed).toBe(true))
  await waitFor(
    () =>
      expect(screen.getAllByLabelText('Disk changed').length).toBeGreaterThan(
        0
      ),
    { timeout: 2000 }
  )
  expect(
    screen.getByRole('dialog', { name: 'The file changed on disk' })
  ).toHaveTextContent('CLI saved dirty')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await userEvent.click(screen.getByRole('treeitem', { name: clean }))
  expect(await findEditorWithText('CLI saved clean')).toBeVisible()
  await userEvent.click(screen.getByRole('treeitem', { name: dirty }))
  expect(await findEditorWithText('Author unsaved draft')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitRecord).not.toHaveBeenCalled()
})

it('survives StrictMode effect replay without a duplicate session or output reader', async () => {
  render(
    <StrictMode>
      <CreationView />
    </StrictMode>
  )
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await output('STRICT MODE OUTPUT')
  await waitFor(() =>
    expect(drawing.map(item => item.text).join('')).toContain(
      'STRICT MODE OUTPUT'
    )
  )
  expect(commands.openProjectTerminal).toHaveBeenCalledTimes(1)
  expect(document.querySelectorAll('[data-project-terminal]')).toHaveLength(1)
})

it('blocks terminal during failed merge restoration and enables it after explicit recovery finds no candidate', async () => {
  const workspace = currentWorkspace()
  useCreationStore.setState({ workspace: { ...workspace, mergePending: true } })
  vi.mocked(commands.getCreationGitMerge)
    .mockResolvedValueOnce({
      status: 'error',
      error: { code: 'io', detail: 'Merge receipt unreadable' },
    })
    .mockResolvedValue({ status: 'ok', data: null })
  render(<CreationView />)
  expect(
    await screen.findByText(
      'Merge candidate unavailable. Reopen version history.'
    )
  ).toBeVisible()
  expect(
    nav().queryByRole('button', { name: 'Terminal' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Terminal' }))
  expect(await screen.findByText('Shell running')).toBeVisible()
})

it('retains an opening terminal when a mode confirmation is armed and then cancelled', async () => {
  let complete!: (
    value: Awaited<ReturnType<typeof commands.openProjectTerminal>>
  ) => void
  vi.mocked(commands.openProjectTerminal).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        complete = resolve
      })
  )
  render(
    <>
      <CreationView />
      <CreationModeButton />
    </>
  )
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await waitFor(() => expect(complete).toBeDefined())
  await userEvent.click(
    screen.getByRole('button', { name: 'Return to performance mode' })
  )
  await screen.findByRole('button', {
    name: 'Click again to switch to Performance mode',
  })
  await act(async () =>
    complete({
      status: 'ok',
      data: {
        id: 'terminal-0',
        identity: 'terminal-project',
        state: 'running',
        exitCode: null,
      },
    })
  )
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(await screen.findByText('Shell running')).toBeVisible()
  expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Terminal input' })).toHaveFocus()
})

it('ends the current terminal before replacing its project and opens the next only on request', async () => {
  render(<CreationView />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  const next = {
    ...currentWorkspace(),
    project: {
      ...currentWorkspace().project,
      identity: 'replacement-project',
      root: '/replacement',
    },
  }
  vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: next,
  })
  // Exercise the existing project-open flow, not a mocked workspace store.
  vi.mocked(confirm).mockResolvedValueOnce(true)
  await act(async () => {
    expect(
      await useCreationStore.getState().open('/replacement'),
      JSON.stringify(useCreationStore.getState().error)
    ).toBe(true)
  })
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  expect(commands.closeProjectTerminal).toHaveBeenCalledWith(
    'terminal-project',
    'terminal-1'
  )
  expect(await screen.findByText('Shell running')).toBeVisible()
  expect(commands.openProjectTerminal).toHaveBeenLastCalledWith(
    'replacement-project',
    expect.any(Number),
    expect.any(Number)
  )
})

it('keeps ending and failed-cleanup feedback when EOF and exit arrive late', async () => {
  let complete:
    | ((
        value: Awaited<ReturnType<typeof commands.closeProjectTerminal>>
      ) => void)
    | undefined
  vi.mocked(commands.closeProjectTerminal).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        complete = resolve
        pendingClose = resolve
      })
  )
  let exited = false,
    observedExit = false
  vi.mocked(commands.getProjectTerminal).mockImplementation(async () => {
    observedExit = exited
    return {
      status: 'ok',
      data: {
        identity: 'terminal-project',
        id: 'terminal-1',
        state: exited ? 'exited' : 'running',
        exitCode: exited ? 7 : null,
      },
    }
  })
  render(<CreationView />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
  await act(async () => {
    if (!deliver) throw new Error('No pending read')
    deliver({
      status: 'ok',
      data: {
        sessionId: 'terminal-1',
        sequence: ++sequence,
        bytes: [],
        eof: true,
        exitCode: null,
        error: null,
      },
    })
  })
  expect(screen.getByText('Ending terminal…')).toBeVisible()
  expect(screen.getByRole('button', { name: 'End terminal' })).toBeDisabled()
  await act(async () => {
    if (!complete) throw new Error('No pending close')
    complete({ status: 'error', error: 'A managed job could not be stopped' })
  })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'A managed job could not be stopped'
  )
  exited = true
  await waitFor(() => expect(observedExit).toBe(true))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'A managed job could not be stopped'
  )
  expect(screen.getByText('Terminal error')).toBeVisible()
  expect(screen.getByRole('button', { name: 'End terminal' })).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: 'Open terminal' })
  ).not.toBeInTheDocument()
})

it('cleans an externally revoked session only after native absence is confirmed and lets the user reopen', async () => {
  render(<CreationView />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await act(async () => {
    if (!deliver) throw new Error('No pending read')
    deliver({ status: 'error', error: 'The terminal session expired' })
  })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The terminal session expired'
  )
  vi.mocked(commands.closeProjectTerminal).mockResolvedValueOnce({
    status: 'error',
    error: 'The terminal session expired',
  })
  vi.mocked(commands.getProjectTerminal).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
  expect(await screen.findByText('Terminal ended')).toBeVisible()
  expect(
    screen.queryByRole('textbox', { name: 'Terminal input' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
  expect(await screen.findByText('Shell running')).toBeVisible()
  expect(commands.openProjectTerminal).toHaveBeenCalledTimes(2)
})

it.each(['query-failure', 'same-owner', 'newer-owner'] as const)(
  'retains close failure without native absence proof (%s)',
  async condition => {
    render(<CreationView />)
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    await screen.findByText('Shell running')
    vi.mocked(commands.closeProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: 'Cleanup not confirmed',
    })
    if (condition === 'query-failure')
      vi.mocked(commands.getProjectTerminal).mockRejectedValueOnce(
        new Error('Ownership query unavailable')
      )
    else
      vi.mocked(commands.getProjectTerminal).mockResolvedValue({
        status: 'ok',
        data: {
          identity: 'terminal-project',
          id: condition === 'newer-owner' ? 'terminal-newer' : 'terminal-1',
          state: 'running',
          exitCode: null,
        },
      })
    await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cleanup not confirmed'
    )
    expect(
      screen.queryByRole('button', { name: 'Open terminal' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Terminal input' })
    ).toBeInTheDocument()
    expect(commands.closeProjectTerminal).toHaveBeenCalledWith(
      'terminal-project',
      'terminal-1'
    )
    expect(commands.closeProjectTerminal).not.toHaveBeenCalledWith(
      'terminal-project',
      'terminal-newer'
    )
  }
)

it('does not restart an ended terminal on a page remount but a fresh explicit visit opens it', async () => {
  const page = render(<CreationView />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
  await screen.findByText('Terminal ended')
  await userEvent.click(
    nav().getByRole('button', { name: 'PNDS creation assistant' })
  )
  page.unmount()
  render(<CreationView />)
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(commands.openProjectTerminal).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[data-project-terminal]')).toBeNull()
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  expect(await screen.findByText('Shell running')).toBeVisible()
  expect(commands.openProjectTerminal).toHaveBeenCalledTimes(2)
})

it('keeps the current terminal and author draft when a project-menu switch is cancelled', async () => {
  const original = currentWorkspace()
  const path = 'public/author.js'
  useCreationStore.setState({
    workspace: {
      ...original,
      files: [
        ...original.files,
        { path, category: 'pages', kind: 'text', size: 12 },
      ],
    },
  })
  const next = {
    ...original,
    project: {
      ...original.project,
      identity: 'replacement-project',
      root: '/replacement',
      name: 'Replacement',
    },
  }
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: 'original text', version: 'readme-v1' },
  })
  vi.mocked(commands.describeCreationProjects).mockResolvedValue({
    status: 'ok',
    data: [{ path: '/replacement', project: next.project, error: null }],
  })
  vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: next,
  })
  // Approve the existing ordinary-draft discard consequence, then cancel
  // ending this terminal. Neither choice may apply a write or stop yet.
  vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  render(<CreationView />)
  await userEvent.click(screen.getByRole('treeitem', { name: path }))
  editText(await findEditorWithText('original text'), 'author draft')
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await output('OLD_PROJECT_MARKER')
  await userEvent.click(
    screen.getByRole('button', { name: 'Switch to another project' })
  )
  await userEvent.click(
    await screen.findByRole('menuitem', { name: 'Replacement' })
  )
  await waitFor(() => expect(useCreationStore.getState().opening).toBe(false))
  expect(useCreationStore.getState().workspace?.project.identity).toBe(
    'terminal-project'
  )
  expect(screen.getByText('Shell running')).toBeVisible()
  const input = screen.getByRole('textbox', { name: 'Terminal input' })
  fireEvent.keyDown(input, { key: 'x', code: 'KeyX' })
  await waitFor(() =>
    expect(commands.writeProjectTerminal).toHaveBeenLastCalledWith(
      'terminal-project',
      'terminal-1',
      [120]
    )
  )
  await userEvent.click(screen.getByRole('treeitem', { name: path }))
  expect(await findEditorWithText('author draft')).toBeVisible()
  expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
  expect(commands.stopProjectGeneration).not.toHaveBeenCalled()
  expect(commands.commitCreationProject).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it.each(['cancel', 'cleanup failure'])(
  'keeps a pending Save choice unapplied after terminal %s',
  async outcome => {
    const original = currentWorkspace()
    const next = {
      ...original,
      project: {
        ...original.project,
        identity: 'replacement-project',
        root: '/replacement',
        name: 'Replacement',
      },
    }
    vi.mocked(commands.describeCreationProjects).mockResolvedValue({
      status: 'ok',
      data: [{ path: '/replacement', project: next.project, error: null }],
    })
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: next,
    })
    vi.mocked(commands.saveCreationPendingDocument).mockImplementation(
      async (_identity, input) => ({
        status: 'ok',
        data: {
          id: input.id,
          name: input.name,
          version: 'saved-1',
          size: input.text.length,
          totalCharacters: input.text.length,
        },
      })
    )
    vi.mocked(message).mockReset().mockResolvedValue('Save and continue')
    vi.mocked(confirm)
      .mockReset()
      .mockResolvedValue(outcome !== 'cancel')
    if (outcome === 'cleanup failure') {
      vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
        status: 'error',
        error: 'Managed jobs still owned',
      })
      vi.mocked(commands.getProjectTerminal).mockResolvedValue({
        status: 'ok',
        data: {
          id: 'terminal-1',
          identity: 'terminal-project',
          state: 'running',
          exitCode: null,
        },
      })
    }
    render(<CreationView />)
    await userEvent.click(screen.getByRole('button', { name: 'Add resource' }))
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'New text file' })
    )
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Document name' }),
      'Notes{Enter}'
    )
    editText(await findEditorWithText(''), 'private author draft')
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    await screen.findByText('Shell running')
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to another project' })
    )
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Replacement' })
    )
    await waitFor(() => expect(useCreationStore.getState().opening).toBe(false))
    expect(commands.saveCreationPendingDocument).not.toHaveBeenCalled()
    expect(commands.commitCreationProject).not.toHaveBeenCalled()
    expect(commands.stopProjectGeneration).not.toHaveBeenCalled()
    expect(useCreationStore.getState().workspace?.project.identity).toBe(
      'terminal-project'
    )
    await userEvent.click(nav().getByRole('button', { name: /^Notes/ }))
    expect(await findEditorWithText('private author draft')).toBeVisible()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  }
)

it.each(['cancel', 'cleanup failure'])(
  'preserves the running workspace when returning to performance meets terminal %s',
  async outcome => {
    const workspace = currentWorkspace()
    const base = await commands.getCreationRuntime()
    if (base.status === 'error') throw new Error('No runtime fixture')
    vi.mocked(commands.getCreationRuntime).mockResolvedValue({
      status: 'ok',
      data: {
        ...base.data,
        projectRoot: workspace.project.root,
        snapshot: {
          ...base.data.snapshot,
          status: 'ready',
          projectPath: workspace.project.root,
          projectName: 'Score',
        },
      },
    })
    useSessionStore.setState({ sessionStatus: 'ready' })
    vi.mocked(confirm)
      .mockReset()
      .mockResolvedValue(outcome !== 'cancel')
    if (outcome === 'cleanup failure') {
      vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
        status: 'error',
        error: 'Managed jobs still owned',
      })
      vi.mocked(commands.getProjectTerminal).mockResolvedValue({
        status: 'ok',
        data: {
          id: 'terminal-1',
          identity: 'terminal-project',
          state: 'running',
          exitCode: null,
        },
      })
    }
    render(
      <>
        <CreationView />
        <CreationModeButton />
      </>
    )
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    await screen.findByText('Shell running')
    await userEvent.click(
      screen.getByRole('button', { name: 'Return to performance mode' })
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Click again to switch to Performance mode',
      })
    )
    await waitFor(() =>
      expect(useCreationStore.getState().modePhase).toBe('idle')
    )
    expect(confirm).toHaveBeenCalled()
    expect(commands.stopProjectGeneration).not.toHaveBeenCalled()
    expect(commands.commitCreationProject).not.toHaveBeenCalled()
    expect(useCreationStore.getState().active).toBe(true)
    expect(useCreationStore.getState().workspace?.project.identity).toBe(
      'terminal-project'
    )
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Terminal input' }), {
      key: 'x',
      code: 'KeyX',
    })
    await waitFor(() =>
      expect(commands.writeProjectTerminal).toHaveBeenLastCalledWith(
        'terminal-project',
        'terminal-1',
        [120]
      )
    )
  }
)

function versionHistoryWithChanges() {
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      head: 'b',
      branch: 'main',
      detail: null,
      changes: [
        {
          path: 'README.md',
          staged: false,
          unstaged: true,
          untracked: false,
          indexStatus: ' ',
          diskStatus: 'M',
        },
      ],
    },
  })
  vi.mocked(commands.getCreationGitVersions).mockResolvedValue({
    status: 'ok',
    data: {
      head: 'b',
      branches: [{ name: 'main', tip: 'b' }],
      nextOffset: null,
      limited: false,
      versions: [
        {
          id: 'b',
          message: 'Current version',
          author: 'Creator',
          timestamp: 2,
          parents: ['a'],
          files: ['README.md'],
        },
        {
          id: 'a',
          message: 'Starting point',
          author: 'Creator',
          timestamp: 1,
          parents: [],
          files: ['README.md'],
        },
      ],
    },
  })
  vi.mocked(commands.getCreationGitComparison).mockResolvedValue({
    status: 'ok',
    data: {
      token: 'comparison',
      before: { commit: 'a', message: 'Before', saved: false },
      after: { commit: 'b', message: 'After', saved: true },
      files: [],
    },
  })
  vi.mocked(commands.getCreationGitTaskPending).mockResolvedValue({
    status: 'ok',
    data: true,
  })
  vi.mocked(commands.previewCreationGitSwitch).mockResolvedValue({
    status: 'ok',
    data: {
      token: 'reviewed-switch',
      commit: 'a',
      paths: ['README.md'],
      discardedPaths: ['README.md'],
    },
  })
  vi.mocked(commands.confirmCreationGitSwitch).mockResolvedValue({
    status: 'ok',
    data: null,
  })
}

it.each(['cancel', 'cleanup failure'])(
  'keeps the current task and saved version before terminal %s on a version switch',
  async outcome => {
    versionHistoryWithChanges()
    vi.mocked(confirm)
      .mockReset()
      .mockResolvedValue(outcome !== 'cancel')
    if (outcome === 'cleanup failure') {
      vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
        status: 'error',
        error: 'Managed jobs still owned',
      })
      vi.mocked(commands.getProjectTerminal).mockResolvedValue({
        status: 'ok',
        data: {
          id: 'terminal-1',
          identity: 'terminal-project',
          state: 'running',
          exitCode: null,
        },
      })
    }
    render(<CreationView />)
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    await screen.findByText('Shell running')
    await userEvent.click(
      nav().getByRole('button', { name: 'Version history' })
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /Starting point/ })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to this version' })
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Discard changes and switch' })
    )
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(commands.endCreationGitAssistantTask).not.toHaveBeenCalled()
    expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
    expect(commands.stopProjectGeneration).not.toHaveBeenCalled()
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    expect(
      screen.getByRole('textbox', { name: 'Terminal input' })
    ).toHaveFocus()
  }
)

it.each(['cancel', 'cleanup failure'])(
  'keeps task, drafts and runtime before terminal %s when preparing a merge candidate',
  async outcome => {
    versionHistoryWithChanges()
    vi.mocked(commands.probeCreationGitMerge).mockResolvedValue({
      status: 'ok',
      data: {
        relation: 'diverged',
        source: 'a',
        target: 'b',
        base: null,
        branch: 'main',
        dirty: true,
      },
    })
    vi.mocked(confirm)
      .mockReset()
      .mockResolvedValue(outcome !== 'cancel')
    if (outcome === 'cleanup failure') {
      vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
        status: 'error',
        error: 'Managed jobs still owned',
      })
      vi.mocked(commands.getProjectTerminal).mockResolvedValue({
        status: 'ok',
        data: {
          id: 'terminal-1',
          identity: 'terminal-project',
          state: 'running',
          exitCode: null,
        },
      })
    }
    render(<CreationView />)
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    await screen.findByText('Shell running')
    await userEvent.click(
      nav().getByRole('button', { name: 'Version history' })
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /Starting point/ })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Merge into current version' })
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Discard changes and merge' })
    )
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(commands.endCreationGitAssistantTask).not.toHaveBeenCalled()
    expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
    expect(commands.prepareCreationGitMerge).not.toHaveBeenCalled()
    expect(commands.stopProjectGeneration).not.toHaveBeenCalled()
  }
)

it('offers Cancel before quitting with only a project terminal and no score session', async () => {
  vi.mocked(commands.quitApp).mockResolvedValue({ status: 'ok', data: null })
  render(
    <>
      <CreationView />
      <QuitConfirmDialog />
    </>
  )
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await act(async () => requestQuit())
  expect(screen.getByRole('alertdialog')).toBeVisible()
  expect(commands.quitApp).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('Shell running')).toBeVisible()
  expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
})

async function nativeTerminalQuit(
  identity: string,
  sessionId: string,
  token = 1
) {
  const callback = vi
    .mocked(listen)
    .mock.calls.slice()
    .reverse()
    .find(([name]) => name === 'terminal-quit-requested-event')?.[1]
  expect(callback).toBeDefined()
  await act(async () =>
    callback?.({
      event: 'terminal-quit-requested-event',
      id: 1,
      payload: { identity, sessionId, token },
    })
  )
}

it('routes repeated native quit requests to one cancellable confirmation and rejects an old owner', async () => {
  vi.mocked(commands.getProjectTerminal).mockImplementation(async identity => ({
    status: 'ok',
    data: {
      id: `terminal-${session}`,
      identity,
      state: 'running',
      exitCode: null,
    },
  }))
  render(
    <>
      <AppShell />
      <QuitConfirmDialog />
    </>
  )
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await nativeTerminalQuit('terminal-project', 'terminal-1')
  await nativeTerminalQuit('terminal-project', 'terminal-1')
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
  await nativeTerminalQuit('old-project', 'old-session', 71)
  expect(commands.finishProjectTerminalQuit).toHaveBeenCalledWith(71)
  expect(commands.finishProjectTerminalQuit).not.toHaveBeenCalledWith(1)
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
  await screen.findByText('Terminal ended')
  await userEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
  await screen.findByText('Shell running')
  const closes = vi.mocked(commands.closeProjectTerminal).mock.calls.length
  await nativeTerminalQuit('terminal-project', 'terminal-1')
  await nativeTerminalQuit('old-project', 'terminal-2')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(commands.closeProjectTerminal).toHaveBeenCalledTimes(closes)
  expect(commands.quitApp).not.toHaveBeenCalled()
})

it('confirms a native quit while opening and waits for the actual session before ending and quitting', async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof commands.openProjectTerminal>>
  ) => void
  vi.mocked(commands.openProjectTerminal).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = value => {
          pendingOpen = undefined
          resolve(value)
        }
        pendingOpen = finish
      })
  )
  vi.mocked(commands.getProjectTerminal).mockResolvedValue({
    status: 'ok',
    data: {
      id: 'opening-native',
      identity: 'terminal-project',
      state: 'running',
      exitCode: null,
    },
  })
  vi.mocked(commands.quitApp).mockResolvedValue({ status: 'ok', data: null })
  render(
    <>
      <AppShell />
      <QuitConfirmDialog />
    </>
  )
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await waitFor(() => expect(finish).toBeDefined())
  await nativeTerminalQuit('terminal-project', 'opening-native')
  await userEvent.click(screen.getByRole('button', { name: 'End & Quit' }))
  expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
  expect(commands.quitApp).not.toHaveBeenCalled()
  await act(async () =>
    finish({
      status: 'ok',
      data: {
        id: 'opening-native',
        identity: 'terminal-project',
        state: 'running',
        exitCode: null,
      },
    })
  )
  await waitFor(() =>
    expect(commands.closeProjectTerminal).toHaveBeenCalledWith(
      'terminal-project',
      'opening-native'
    )
  )
  await waitFor(() => expect(commands.quitApp).toHaveBeenCalledOnce())
})

it.each(['cancel', 'cleanup failure'])(
  'preserves the terminal before %s in the advanced saved-file restore',
  async outcome => {
    vi.mocked(commands.previewCreationGitRestore).mockResolvedValue({
      status: 'ok',
      data: { token: 'legacy-reviewed', commit: 'older', paths: ['README.md'] },
    })
    vi.mocked(commands.confirmCreationGitRestore).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    vi.mocked(confirm)
      .mockReset()
      .mockResolvedValue(outcome !== 'cancel')
    if (outcome === 'cleanup failure') {
      vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
        status: 'error',
        error: 'Managed jobs still owned',
      })
      vi.mocked(commands.getProjectTerminal).mockResolvedValue({
        status: 'ok',
        data: {
          id: 'terminal-1',
          identity: 'terminal-project',
          state: 'running',
          exitCode: null,
        },
      })
    }
    render(
      <>
        <CreationView />
        <CreationGitRestore
          identity="terminal-project"
          commit="older"
          onRestored={vi.fn()}
        />
      </>
    )
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    await screen.findByText('Shell running')
    await userEvent.click(
      screen.getByRole('button', { name: 'Return to this version' })
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Restore saved files' })
    )
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(commands.confirmCreationGitRestore).not.toHaveBeenCalled()
    expect(commands.stopProjectGeneration).not.toHaveBeenCalled()
  }
)

it.each(['cancel', 'cleanup failure'])(
  'preserves the terminal before %s of a confirmed GitHub fast-forward',
  async outcome => {
    versionHistoryWithChanges()
    vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
      status: 'ok',
      data: {
        state: 'available',
        head: 'b',
        branch: 'main',
        changes: [],
        detail: null,
      },
    })
    vi.mocked(commands.getCreationGitTaskPending).mockResolvedValue({
      status: 'ok',
      data: false,
    })
    const account = { id: '7', login: 'composer', avatarUrl: '' }
    const auth = { configured: true, account, installationUrl: null }
    useGithubAuthStore.setState({ status: auth, error: null })
    vi.mocked(commands.githubAuthStatus).mockResolvedValue({
      status: 'ok',
      data: auth,
    })
    const status = {
      supported: true,
      templateBackupEligible: false,
      templateBackupPending: null,
      templateBackupPublished: false,
      templateBackupRecovered: false,
      branch: 'main',
      head: 'b',
      origin: null,
      repository: {
        id: '42',
        fullName: 'composer/score',
        private: false,
        canPush: true,
        defaultBranch: 'main',
      },
      accountId: '7',
      autoBackup: false,
      autoBackupPaused: false,
      firstBackupConfirmed: true,
      pending: false,
      relation: 'behind' as const,
      remoteHead: 'remote-next',
      stale: false,
      issue: null,
    }
    vi.mocked(commands.githubSyncStatus).mockResolvedValue({
      status: 'ok',
      data: status,
    })
    vi.mocked(commands.githubUpdate).mockResolvedValue({
      status: 'ok',
      data: {
        status: { ...status, head: 'remote-next', relation: 'equal' },
        paths: [],
      },
    })
    vi.mocked(confirm)
      .mockReset()
      .mockResolvedValue(outcome !== 'cancel')
    if (outcome === 'cleanup failure') {
      vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
        status: 'error',
        error: 'Managed jobs still owned',
      })
      vi.mocked(commands.getProjectTerminal).mockResolvedValue({
        status: 'ok',
        data: {
          id: 'terminal-1',
          identity: 'terminal-project',
          state: 'running',
          exitCode: null,
        },
      })
    }
    render(<CreationView />)
    await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
    await screen.findByText('Shell running')
    await userEvent.click(
      nav().getByRole('button', { name: 'Version history' })
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Manage GitHub repository' })
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Update from GitHub' })
    )
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Update from GitHub',
      })
    )
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(commands.githubUpdate).not.toHaveBeenCalled()
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
    expect(commands.stopProjectGeneration).not.toHaveBeenCalled()
  }
)

it('keeps terminal quit authorization while a draft save waits through a repeated native quit', async () => {
  const original = currentWorkspace()
  const path = 'public/quit.js'
  useCreationStore.setState({
    workspace: {
      ...original,
      files: [
        ...original.files,
        { path, category: 'pages', kind: 'text', size: 12 },
      ],
    },
  })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: 'original', version: 'before' },
  })
  let finishSave!: (
    value: Awaited<ReturnType<typeof commands.saveCreationFile>>
  ) => void
  vi.mocked(commands.saveCreationFile).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishSave = value => {
          pendingFileSave = undefined
          resolve(value)
        }
        pendingFileSave = finishSave
      })
  )
  let owned = true
  vi.mocked(commands.getProjectTerminal).mockImplementation(async () => ({
    status: 'ok',
    data: owned
      ? {
          id: 'terminal-1',
          identity: 'terminal-project',
          state: 'running',
          exitCode: null,
        }
      : null,
  }))
  vi.mocked(commands.closeProjectTerminal).mockImplementation(async () => {
    owned = false
    return { status: 'ok', data: null }
  })
  vi.mocked(commands.beginProjectTerminalQuit).mockResolvedValue({
    status: 'ok',
    data: 41,
  })
  vi.mocked(commands.quitApp).mockResolvedValue({ status: 'ok', data: null })
  render(
    <>
      <AppShell />
      <QuitConfirmDialog />
    </>
  )
  await userEvent.click(screen.getByRole('treeitem', { name: path }))
  editText(await findEditorWithText('original'), 'author waiting to save')
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await nativeTerminalQuit('terminal-project', 'terminal-1')
  await userEvent.click(screen.getByRole('button', { name: 'Save & Quit' }))
  await waitFor(() => expect(finishSave).toBeDefined())
  expect(commands.beginProjectTerminalQuit).toHaveBeenCalledOnce()
  expect(
    vi.mocked(commands.beginProjectTerminalQuit).mock.invocationCallOrder[0]
  ).toBeLessThan(
    vi.mocked(commands.closeProjectTerminal).mock.invocationCallOrder[0] ?? 0
  )
  await nativeTerminalQuit('terminal-project', 'terminal-1', 41)
  expect(commands.quitApp).not.toHaveBeenCalled()
  expect(commands.finishProjectTerminalQuit).not.toHaveBeenCalledWith(41)
  await act(async () => finishSave({ status: 'ok', data: 'after' }))
  await waitFor(() => expect(commands.quitApp).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(commands.finishProjectTerminalQuit).toHaveBeenCalledWith(41)
  )
})

it('does not let an older quit cancellation release a newer terminal quit intent', async () => {
  let finishOld!: (
    value: Awaited<ReturnType<typeof commands.finishProjectTerminalQuit>>
  ) => void
  vi.mocked(commands.beginProjectTerminalQuit)
    .mockReset()
    .mockResolvedValueOnce({ status: 'ok', data: 51 })
    .mockResolvedValueOnce({ status: 'ok', data: 52 })
  vi.mocked(commands.finishProjectTerminalQuit)
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishOld = resolve
        })
    )
    .mockResolvedValue({ status: 'ok', data: null })
  vi.mocked(commands.quitApp).mockResolvedValue({ status: 'ok', data: null })
  render(
    <>
      <CreationView />
      <QuitConfirmDialog />
    </>
  )
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await act(async () => requestQuit())
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(finishOld).toBeDefined())
  await act(async () => requestQuit())
  await act(async () => finishOld({ status: 'ok', data: null }))
  expect(screen.getByRole('alertdialog')).toBeVisible()
  expect(commands.finishProjectTerminalQuit).toHaveBeenCalledExactlyOnceWith(51)
  await act(async () => requestQuit())
  expect(commands.beginProjectTerminalQuit).toHaveBeenCalledTimes(2)
  await userEvent.click(screen.getByRole('button', { name: 'End & Quit' }))
  await waitFor(() => expect(commands.quitApp).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(commands.finishProjectTerminalQuit).toHaveBeenLastCalledWith(52)
  )
})

it('blocks a fresh terminal through version replacement after the old session ended', async () => {
  versionHistoryWithChanges()
  let finishSwitch!: (
    value: Awaited<ReturnType<typeof commands.confirmCreationGitSwitch>>
  ) => void
  vi.mocked(commands.confirmCreationGitSwitch).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishSwitch = resolve
      })
  )
  let owned = true
  vi.mocked(commands.getProjectTerminal).mockImplementation(async () => ({
    status: 'ok',
    data: owned
      ? {
          id: 'terminal-1',
          identity: 'terminal-project',
          state: 'running',
          exitCode: null,
        }
      : null,
  }))
  vi.mocked(commands.closeProjectTerminal).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        pendingClose = resolve
      })
  )
  vi.mocked(confirm).mockReset().mockResolvedValue(true)
  render(
    <>
      <AppShell />
      <QuitConfirmDialog />
    </>
  )
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await userEvent.click(nav().getByRole('button', { name: 'Version history' }))
  await userEvent.click(
    await screen.findByRole('button', { name: /Starting point/ })
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Switch to this version' })
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Discard changes and switch' })
  )
  await waitFor(() => expect(pendingClose).toBeDefined())
  await nativeTerminalQuit('terminal-project', 'terminal-1', 81)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(commands.beginProjectTerminalQuit).not.toHaveBeenCalled()
  expect(commands.finishProjectTerminalQuit).toHaveBeenCalledWith(81)
  await act(async () => {
    owned = false
    pendingClose?.({ status: 'ok', data: null })
    pendingClose = undefined
  })
  await waitFor(() => expect(finishSwitch).toBeDefined())
  expect(commands.closeProjectTerminal).toHaveBeenCalledWith(
    'terminal-project',
    'terminal-1'
  )
  expect(showCreationTerminal('terminal-project')).toBe(false)
  expect(commands.openProjectTerminal).toHaveBeenCalledTimes(1)
  await act(async () => finishSwitch({ status: 'ok', data: null }))
  await waitFor(() =>
    expect(nav().getByRole('button', { name: 'Terminal' })).toBeEnabled()
  )
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  expect(await screen.findByText('Shell running')).toBeVisible()
  expect(commands.openProjectTerminal).toHaveBeenCalledTimes(2)
  expect(commands.openProjectTerminal).toHaveBeenLastCalledWith(
    'terminal-project',
    expect.any(Number),
    expect.any(Number)
  )
})

it('keeps author drafts and the quit dialog after terminal cleanup fails before saving', async () => {
  const original = currentWorkspace()
  const path = 'public/failure.js'
  useCreationStore.setState({
    workspace: {
      ...original,
      files: [
        ...original.files,
        { path, category: 'pages', kind: 'text', size: 12 },
      ],
    },
  })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: 'original', version: 'before' },
  })
  vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
    status: 'error',
    error: 'Managed jobs still owned',
  })
  vi.mocked(commands.getProjectTerminal).mockResolvedValue({
    status: 'ok',
    data: {
      id: 'terminal-1',
      identity: 'terminal-project',
      state: 'running',
      exitCode: null,
    },
  })
  render(
    <>
      <CreationView />
      <QuitConfirmDialog />
    </>
  )
  await userEvent.click(screen.getByRole('treeitem', { name: path }))
  editText(await findEditorWithText('original'), 'author draft before quit')
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await screen.findByText('Shell running')
  await act(async () => requestQuit())
  await userEvent.click(screen.getByRole('button', { name: 'Save & Quit' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Managed jobs still owned'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.stopProjectGeneration).not.toHaveBeenCalled()
  expect(commands.quitApp).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await userEvent.click(screen.getByRole('treeitem', { name: path }))
  expect(await findEditorWithText('author draft before quit')).toBeVisible()
})

it('waits for a pending terminal open and confirmed end before replacing a project', async () => {
  const original = currentWorkspace()
  const next = {
    ...original,
    project: {
      ...original.project,
      identity: 'replacement-project',
      root: '/replacement',
      name: 'Replacement',
    },
  }
  let finishOpen!: (
    value: Awaited<ReturnType<typeof commands.openProjectTerminal>>
  ) => void
  vi.mocked(commands.openProjectTerminal).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishOpen = value => {
          pendingOpen = undefined
          resolve(value)
        }
        pendingOpen = finishOpen
      })
  )
  vi.mocked(commands.describeCreationProjects).mockResolvedValue({
    status: 'ok',
    data: [{ path: '/replacement', project: next.project, error: null }],
  })
  vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: next,
  })
  vi.mocked(confirm).mockReset().mockResolvedValue(true)
  render(<CreationView />)
  await userEvent.click(nav().getByRole('button', { name: 'Terminal' }))
  await waitFor(() => expect(finishOpen).toBeDefined())
  await userEvent.click(
    screen.getByRole('button', { name: 'Switch to another project' })
  )
  await userEvent.click(
    await screen.findByRole('menuitem', { name: 'Replacement' })
  )
  await waitFor(() => expect(confirm).toHaveBeenCalled())
  expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
  expect(commands.commitCreationProject).not.toHaveBeenCalled()
  expect(useCreationStore.getState().workspace?.project.identity).toBe(
    'terminal-project'
  )
  await act(async () =>
    finishOpen({
      status: 'ok',
      data: {
        id: 'delayed-native',
        identity: 'terminal-project',
        state: 'running',
        exitCode: null,
      },
    })
  )
  await waitFor(() =>
    expect(useCreationStore.getState().workspace?.project.identity).toBe(
      'replacement-project'
    )
  )
  expect(commands.closeProjectTerminal).toHaveBeenCalledWith(
    'terminal-project',
    'delayed-native'
  )
  expect(
    vi.mocked(commands.closeProjectTerminal).mock.invocationCallOrder[0]
  ).toBeLessThan(
    vi.mocked(commands.commitCreationProject).mock.invocationCallOrder[0] ?? 0
  )
  expect(commands.openProjectTerminal).toHaveBeenCalledTimes(1)
})
