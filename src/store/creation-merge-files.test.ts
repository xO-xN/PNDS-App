import { beforeEach, expect, it, vi } from 'vitest'
import type {
  CreationError,
  GitMergeCandidate,
  Result,
} from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import {
  isDraftDirty,
  selectUnsavedCount,
  useCreationFilesStore,
} from './creation-files-store'
import { useCreationMergeStore } from './creation-merge-store'

const boundary = vi.hoisted(() => ({
  getCreationGitMerge: vi.fn(),
  validateCreationGitMerge: vi.fn(),
  diagnoseMergeCandidate: vi.fn(),
  finishCreationGitMerge: vi.fn(),
  recoverCreationGitMerge: vi.fn(),
  readCreationFile: vi.fn(),
  pollCreationChanges: vi.fn(),
}))

vi.mock('@/lib/tauri-bindings', () => ({ commands: boundary }))
vi.mock('@/lib/preferences', () => ({
  loadPreferences: vi.fn().mockResolvedValue({ gitName: 'Artist' }),
}))
vi.mock('@/lib/notifications', () => ({
  notifications: {
    flow: {
      step: vi.fn(),
      fail: vi.fn(),
      dismiss: vi.fn(),
      succeed: vi.fn(),
      warn: vi.fn(),
    },
  },
}))
vi.mock('@/lib/creation-lifecycle', () => ({
  registerCreationParticipant: vi.fn(),
}))
vi.mock('@/lib/session-flow', () => ({
  stopMergeCandidateTest: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./creation-store', async () => {
  const { create } = await import('zustand')
  return {
    useCreationStore: create(() => ({ workspace: null })),
    creationTransportError: (error: unknown) => ({
      code: 'io',
      detail: String(error),
    }),
  }
})
vi.mock('./creation-test-store', () => ({
  useCreationTestStore: {
    getState: () => ({
      setMergeCandidatePreparation: vi.fn(),
      configureMergeCandidate: vi.fn(),
    }),
  },
}))
vi.mock('./creation-reading-store', () => ({
  useCreationReadingStore: {
    getState: () => ({
      gitChanged: vi.fn(),
      showGit: vi.fn(),
      syncWorkspace: vi.fn(),
    }),
  },
}))
vi.mock('./creation-handoff-store', () => ({
  useCreationHandoffStore: { getState: () => ({}) },
}))
vi.mock('./session-store', () => ({
  useSessionStore: {
    getState: () => ({ sessionStatus: 'idle', latestSnapshot: null, runId: 0 }),
  },
}))

function ok<T>(data: T): Result<T, CreationError> {
  return { status: 'ok', data }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
let native: GitMergeCandidate
beforeEach(async () => {
  vi.resetAllMocks()
  useCreationMergeStore.getState().clear()
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'project',
        root: '/project',
        name: 'Project',
        source: 'folder',
      },
      files: [{ path: 'a.js', kind: 'text', category: 'system', size: 5 }],
    },
  })
  native = {
    id: 'merge-one',
    revision: 1,
    relation: 'diverged',
    phase: 'active',
    source: 'source',
    target: 'target',
    base: 'base',
    branch: 'main',
    name: 'Merge source',
    files: [
      {
        path: 'a.js',
        version: 'missing',
        status: 'D',
        kind: 'text',
        conflict: null,
        resolved: true,
        current: true,
        incoming: false,
      },
    ],
    unresolved: 0,
    result: null,
    detail: null,
    assistantOwner: null,
    canUndo: false,
  }
  boundary.getCreationGitMerge.mockImplementation(async () => ok(native))
  boundary.validateCreationGitMerge.mockImplementation(async () => ok(native))
  boundary.diagnoseMergeCandidate.mockResolvedValue(ok({}))
  boundary.readCreationFile.mockResolvedValue(
    ok({ kind: 'text', text: 'saved source', version: 'old-version' })
  )
  await useCreationFilesStore.getState().read('project', 'a.js')
  await useCreationMergeStore.getState().load('project')
})

const publications = ['active', 'recovery'] as const
const replacements = ['missing', 'binary'] as const
const scenarios = publications.flatMap(phase =>
  replacements.flatMap(replacement =>
    [false, true].map(earlyPoll => ({ phase, replacement, earlyPoll }))
  )
)

it.each(scenarios)(
  'retires the saved editor copy after $phase publication to $replacement (early poll: $earlyPoll)',
  async ({ phase, replacement, earlyPoll }) => {
    native = { ...native, phase }
    const published = deferred<Result<GitMergeCandidate, CreationError>>()
    const command =
      phase === 'recovery'
        ? boundary.recoverCreationGitMerge
        : boundary.finishCreationGitMerge
    command.mockReturnValueOnce(published.promise)
    const finishing = useCreationMergeStore.getState().finish()
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce())
    boundary.readCreationFile.mockResolvedValue(
      replacement === 'missing'
        ? { status: 'error', error: { code: 'missing', detail: 'a.js' } }
        : ok({ kind: 'binary' })
    )
    boundary.pollCreationChanges.mockResolvedValue(
      ok({ files: [], changed: ['a.js'], revision: 1 })
    )
    if (earlyPoll) {
      await useCreationFilesStore.getState().poll()
      expect(selectUnsavedCount(useCreationFilesStore.getState())).toBe(1)
    }
    published.resolve(ok({ ...native, phase: 'completed', result: 'merged' }))
    await finishing
    expect(useCreationFilesStore.getState().drafts['a.js']).toBeUndefined()
    expect(selectUnsavedCount(useCreationFilesStore.getState())).toBe(0)
  }
)

it.each(
  publications.flatMap(phase =>
    [false, true].map(earlyPoll => ({ phase, earlyPoll }))
  )
)(
  'preserves newer editor input during $phase publication (early poll: $earlyPoll)',
  async ({ phase, earlyPoll }) => {
    native = { ...native, phase }
    const published = deferred<Result<GitMergeCandidate, CreationError>>()
    const command =
      phase === 'recovery'
        ? boundary.recoverCreationGitMerge
        : boundary.finishCreationGitMerge
    command.mockReturnValueOnce(published.promise)
    const finishing = useCreationMergeStore.getState().finish()
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce())
    boundary.readCreationFile.mockResolvedValue({
      status: 'error',
      error: { code: 'missing', detail: 'a.js' },
    })
    boundary.pollCreationChanges.mockResolvedValue(
      ok({ files: [], changed: ['a.js'], revision: 1 })
    )
    if (earlyPoll) await useCreationFilesStore.getState().poll()
    useCreationFilesStore.getState().edit('a.js', 'newer user input')
    published.resolve(ok({ ...native, phase: 'completed', result: 'merged' }))
    await finishing
    const draft = useCreationFilesStore.getState().drafts['a.js']
    expect(draft?.text).toBe('newer user input')
    expect(draft && isDraftDirty(draft)).toBe(true)
  }
)
