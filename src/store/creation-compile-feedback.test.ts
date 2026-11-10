import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { notifications } from '@/lib/notifications'
import {
  commands,
  type CreationWorkspace,
  type SynthdefCompileReport,
} from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useCreationFilesStore } from './creation-files-store'
import { useCreationCompileStore } from './creation-compile-store'
import { useCreationTestStore } from './creation-test-store'
import { useSessionStore } from './session-store'

const source = 'supercollider/source/voice.scd'
const workspace: CreationWorkspace = {
  project: {
    identity: 'compile-feedback',
    root: '/compile-feedback',
    name: 'Compile feedback',
    source: 'folder',
  },
  files: [{ path: source, kind: 'text', category: 'audio', size: 24 }],
}
const report: SynthdefCompileReport = {
  sclangPath: '/sclang',
  produced: ['supercollider/synthdefs/voice.scsyndef'],
  references: [],
  output: 'wrote voice.scsyndef',
  error: null,
}
const scanned = () => ({
  status: 'ok' as const,
  data: { files: workspace.files, changed: [], revision: 0 },
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const toastId = `creation-compile:${workspace.project.identity}`

beforeEach(() => {
  vi.clearAllMocks()
  for (const method of ['step', 'succeed', 'fail', 'warn', 'dismiss'] as const)
    vi.spyOn(notifications.flow, method).mockImplementation(() => undefined)
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({ active: true, workspace })
  useCreationFilesStore.setState({
    revision: 1,
    diskRevision: 0,
    drafts: {},
    pending: { compile: 1, refresh: 0, restart: 0 },
    error: null,
  })
  useCreationCompileStore.setState({ busy: false, report: null, error: null })
  useCreationTestStore.setState({ tab: 'file' })
  useSessionStore.setState({
    commandPending: false,
    sessionStatus: 'ready',
    sessionProjectPath: workspace.project.root,
  })
  vi.mocked(commands.pollCreationChanges)
    .mockReset()
    .mockImplementation(async () => scanned())
  vi.mocked(commands.compileCreationSynthdefs)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: report })
})
afterEach(() => vi.restoreAllMocks())

