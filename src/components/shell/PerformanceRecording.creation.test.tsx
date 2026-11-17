import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test/test-utils'
import i18n from '@/i18n/config'
import {
  commands,
  type RecordingSnapshot,
  type SessionSnapshot,
} from '@/lib/tauri-bindings'
import * as recordingEvents from '@/lib/events'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { PerformanceRecording } from './PerformanceRecording'

vi.mock('@/lib/notifications', () => ({
  notifications: {
    flow: {
      step: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      dismiss: vi.fn(),
    },
  },
}))

function recording(values: Partial<RecordingSnapshot> = {}): RecordingSnapshot {
  return {
    revision: 1,
    operationId: null,
    recordId: null,
    projectPath: null,
    status: 'idle',
    elapsedMs: 0,
    durationMs: null,
    error: null,
    supported: false,
    ...values,
  }
}

function workspace(root = '/creation-score', identity = 'creation-one') {
  useCreationStore.setState({
    active: true,
    modePhase: 'idle',
    opening: false,
    workspace: {
      project: { root, identity, name: 'Creation score', source: 'folder' },
      files: [],
    },
  })
}

let session: SessionSnapshot
let nativeState: RecordingSnapshot
let publish: (snapshot: RecordingSnapshot) => void

function ready(root = '/creation-score') {
  useSessionStore.getState().applySnapshot({
    ...session,
    status: 'ready',
    projectPath: root,
    projectName: 'Creation score',
    audioMode: 'none',
  })
}

async function openPanel() {
  await userEvent.click(
    screen.getByRole('button', { name: 'Performance recordings' })
  )
}

function newRecording() {
  return screen.getByRole('button', { name: 'New recording' })
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  const result = await commands.getSessionState()
  if (result.status === 'error') throw new Error(result.error)
  session = result.data
  useCreationStore.setState({ active: false, workspace: null })
  useSessionStore.getState().resetSession()
  useProjectStore.setState({ currentProject: null })
  workspace()
  nativeState = recording()
  vi.mocked(commands.getRecordingState).mockImplementation(async () => ({
    status: 'ok',
    data: nativeState,
  }))
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  vi.mocked(commands.beginPerformanceRecording).mockResolvedValue({
    status: 'ok',
    data: recording({
      revision: 4,
      supported: true,
      status: 'recording',
      operationId: 'new-operation',
      recordId: 'new-record',
      projectPath: '/creation-score',
    }),
  })
  vi.spyOn(recordingEvents, 'onRecordingSnapshot').mockImplementation(
    callback => {
      publish = callback
      return () => undefined
    }
  )
})

it('starts a new recording for a ready creation test through the shared session and native workspace identity', async () => {
  ready()
  nativeState = recording({ supported: true })
  expect(useCreationTestStore.getState().hasSuccessfulTest).toBe(true)
  render(<PerformanceRecording />)
  await openPanel()
  expect(newRecording()).toBeEnabled()
  await userEvent.click(newRecording())
  expect(commands.beginPerformanceRecording).toHaveBeenCalledExactlyOnceWith(
    'recording',
    null,
    null,
    true,
    'creation-one'
  )
})

it('keeps a merely opened creation workspace disabled before its test runtime starts', async () => {
  expect(useSessionStore.getState().sessionStatus).toBe('idle')
  expect(useCreationTestStore.getState().hasSuccessfulTest).toBe(false)
  render(<PerformanceRecording />)
  await openPanel()
  expect(newRecording()).toBeDisabled()
  await userEvent.click(newRecording())
  expect(commands.beginPerformanceRecording).not.toHaveBeenCalled()
})

it('enables recording when a started creation test receives the native recording-support event', async () => {
  render(<PerformanceRecording />)
  await openPanel()
  expect(newRecording()).toBeDisabled()
  act(() =>
    useSessionStore.getState().applySnapshot({
      ...session,
      status: 'starting',
      projectPath: '/creation-score',
    })
  )
  expect(newRecording()).toBeDisabled()
  act(() => ready())
  act(() => {
    nativeState = recording({ revision: 2, supported: true })
    publish(nativeState)
  })
  expect(newRecording()).toBeEnabled()
})

it('recovers a missed capability event by reading the current native state when the ready creation panel opens', async () => {
  render(<PerformanceRecording />)
  await act(async () => undefined)
  expect(commands.getRecordingState).toHaveBeenCalledOnce()
  act(() => ready())
  // The driver has already changed its fact, but the WebView missed that event.
  nativeState = recording({ revision: 2, supported: true })
  await openPanel()
  await waitFor(() => expect(newRecording()).toBeEnabled(), { timeout: 200 })
  await userEvent.click(newRecording())
  expect(commands.beginPerformanceRecording).toHaveBeenCalledOnce()
})

it('does not enable a ready creation runtime when the latest native fact is unsupported', async () => {
  ready()
  render(<PerformanceRecording />)
  await openPanel()
  expect(newRecording()).toBeDisabled()
  await userEvent.click(newRecording())
  expect(commands.beginPerformanceRecording).not.toHaveBeenCalled()
})

it('keeps a newer support event when an older mount-time read resolves later', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.getRecordingState>>
  ) => void
  vi.mocked(commands.getRecordingState).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  ready()
  render(<PerformanceRecording />)
  act(() => {
    nativeState = recording({ revision: 3, supported: true })
    publish(nativeState)
  })
  await openPanel()
  expect(newRecording()).toBeEnabled()
  await act(async () =>
    finish({ status: 'ok', data: recording({ revision: 1 }) })
  )
  expect(newRecording()).toBeEnabled()
})

