import { beforeEach, expect, it, vi } from 'vitest'
import type {
  CreationError,
  GitMergeCandidate,
  GitMergeContent,
  Result,
} from '@/lib/tauri-bindings'
import type { CreationParticipant } from '@/lib/creation-lifecycle'
import type { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import {
  registerMergeAssistantStop,
  useCreationMergeStore,
} from './creation-merge-store'

const boundary = vi.hoisted(() => ({
  commands: {
    getCreationGitMerge: vi.fn(),
    prepareCreationGitMerge: vi.fn(),
    getCreationGitMergeFile: vi.fn(),
    saveCreationGitMergeText: vi.fn(),
    chooseCreationGitMergeFile: vi.fn(),
    renameCreationGitMerge: vi.fn(),
    resumeCreationGitMerge: vi.fn(),
    pauseCreationGitMerge: vi.fn(),
    reprepareCreationGitMerge: vi.fn(),
    cancelCreationGitMerge: vi.fn(),
    validateCreationGitMerge: vi.fn(),
    finishCreationGitMerge: vi.fn(),
    recoverCreationGitMerge: vi.fn(),
    diagnoseMergeCandidate: vi.fn(),
    stopProjectGeneration: vi.fn(),
    saveCreationFile: vi.fn(),
  },
  stopTest: vi.fn(),
  configureTest: vi.fn(),
  setPreparation: vi.fn(),
  gitChanged: vi.fn(),
  showGit: vi.fn(),
  synchronize: vi.fn(),
  discardCheckoutCopies: vi.fn(),
  flow: {
    step: vi.fn(),
    fail: vi.fn(),
    dismiss: vi.fn(),
    succeed: vi.fn(),
    warn: vi.fn(),
  },
  participant: null as CreationParticipant | null,
}))

vi.mock('@/lib/tauri-bindings', () => ({ commands: boundary.commands }))
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }))
vi.mock('@/lib/preferences', () => ({
  loadPreferences: vi.fn().mockResolvedValue({
    gitName: 'Artist',
    gitEmail: 'artist@example.test',
  }),
}))
vi.mock('@/lib/notifications', () => ({
  notifications: { flow: boundary.flow },
}))
vi.mock('@/lib/creation-lifecycle', () => ({
  registerCreationParticipant: (participant: CreationParticipant) => {
    boundary.participant = participant
  },
}))
vi.mock('@/lib/session-flow', () => ({
  stopMergeCandidateTest: boundary.stopTest,
}))
vi.mock('./creation-store', async () => {
  const { create } = await import('zustand')
  return {
    useCreationStore: create(() => ({ workspace: null })),
    creationTransportError: (error: unknown) =>
      error && typeof error === 'object' && 'detail' in error
        ? error
        : { code: 'io', detail: String(error) },
  }
})
vi.mock('./creation-test-store', () => ({
  useCreationTestStore: {
    getState: () => ({
      setMergeCandidatePreparation: boundary.setPreparation,
      configureMergeCandidate: boundary.configureTest,
    }),
  },
}))
vi.mock('./creation-files-store', () => ({
  useCreationFilesStore: {
    getState: () => ({
      synchronizeSaved: boundary.synchronize,
      discardCheckoutCopies: boundary.discardCheckoutCopies,
    }),
  },
}))
vi.mock('./creation-reading-store', () => ({
  useCreationReadingStore: {
    getState: () => ({
      gitChanged: boundary.gitChanged,
      showGit: boundary.showGit,
    }),
  },
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
function fixture(revision = 1): GitMergeCandidate {
  return {
    id: 'merge-one',
    revision,
    relation: 'diverged',
    phase: 'active',
    source: 'source-commit',
    target: 'target-commit',
    base: 'base-commit',
    branch: 'main',
    name: 'Merge source',
    files: ['a.js', 'b.js'].map(path => ({
      path,
      version: `${path}-v1`,
      status: 'M',
      kind: 'text',
      conflict: null,
      resolved: true,
      current: true,
      incoming: true,
    })),
    unresolved: 0,
    result: null,
    detail: null,
    assistantOwner: null,
    canUndo: false,
  }
}
function content(path: string, version = `${path}-v1`): GitMergeContent {
  return {
    path,
    side: 'result',
    exists: true,
    version,
    text: `saved ${path}`,
    url: null,
    size: 10,
    mime: null,
    durationMs: null,
    sampleRate: null,
    channels: null,
    waveform: null,
  }
}
let native: GitMergeCandidate
function workspace(identity = 'project') {
  useCreationStore.setState({
    workspace: {
      project: {
        identity,
        root: `/${identity}`,
        name: identity,
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationMergeStore.getState().attach(identity)
}
async function start() {
  await useCreationMergeStore.getState().prepare(native.source, false)
}
async function draft(path: string, text: string) {
  await useCreationMergeStore.getState().read(path, 'result')
  useCreationMergeStore.getState().edit(path, text)
}

beforeEach(() => {
  vi.resetAllMocks()
  useCreationMergeStore.getState().clear()
  workspace()
  native = fixture()
  boundary.stopTest.mockResolvedValue(undefined)
  boundary.synchronize.mockResolvedValue(true)
  boundary.commands.getCreationGitMerge.mockImplementation(async () =>
    ok(native)
  )
  boundary.commands.prepareCreationGitMerge.mockImplementation(async () =>
    ok(native)
  )
  boundary.commands.getCreationGitMergeFile.mockImplementation(
    async (_identity, _candidate, path: string) => ok(content(path))
  )
  boundary.commands.validateCreationGitMerge.mockImplementation(async () =>
    ok(native)
  )
  boundary.commands.diagnoseMergeCandidate.mockResolvedValue({
    status: 'ok',
    data: { diagnostics: null, compileStatus: null, tests: null },
  })
})

it('keeps loaded content and editor history during a same-revision poll', async () => {
  await start()
  await draft('a.js', 'unsaved local candidate edit')
  const before = useCreationMergeStore.getState()
  const buffer = before.drafts['a.js']?.buffer
  await useCreationMergeStore.getState().refresh()
  expect(useCreationMergeStore.getState().contents).toBe(before.contents)
  expect(useCreationMergeStore.getState().drafts['a.js']).toMatchObject({
    text: 'unsaved local candidate edit',
    buffer,
  })
  native = { ...native, revision: 2 }
  await useCreationMergeStore.getState().refresh()
  expect(useCreationMergeStore.getState().contents).toEqual({})
  expect(useCreationMergeStore.getState().drafts['a.js']?.text).toBe(
    'unsaved local candidate edit'
  )
})

it('drops a delayed file read after its candidate revision changes', async () => {
  await start()
  const pending =
    deferred<Awaited<ReturnType<typeof commands.getCreationGitMergeFile>>>()
  boundary.commands.getCreationGitMergeFile.mockReturnValueOnce(pending.promise)
  const reading = useCreationMergeStore.getState().read('a.js', 'result')
  native = { ...native, revision: 2 }
  await useCreationMergeStore.getState().refresh()
  pending.resolve(ok(content('a.js')))
  expect(await reading).toBeNull()
  expect(useCreationMergeStore.getState().contents).toEqual({})
  expect(useCreationMergeStore.getState().drafts).toEqual({})
})

it('serializes multi-file saves with fresh candidate revisions and per-file CAS versions', async () => {
  await start()
  await draft('a.js', 'first edit')
  await draft('b.js', 'second edit')
  const first =
    deferred<Awaited<ReturnType<typeof commands.saveCreationGitMergeText>>>()
  boundary.commands.saveCreationGitMergeText
    .mockReturnValueOnce(first.promise)
    .mockImplementationOnce(async () => {
      native = {
        ...native,
        revision: 3,
        files: native.files.map(file =>
          file.path === 'b.js' ? { ...file, version: 'b.js-v2' } : file
        ),
      }
      return ok(native)
    })
  boundary.commands.getCreationGitMergeFile.mockImplementation(
    async (_identity, _candidate, path: string) =>
      ok(content(path, `${path}-v2`))
  )
  const saving = useCreationMergeStore.getState().saveAll()
  const queued = useCreationMergeStore.getState().rename('Reviewed merge')
  boundary.commands.renameCreationGitMerge.mockImplementation(async () =>
    ok(native)
  )
  await vi.waitFor(() =>
    expect(boundary.commands.saveCreationGitMergeText).toHaveBeenCalledTimes(1)
  )
  expect(boundary.commands.renameCreationGitMerge).not.toHaveBeenCalled()
  native = {
    ...native,
    revision: 2,
    files: native.files.map(file =>
      file.path === 'a.js' ? { ...file, version: 'a.js-v2' } : file
    ),
  }
  first.resolve(ok(native))
  await Promise.all([saving, queued])
  expect(boundary.commands.saveCreationGitMergeText.mock.calls).toEqual([
    ['project', native.id, 1, 'a.js', 'a.js-v1', 'first edit'],
    ['project', native.id, 2, 'b.js', 'b.js-v1', 'second edit'],
  ])
  expect(boundary.commands.renameCreationGitMerge).toHaveBeenCalledWith(
    'project',
    native.id,
    3,
    'Reviewed merge'
  )
  expect(useCreationMergeStore.getState().drafts['a.js']).toMatchObject({
    text: 'first edit',
    savedText: 'first edit',
    version: 'a.js-v2',
  })
  expect(boundary.commands.saveCreationFile).not.toHaveBeenCalled()
  expect(boundary.commands.finishCreationGitMerge).not.toHaveBeenCalled()
})

it('retains input delivered while an earlier candidate save is in flight', async () => {
  await start()
  await draft('a.js', 'captured edit')
  const pending =
    deferred<Awaited<ReturnType<typeof commands.saveCreationGitMergeText>>>()
  boundary.commands.saveCreationGitMergeText.mockReturnValueOnce(
    pending.promise
  )
  const saving = useCreationMergeStore.getState().saveAll()
  await vi.waitFor(() =>
    expect(boundary.commands.saveCreationGitMergeText).toHaveBeenCalled()
  )
  useCreationMergeStore.setState(state => {
    const value = state.drafts['a.js']
    if (!value) throw new Error('Expected loaded draft')
    return {
      drafts: { ...state.drafts, 'a.js': { ...value, text: 'later input' } },
    }
  })
  native = { ...native, revision: 2 }
  pending.resolve(ok(native))
  await saving
  expect(useCreationMergeStore.getState().drafts['a.js']).toMatchObject({
    text: 'later input',
    savedText: 'captured edit',
  })
})

it('ignores an old project save reply after ownership changes', async () => {
  await start()
  await draft('a.js', 'old project edit')
  const pending =
    deferred<Awaited<ReturnType<typeof commands.saveCreationGitMergeText>>>()
  boundary.commands.saveCreationGitMergeText.mockReturnValueOnce(
    pending.promise
  )
  const saving = useCreationMergeStore.getState().saveAll()
  const rejected = expect(saving).rejects.toThrow()
  await vi.waitFor(() =>
    expect(boundary.commands.saveCreationGitMergeText).toHaveBeenCalled()
  )
  workspace('next-project')
  pending.resolve(ok({ ...native, revision: 2 }))
  await rejected
  expect(useCreationMergeStore.getState()).toMatchObject({
    identity: 'next-project',
    candidate: null,
    drafts: {},
    error: null,
  })
  expect(boundary.commands.getCreationGitMergeFile).toHaveBeenCalledTimes(1)
})

it('preserves the candidate and drafts when candidate runtime cleanup cannot be confirmed', async () => {
  await start()
  await draft('a.js', 'keep this work')
  boundary.stopTest.mockRejectedValueOnce(new Error('cleanup unconfirmed'))
  await expect(useCreationMergeStore.getState().cancel()).rejects.toThrow(
    'cleanup unconfirmed'
  )
  expect(useCreationMergeStore.getState().candidate?.id).toBe(native.id)
  expect(useCreationMergeStore.getState().drafts['a.js']?.text).toBe(
    'keep this work'
  )
  expect(boundary.commands.cancelCreationGitMerge).not.toHaveBeenCalled()
  expect(boundary.gitChanged).not.toHaveBeenCalled()
})

it('retains ownership when native discard fails and only clears after successful discard', async () => {
  await start()
  boundary.commands.cancelCreationGitMerge.mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'private cleanup failed' },
  })
  await expect(useCreationMergeStore.getState().cancel()).rejects.toMatchObject(
    {
      detail: 'private cleanup failed',
    }
  )
  expect(useCreationMergeStore.getState().candidate?.id).toBe(native.id)
  boundary.commands.cancelCreationGitMerge.mockResolvedValueOnce(ok(null))
  await useCreationMergeStore.getState().cancel()
  expect(useCreationMergeStore.getState().candidate).toBeNull()
  expect(boundary.gitChanged).toHaveBeenCalledTimes(1)
})

it('requires optional-check approval for the exact revision and preserves completed warning receipts', async () => {
  await start()
  boundary.commands.diagnoseMergeCandidate.mockRejectedValue(
    new Error('checker unavailable')
  )
  await useCreationMergeStore.getState().finish()
  expect(useCreationMergeStore.getState().optionalApproval).toEqual({
    id: native.id,
    revision: 1,
  })
  expect(boundary.commands.finishCreationGitMerge).not.toHaveBeenCalled()
  native = { ...native, revision: 2 }
  await useCreationMergeStore.getState().finish()
  expect(useCreationMergeStore.getState().optionalApproval).toEqual({
    id: native.id,
    revision: 2,
  })
  expect(boundary.commands.finishCreationGitMerge).not.toHaveBeenCalled()
  boundary.commands.finishCreationGitMerge.mockImplementationOnce(async () => {
    native = {
      ...native,
      phase: 'completed',
      result: 'fixed-result',
      detail: 'GitHub backup will need retry',
    }
    return ok(native)
  })
  await useCreationMergeStore.getState().finish()
  expect(useCreationMergeStore.getState()).toMatchObject({
    candidate: null,
    completed: native,
    error: null,
  })
  expect(boundary.commands.finishCreationGitMerge).toHaveBeenCalledTimes(1)
  expect(boundary.flow.warn).toHaveBeenCalledWith(
    expect.any(String),
    'creation.merge.completed',
    'GitHub backup will need retry'
  )
  await expect(useCreationMergeStore.getState().finish()).rejects.toThrow()
  expect(boundary.commands.finishCreationGitMerge).toHaveBeenCalledTimes(1)
})

it('leaves a private candidate active when assistant stop fails during project cleanup', async () => {
  await start()
  const stop = vi
    .fn()
    .mockRejectedValue(new Error('assistant operation still running'))
  const unregister = registerMergeAssistantStop(stop)
  try {
    await expect(boundary.participant?.cleanup?.()).rejects.toThrow(
      'assistant operation still running'
    )
    expect(boundary.commands.pauseCreationGitMerge).not.toHaveBeenCalled()
    expect(boundary.stopTest).not.toHaveBeenCalled()
    expect(useCreationMergeStore.getState().candidate?.phase).toBe('active')
  } finally {
    unregister()
  }
})
