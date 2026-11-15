import { emitTo, listen } from '@tauri-apps/api/event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { commands, type CreationWorkspace } from './tauri-bindings'
import {
  setupCreationConsoleWindowBridge,
  useCreationConsoleWindowStore,
} from './creation-console-window'

const workspace: CreationWorkspace = {
  project: {
    identity: 'score',
    name: 'Score',
    root: '/score',
    source: 'folder',
  },
  files: [],
}
let stopBridge: () => void

function receive(name: string, payload: unknown) {
  const registration = vi
    .mocked(listen)
    .mock.calls.find(call => call[0] === name)
  if (!registration) throw new Error(`Missing event listener for ${name}`)
  registration[1]({ event: name, id: 1, payload })
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    active: true,
    opening: false,
    modePhase: 'idle',
    workspace,
  })
  useCreationFilesStore.setState({
    pending: { compile: 1, refresh: 0, restart: 0 },
  })
  useCreationConsoleWindowStore.setState({ open: false })
  vi.spyOn(useCreationTestStore.getState(), 'readLog').mockResolvedValue(
    undefined
  )
  vi.spyOn(useCreationCompileStore.getState(), 'run').mockResolvedValue(
    undefined
  )
  stopBridge = setupCreationConsoleWindowBridge()
})

afterEach(() => {
  stopBridge()
  vi.restoreAllMocks()
})

it('sends current workspace facts to the native console and stops sending on native close', async () => {
  receive('creation-console:request', 'console-client')
  await vi.waitFor(() =>
    expect(emitTo).toHaveBeenLastCalledWith(
      'creation-console',
      'creation-console:snapshot',
      {
        client: 'console-client',
        snapshot: expect.objectContaining({
          identity: 'score',
          pending: { compile: 1, refresh: 0, restart: 0 },
        }),
      }
    )
  )
  expect(useCreationTestStore.getState().readLog).toHaveBeenCalledOnce()
  expect(useCreationConsoleWindowStore.getState().open).toBe(true)

  useCreationTestStore.setState({ log: ['[node] current project'] })
  await vi.waitFor(() =>
    expect(emitTo).toHaveBeenLastCalledWith(
      'creation-console',
      'creation-console:snapshot',
      {
        client: 'console-client',
        snapshot: expect.objectContaining({ log: ['[node] current project'] }),
      }
    )
  )

  receive('creation-console:closed', null)
  expect(useCreationConsoleWindowStore.getState().open).toBe(false)
  vi.mocked(emitTo).mockClear()
  useCreationTestStore.setState({ log: ['[node] after close'] })
  await Promise.resolve()
  expect(emitTo).not.toHaveBeenCalled()
})

it('accepts compile requests from the connected console only for the current project and closes it on switch', async () => {
  const compile = useCreationCompileStore.getState().run
  receive('creation-console:request', 'console-client')
  receive('creation-console:compile', { client: 'previous', identity: 'score' })
  receive('creation-console:compile', {
    client: 'console-client',
    identity: 'previous',
  })
  expect(compile).not.toHaveBeenCalled()
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
  receive('creation-console:compile', {
    client: 'console-client',
    identity: 'score',
  })
  expect(compile).toHaveBeenCalledOnce()

  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, identity: 'next', root: '/next' },
    },
  })
  receive('creation-console:compile', {
    client: 'console-client',
    identity: 'score',
  })
  expect(compile).toHaveBeenCalledOnce()
  expect(useCreationConsoleWindowStore.getState().open).toBe(false)
  await vi.waitFor(() =>
    expect(commands.closeCreationConsole).toHaveBeenCalledOnce()
  )
})
