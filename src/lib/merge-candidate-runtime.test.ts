import { beforeEach, expect, it, vi } from 'vitest'
import {
  commands,
  type CreationRuntime,
  type Manifest,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { startMergeCandidateTest, stopMergeCandidateTest } from './session-flow'

const candidate = {
  identity: 'merge-workspace',
  id: 'candidate',
  revision: 2,
  projectRoot: '/score',
  canTest: true,
  fast: false,
}
const manifest: Manifest = {
  schemaVersion: 1,
  id: 'sample',
  name: 'Sample',
  version: '1.0.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'none',
    supportedModes: ['none', 'internal', 'external'],
    synthdefs: [],
    standaloneTarget: '127.0.0.1:57110',
    scsynth: { blockSize: 64, audioBusChannels: 128 },
  },
}
let idle: CreationRuntime
let started: CreationRuntime

beforeEach(async () => {
  vi.clearAllMocks()
  const base = await commands.getSessionState()
  if (base.status === 'error') throw new Error(base.error)
  idle = {
    generation: '10',
    projectRoot: null,
    snapshot: { ...base.data, status: 'idle', projectPath: null },
  }
  const owner = {
    identity: candidate.identity,
    candidateId: candidate.id,
    revision: candidate.revision,
    projectRoot: '/score',
    executionPath: '/private/candidate/project',
    generation: '11',
  }
  started = {
    generation: '11',
    projectRoot: '/score',
    merge: owner,
    snapshot: {
      ...base.data,
      status: 'starting',
      projectPath: owner.executionPath,
      audioMode: 'none',
      lanIp: '192.168.1.20',
    },
  }
  Object.assign(commands, {
    getMergeCandidateManifest: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: manifest }),
    preflightMergeCandidate: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: manifest }),
    startMergeCandidateRuntime: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: started }),
    getMergeCandidateRuntime: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: started }),
    stopMergeCandidateRuntime: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: idle }),
  })
  vi.mocked(commands.getCreationRuntime).mockResolvedValue({
    status: 'ok',
    data: idle,
  })
  vi.mocked(commands.stopProjectGeneration).mockResolvedValue({
    status: 'ok',
    data: true,
  })
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    active: true,
    opening: false,
    modePhase: 'idle',
    runtimeProject: null,
    workspace: {
      project: {
        identity: candidate.identity,
        root: '/score',
        name: 'Sample',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationTestStore.getState().setMergeCandidatePreparation(null)
  useCreationTestStore.setState({
    manifest,
    initialized: true,
    audioMode: 'none',
    oscTarget: '127.0.0.1:57110',
  })
  useProjectStore.setState({
    currentProject: { path: '/score', manifest },
    preflightStatus: 'ready',
  })
  useSessionStore.getState().resetSession()
  useSessionStore.setState({ lanIp: '192.168.1.20', commandPending: false })
  useSettingsStore.setState({ httpsEnabledSetting: false })
})

it('does not reload candidate metadata for permission-only busy or ownership changes', async () => {
  useCreationTestStore.getState().configureMergeCandidate(candidate)
  await vi.waitFor(() =>
    expect(commands.getMergeCandidateManifest).toHaveBeenCalledOnce()
  )
  useCreationTestStore
    .getState()
    .configureMergeCandidate({ ...candidate, canTest: false })
  useCreationTestStore.getState().configureMergeCandidate(candidate)
  expect(commands.getMergeCandidateManifest).toHaveBeenCalledOnce()
})

it('defers changed candidate metadata until manual access returns and preserves the last manifest', async () => {
  const blocked = { ...candidate, canTest: false }
  useCreationTestStore.getState().configureMergeCandidate(blocked)
  await useCreationTestStore.getState().loadManifest()
  useCreationTestStore
    .getState()
    .configureMergeCandidate({ ...blocked, revision: 3 })
  expect(commands.getMergeCandidateManifest).not.toHaveBeenCalled()
  expect(useCreationTestStore.getState().manifest).toBe(manifest)

  useCreationTestStore
    .getState()
    .configureMergeCandidate({ ...candidate, revision: 3 })
  await vi.waitFor(() =>
    expect(commands.getMergeCandidateManifest).toHaveBeenCalledExactlyOnceWith(
      candidate.identity,
      candidate.id,
      3
    )
  )
})

it('keeps previous metadata and the runtime error when a background candidate read is refused', async () => {
  vi.mocked(commands.getMergeCandidateManifest).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'runtimeBusy', detail: 'Candidate writer is active' },
  })
  useCreationTestStore.setState({ error: 'Previous test error' })
  useCreationTestStore.getState().configureMergeCandidate(candidate)
  await vi.waitFor(() =>
    expect(commands.getMergeCandidateManifest).toHaveBeenCalledOnce()
  )
  expect(useCreationTestStore.getState()).toMatchObject({
    manifest,
    loading: false,
    error: 'Previous test error',
  })
})

it('starts the native saved candidate without selecting its temporary directory as the project', async () => {
  const selected = useProjectStore.getState().currentProject
  await startMergeCandidateTest(
    candidate,
    { audioMode: 'none', oscTarget: '' },
    () => true
  )
  expect(commands.startMergeCandidateRuntime).toHaveBeenCalledWith(
    candidate.identity,
    candidate.id,
    2,
    'none',
    '192.168.1.20',
    null
  )
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(useProjectStore.getState().currentProject).toBe(selected)
  expect(useCreationStore.getState().workspace?.project.root).toBe('/score')
  expect(useCreationStore.getState().runtimeProject).toMatchObject({
    root: '/score',
    path: '/private/candidate/project',
    merge: { candidateId: candidate.id, revision: 2 },
  })
  expect(useCreationTestStore.getState().mergeRuntime).toEqual(started.merge)
})