it('does not unlock a replacement creation workspace from the previous workspace’s pending support read', async () => {
  let previous!: (
    result: Awaited<ReturnType<typeof commands.getRecordingState>>
  ) => void
  let current!: (
    result: Awaited<ReturnType<typeof commands.getRecordingState>>
  ) => void
  vi.mocked(commands.getRecordingState)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          previous = resolve
        })
    )
    .mockImplementation(
      () =>
        new Promise(resolve => {
          current = resolve
        })
    )
  ready()
  render(<PerformanceRecording />)
  act(() => {
    workspace('/replacement', 'creation-two')
    ready('/replacement')
  })
  await openPanel()
  await act(async () =>
    previous({
      status: 'ok',
      data: recording({ revision: 2, supported: true }),
    })
  )
  expect(newRecording()).toBeDisabled()
  if (current)
    await act(async () =>
      current({ status: 'ok', data: recording({ revision: 3 }) })
    )
  expect(newRecording()).toBeDisabled()
})

it.each([false, true])(
  'keeps a same-path replacement disabled until its own equal-revision read confirms supported=%s',
  async freshSupport => {
    ready()
    nativeState = recording({ revision: 1, supported: true })
    render(<PerformanceRecording />)
    await openPanel()
    await waitFor(() => expect(newRecording()).toBeEnabled())

    let settle: (
      result: Awaited<ReturnType<typeof commands.getRecordingState>>
    ) => void = () => {
      throw new Error('Replacement state read has not started')
    }
    const replacement = new Promise<
      Awaited<ReturnType<typeof commands.getRecordingState>>
    >(resolve => {
      settle = resolve
    })
    vi.mocked(commands.getRecordingState).mockReturnValueOnce(replacement)
    const readsBeforeReplacement = vi.mocked(commands.getRecordingState).mock
      .calls.length
    act(() => workspace('/creation-score', 'creation-two'))
    expect(newRecording()).toBeDisabled()
    await waitFor(() =>
      expect(
        vi.mocked(commands.getRecordingState).mock.calls.length
      ).toBeGreaterThan(readsBeforeReplacement)
    )
    expect(newRecording()).toBeDisabled()
    // Workspace identity changes need not advance the native driver's revision.
    nativeState = recording({ revision: 1, supported: freshSupport })
    await act(async () => settle({ status: 'ok', data: nativeState }))
    if (freshSupport) {
      expect(newRecording()).toBeEnabled()
      await userEvent.click(newRecording())
      expect(
        commands.beginPerformanceRecording
      ).toHaveBeenCalledExactlyOnceWith(
        'recording',
        null,
        null,
        true,
        'creation-two'
      )
    } else {
      expect(newRecording()).toBeDisabled()
      await userEvent.click(newRecording())
      expect(commands.beginPerformanceRecording).not.toHaveBeenCalled()
    }
  }
)

it('refreshes native support when an already open disabled creation panel becomes ready without an event', async () => {
  render(<PerformanceRecording />)
  await openPanel()
  expect(newRecording()).toBeDisabled()
  const readsBeforeReady = vi.mocked(commands.getRecordingState).mock.calls
    .length
  // Native capability is current; deliberately do not publish a support event.
  nativeState = recording({ revision: 2, supported: true })
  act(() => ready())
  await waitFor(() => expect(newRecording()).toBeEnabled())
  expect(
    vi.mocked(commands.getRecordingState).mock.calls.length
  ).toBeGreaterThan(readsBeforeReady)
  await userEvent.click(newRecording())
  expect(commands.beginPerformanceRecording).toHaveBeenCalledExactlyOnceWith(
    'recording',
    null,
    null,
    true,
    'creation-one'
  )
})

it.each([false, true])(
  'requires fresh recording support after restarting the same creation runtime (supported=%s)',
  async freshSupport => {
    const applyRuntime = (
      status: SessionSnapshot['status'],
      runtimeGeneration: string
    ) =>
      useSessionStore.getState().applySnapshot({
        ...session,
        status,
        runtimeGeneration,
        projectPath: status === 'idle' ? null : '/creation-score',
        projectName: 'Creation score',
        audioMode: 'none',
      })
    applyRuntime('ready', 'runtime-old')
    nativeState = recording({ revision: 1, supported: true })
    render(<PerformanceRecording />)
    await openPanel()
    await waitFor(() => expect(newRecording()).toBeEnabled())

    let settle!: (
      result: Awaited<ReturnType<typeof commands.getRecordingState>>
    ) => void
    vi.mocked(commands.getRecordingState).mockReturnValueOnce(
      new Promise(resolve => {
        settle = resolve
      })
    )
    const readsBeforeRestart = vi.mocked(commands.getRecordingState).mock.calls
      .length
    act(() => applyRuntime('idle', 'runtime-old'))
    act(() => applyRuntime('starting', 'runtime-new'))
    expect(newRecording()).toBeDisabled()
    // The same project and workspace restarted; deliberately publish no support event.
    act(() => applyRuntime('ready', 'runtime-new'))
    expect(newRecording()).toBeDisabled()
    await waitFor(() =>
      expect(
        vi.mocked(commands.getRecordingState).mock.calls.length
      ).toBeGreaterThan(readsBeforeRestart)
    )
    await act(async () =>
      settle({
        status: 'ok',
        data: recording({
          revision: freshSupport ? 1 : 2,
          supported: freshSupport,
        }),
      })
    )
    if (freshSupport) {
      await waitFor(() => expect(newRecording()).toBeEnabled())
      await userEvent.click(newRecording())
      expect(
        commands.beginPerformanceRecording
      ).toHaveBeenCalledExactlyOnceWith(
        'recording',
        null,
        null,
        true,
        'creation-one'
      )
    } else {
      expect(newRecording()).toBeDisabled()
      await userEvent.click(newRecording())
      expect(commands.beginPerformanceRecording).not.toHaveBeenCalled()
    }
  }
)