it('keeps compilation pending until its actual report and resolves the same notification without changing the runtime', async () => {
  const native =
    deferred<Awaited<ReturnType<typeof commands.compileCreationSynthdefs>>>()
  vi.mocked(commands.compileCreationSynthdefs).mockReturnValueOnce(
    native.promise
  )
  const operation = useCreationCompileStore.getState().run()
  await vi.waitFor(() =>
    expect(commands.compileCreationSynthdefs).toHaveBeenCalledTimes(1)
  )
  expect(notifications.flow.step).toHaveBeenCalledWith(
    toastId,
    i18n.t('creation.compile.busy')
  )
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(
    `creation-compile-pending:${workspace.project.identity}`
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(useCreationCompileStore.getState().busy).toBe(true)
  native.resolve({ status: 'ok', data: report })
  await operation

  expect(notifications.flow.succeed).toHaveBeenCalledWith(
    toastId,
    i18n.t('creation.compile.succeeded'),
    i18n.t('creation.compile.restart')
  )
  expect(notifications.flow.fail).not.toHaveBeenCalled()
  expect(useCreationCompileStore.getState().report).toEqual(report)
  expect(useCreationCompileStore.getState().busy).toBe(false)
  expect(useCreationFilesStore.getState().pending.compile).toBe(0)
  expect(useCreationFilesStore.getState().pending.restart).toBeGreaterThan(0)
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('preserves source changes observed during compilation and reports that another compilation remains pending', async () => {
  const native =
    deferred<Awaited<ReturnType<typeof commands.compileCreationSynthdefs>>>()
  vi.mocked(commands.compileCreationSynthdefs).mockReturnValueOnce(
    native.promise
  )
  const operation = useCreationCompileStore.getState().run()
  await vi.waitFor(() =>
    expect(commands.compileCreationSynthdefs).toHaveBeenCalledTimes(1)
  )
  useCreationFilesStore.getState().changed([source])
  const newer = useCreationFilesStore.getState().pending.compile
  expect(newer).toBeGreaterThan(1)
  native.resolve({ status: 'ok', data: report })
  await operation

  expect(useCreationFilesStore.getState().pending.compile).toBe(newer)
  expect(notifications.flow.succeed).toHaveBeenCalledWith(
    toastId,
    i18n.t('creation.compile.succeeded'),
    i18n.t('creation.compile.newerChanges')
  )
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it.each(['draft', 'runtime'] as const)(
  'ends waiting as a failure when %s becomes blocked while capture is pending',
  async blocker => {
    const scan =
      deferred<Awaited<ReturnType<typeof commands.pollCreationChanges>>>()
    vi.mocked(commands.pollCreationChanges).mockReturnValueOnce(scan.promise)
    const operation = useCreationCompileStore.getState().run()
    await vi.waitFor(() =>
      expect(commands.pollCreationChanges).toHaveBeenCalledTimes(1)
    )
    if (blocker === 'draft')
      useCreationFilesStore.setState({
        drafts: {
          [source]: {
            text: '// newer draft',
            diskText: '// saved',
            diskVersion: 'v1',
            conflict: null,
            saving: false,
            renaming: false,
            diskChanged: false,
            error: null,
          },
        },
      })
    else useSessionStore.setState({ commandPending: true })
    scan.resolve(scanned())
    await operation

    expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
    expect(notifications.flow.fail).toHaveBeenCalledWith(
      toastId,
      i18n.t('creation.compile.failed'),
      expect.stringContaining(
        blocker === 'draft' ? source : i18n.t('creation.compile.runtimeBusy')
      )
    )
    expect(notifications.flow.succeed).not.toHaveBeenCalled()
    expect(useCreationCompileStore.getState().busy).toBe(false)
    expect(useCreationFilesStore.getState().pending.compile).toBe(1)
    expect(commands.startCreationProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  }
)

it('retains pending compilation and resolves as failure when the native report has an error', async () => {
  const failed = { ...report, error: 'Missing declared SynthDef' }
  vi.mocked(commands.compileCreationSynthdefs).mockResolvedValueOnce({
    status: 'ok',
    data: failed,
  })
  await useCreationCompileStore.getState().run()

  expect(notifications.flow.fail).toHaveBeenCalledWith(
    toastId,
    i18n.t('creation.compile.failed'),
    failed.error
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(useCreationCompileStore.getState().report).toEqual(failed)
  expect(useCreationFilesStore.getState().pending.compile).toBe(1)
  expect(useCreationCompileStore.getState().busy).toBe(false)
})

it('ends a rejected native request as failure and retains the source pending state', async () => {
  vi.mocked(commands.compileCreationSynthdefs).mockRejectedValueOnce(
    new Error('Compiler transport unavailable')
  )
  await useCreationCompileStore.getState().run()

  expect(notifications.flow.fail).toHaveBeenCalledWith(
    toastId,
    i18n.t('creation.compile.failed'),
    expect.stringContaining('Compiler transport unavailable')
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(useCreationCompileStore.getState().report).toBeNull()
  expect(useCreationFilesStore.getState().pending.compile).toBe(1)
  expect(useCreationCompileStore.getState().busy).toBe(false)
})

it('retains a successful compilation when file refresh fails and retries only synchronization', async () => {
  vi.mocked(commands.pollCreationChanges)
    .mockResolvedValueOnce(scanned())
    .mockRejectedValueOnce(new Error('File watcher transport unavailable'))
  await useCreationCompileStore.getState().run()

  expect(notifications.flow.warn).toHaveBeenCalledWith(
    toastId,
    i18n.t('creation.compile.succeeded'),
    i18n.t('creation.compile.refreshPending')
  )
  expect(notifications.flow.fail).not.toHaveBeenCalled()
  expect(useCreationCompileStore.getState().report).toEqual(report)
  expect(useCreationCompileStore.getState().error).toBeNull()
  expect(useCreationFilesStore.getState().pending.compile).toBe(0)
  expect(useCreationCompileStore.getState().busy).toBe(false)
  expect(await useCreationFilesStore.getState().poll()).toBe(true)
  expect(commands.compileCreationSynthdefs).toHaveBeenCalledTimes(1)
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it.each(['replace', 'reopen'] as const)(
  'dismisses the old operation and rejects its result after a workspace %s',
  async transition => {
    const native =
      deferred<Awaited<ReturnType<typeof commands.compileCreationSynthdefs>>>()
    vi.mocked(commands.compileCreationSynthdefs).mockReturnValueOnce(
      native.promise
    )
    const operation = useCreationCompileStore.getState().run()
    await vi.waitFor(() =>
      expect(commands.compileCreationSynthdefs).toHaveBeenCalledTimes(1)
    )
    const polls = vi.mocked(commands.pollCreationChanges).mock.calls.length
    useCreationStore.setState({ workspace: null })
    useCreationStore.setState({
      workspace:
        transition === 'reopen'
          ? workspace
          : {
              ...workspace,
              project: {
                ...workspace.project,
                identity: 'another-workspace',
                root: '/another-workspace',
              },
            },
    })
    useCreationFilesStore.setState({
      pending: { compile: 99, refresh: 0, restart: 0 },
    })
    expect(notifications.flow.dismiss).toHaveBeenCalledWith(toastId)
    native.resolve({ status: 'ok', data: report })
    await operation

    expect(notifications.flow.succeed).not.toHaveBeenCalled()
    expect(notifications.flow.fail).not.toHaveBeenCalled()
    expect(useCreationCompileStore.getState().report).toBeNull()
    expect(useCreationCompileStore.getState().error).toBeNull()
    expect(useCreationCompileStore.getState().busy).toBe(false)
    expect(useCreationFilesStore.getState().pending).toEqual({
      compile: 99,
      refresh: 0,
      restart: 0,
    })
    expect(commands.pollCreationChanges).toHaveBeenCalledTimes(polls)
  }
)