it('flushes the candidate through its registered preparation before capturing the tested revision', async () => {
  useCreationTestStore.getState().configureMergeCandidate(candidate)
  const owner = started.merge
  if (!owner) throw new Error('Expected candidate runtime owner')
  const prepare = vi.fn(async () => {
    useCreationTestStore
      .getState()
      .configureMergeCandidate({ ...candidate, revision: 3 })
    vi.mocked(commands.startMergeCandidateRuntime).mockResolvedValue({
      status: 'ok',
      data: { ...started, merge: { ...owner, revision: 3 } },
    })
  })
  useCreationTestStore.getState().setMergeCandidatePreparation(prepare)
  await useCreationTestStore.getState().run()
  expect(prepare).toHaveBeenCalledOnce()
  expect(commands.preflightMergeCandidate).toHaveBeenCalledWith(
    candidate.identity,
    candidate.id,
    3
  )
  expect(useCreationTestStore.getState().mergeRuntime?.revision).toBe(3)
})

it('does not stop or start a runtime when candidate preflight fails', async () => {
  vi.mocked(commands.preflightMergeCandidate).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'testValidation', detail: 'Dependency is unavailable' },
  })
  await expect(
    startMergeCandidateTest(
      candidate,
      { audioMode: 'none', oscTarget: '' },
      () => true
    )
  ).rejects.toMatchObject({ code: 'testValidation' })
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startMergeCandidateRuntime).not.toHaveBeenCalled()
})

it('stops only the original generation the user saw before starting the candidate', async () => {
  useSessionStore.getState().applySnapshot({
    ...idle.snapshot,
    status: 'ready',
    projectPath: '/score',
    runtimeGeneration: '10',
  })
  await startMergeCandidateTest(
    candidate,
    { audioMode: 'none', oscTarget: '' },
    () => true
  )
  expect(commands.stopProjectGeneration).toHaveBeenCalledExactlyOnceWith('10')
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startMergeCandidateRuntime).toHaveBeenCalledOnce()
})

it('refuses to replace a runtime started by another window while candidate preflight was pending', async () => {
  useSessionStore.getState().applySnapshot({
    ...idle.snapshot,
    status: 'ready',
    projectPath: '/score',
    runtimeGeneration: '10',
  })
  vi.mocked(commands.stopProjectGeneration).mockResolvedValueOnce({
    status: 'ok',
    data: false,
  })
  await expect(
    startMergeCandidateTest(
      candidate,
      { audioMode: 'none', oscTarget: '' },
      () => true
    )
  ).rejects.toThrow()
  expect(commands.stopProjectGeneration).toHaveBeenCalledExactlyOnceWith('10')
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startMergeCandidateRuntime).not.toHaveBeenCalled()
  expect(commands.stopMergeCandidateRuntime).not.toHaveBeenCalled()
})

it('rejects a late preflight after the candidate owner changes', async () => {
  let resolve!: (
    value: Awaited<ReturnType<typeof commands.preflightMergeCandidate>>
  ) => void
  vi.mocked(commands.preflightMergeCandidate).mockReturnValueOnce(
    new Promise(done => {
      resolve = done
    })
  )
  let current = true
  const run = startMergeCandidateTest(
    candidate,
    { audioMode: 'none', oscTarget: '' },
    () => current
  )
  current = false
  resolve({ status: 'ok', data: manifest })
  expect(await run).toBeNull()
  expect(commands.startMergeCandidateRuntime).not.toHaveBeenCalled()
})

it('preserves an original runtime when cancelling a candidate that has not started a test', async () => {
  const original = {
    ...idle,
    projectRoot: '/score',
    snapshot: {
      ...idle.snapshot,
      status: 'ready' as const,
      projectPath: '/score',
    },
  }
  vi.mocked(commands.stopMergeCandidateRuntime).mockResolvedValueOnce({
    status: 'ok',
    data: original,
  })
  await stopMergeCandidateTest(candidate.identity, candidate.id)
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
  expect(useSessionStore.getState().sessionProjectPath).toBe('/score')
})

it('keeps the runtime ownership visible when native cleanup is not confirmed', async () => {
  useCreationTestStore.setState({ mergeRuntime: started.merge })
  vi.mocked(commands.stopMergeCandidateRuntime).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'runtimeBusy', detail: 'Cleanup not confirmed' },
  })
  await expect(
    stopMergeCandidateTest(candidate.identity, candidate.id)
  ).rejects.toMatchObject({ code: 'runtimeBusy' })
  expect(useCreationTestStore.getState().mergeRuntime).toEqual(started.merge)
})

it('keeps a failed candidate startup attributed to its saved copy and revision', async () => {
  vi.mocked(commands.startMergeCandidateRuntime).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'testStartup', detail: 'Health failed' },
  })
  vi.mocked(commands.getMergeCandidateRuntime).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...started,
      snapshot: {
        ...started.snapshot,
        status: 'error',
        error: 'Health failed',
      },
    },
  })
  await expect(
    startMergeCandidateTest(
      candidate,
      { audioMode: 'none', oscTarget: '' },
      () => true
    )
  ).rejects.toMatchObject({ code: 'testStartup' })
  expect(useCreationTestStore.getState().mergeRuntime?.revision).toBe(2)
  expect(useCreationStore.getState().runtimeProject?.path).toBe(
    '/private/candidate/project'
  )
  expect(useSessionStore.getState().sessionError).toBe('Health failed')
})
