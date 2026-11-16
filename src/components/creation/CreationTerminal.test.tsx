import { confirm } from '@tauri-apps/plugin-dialog'
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
import { useSessionStore } from '@/store/session-store'
import {
  endCreationTerminal,
  useCreationTerminalStore,
} from '@/store/creation-terminal-store'
import { CreationModeButton } from './CreationModeButton'
import { CreationView } from './CreationView'

const drawing: { text: string; color: unknown }[] = []
type Read = Awaited<ReturnType<typeof commands.readProjectTerminal>>
let deliver: ((value: Read) => void) | undefined
let pendingClose:
  | ((value: Awaited<ReturnType<typeof commands.closeProjectTerminal>>) => void)
  | undefined
let sequence = 0
let session = 0
let themeCss = ''
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
  drawing.length = 0
  deliver = undefined
  pendingClose = undefined
  sequence = 0
  session = 0
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationFilesStore.getState().clear()
  useCreationTestStore.setState({ expanded: false })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useCreationStore.setState({
    active: true,
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
  pendingClose?.({ status: 'error', error: 'Fixture cleanup' })
  vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  await act(async () => {
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

it('labels a retained previous owner honestly instead of showing it as the replacement project terminal', async () => {
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
  expect(
    await screen.findByText(
      'A previous project terminal still owns managed jobs. End it before opening this terminal.'
    )
  ).toBeVisible()
  expect(screen.queryByText('Shell running')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'End terminal' }))
  expect(commands.closeProjectTerminal).toHaveBeenLastCalledWith(
    'terminal-project',
    'terminal-1'
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open terminal' })
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
