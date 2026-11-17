import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import type { GitMergeCandidate, GitMergeContent } from '@/lib/tauri-bindings'
import type { TextBuffer } from '@/lib/text-buffer'

const calls = vi.hoisted(() => ({
  get: vi.fn(),
  file: vi.fn(),
  save: vi.fn(),
  validate: vi.fn(),
  diagnose: vi.fn(),
  finish: vi.fn(),
  rename: vi.fn(),
  cancel: vi.fn(),
  showGit: vi.fn(),
  gitChanged: vi.fn(),
  showDiscussion: vi.fn(),
  configure: vi.fn(),
  preparation: vi.fn(),
  project: {
    identity: 'physical',
    root: '/fixture/score',
    name: 'Score',
    source: 'folder',
  },
  session: { sessionStatus: 'idle', latestSnapshot: null, runId: 0 },
}))
vi.mock('@/lib/tauri-bindings', () => ({
  commands: {
    getCreationGitMerge: calls.get,
    getCreationGitMergeFile: calls.file,
    saveCreationGitMergeText: calls.save,
    validateCreationGitMerge: calls.validate,
    diagnoseMergeCandidate: calls.diagnose,
    finishCreationGitMerge: calls.finish,
    renameCreationGitMerge: calls.rename,
    cancelCreationGitMerge: calls.cancel,
  },
}))
vi.mock('@/store/creation-store', () => ({
  useCreationStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({ workspace: { project: calls.project } }),
    {
      getState: () => ({ workspace: { project: calls.project } }),
      subscribe: () => () => undefined,
    }
  ),
  creationTransportError: (error: unknown) => ({
    code: 'Io',
    detail: String(error),
  }),
}))
vi.mock('@/store/creation-reading-store', () => ({
  useCreationReadingStore: {
    getState: () => ({
      showGit: calls.showGit,
      gitChanged: calls.gitChanged,
      showDiscussion: calls.showDiscussion,
    }),
  },
}))
vi.mock('@/store/creation-files-store', () => ({
  useCreationFilesStore: {
    getState: () => ({ synchronizeSaved: async () => true }),
  },
}))
vi.mock('@/store/creation-test-store', () => ({
  useCreationTestStore: {
    getState: () => ({
      configureMergeCandidate: calls.configure,
      setMergeCandidatePreparation: calls.preparation,
    }),
  },
}))
vi.mock('@/store/session-store', () => ({
  useSessionStore: Object.assign(
    (selector: (state: typeof calls.session) => unknown) =>
      selector(calls.session),
    { getState: () => calls.session }
  ),
}))
vi.mock('@/store/merge-assistant-store', () => ({
  useMergeAssistantStore: (selector: (state: { phase: string }) => unknown) =>
    selector({ phase: 'idle' }),
}))
vi.mock('@/lib/session-flow', () => ({
  stopMergeCandidateTest: async () => undefined,
}))
vi.mock('@/lib/preferences', () => ({
  loadPreferences: async () => ({ gitName: 'Creator', gitEmail: '' }),
}))
vi.mock('@/lib/notifications', () => ({
  notifications: {
    flow: {
      step: vi.fn(),
      succeed: vi.fn(),
      warn: vi.fn(),
      fail: vi.fn(),
      dismiss: vi.fn(),
    },
  },
}))
vi.mock('@/lib/creation-lifecycle', () => ({
  registerCreationParticipant: vi.fn(),
}))
vi.mock('./CreationGitGraph', () => ({
  CreationGitGraph: () => <div aria-label="Version graph" />,
}))
vi.mock('./CreationGitHubSync', () => ({
  CreationGitHubSync: () => <span>GitHub</span>,
}))
vi.mock('./CreationMergeMedia', () => ({
  CreationMergeMedia: () => <div aria-label="Binary comparison" />,
}))
vi.mock('./CreationGitDifference', () => ({
  CreationGitDifference: () => <div />,
}))
vi.mock('./CreationMergeCodeEditor', () => ({
  default: ({ readOnly }: { readOnly: boolean }) => (
    <textarea aria-label="Candidate editor" readOnly={readOnly} />
  ),
}))

import { useCreationMergeStore } from '@/store/creation-merge-store'
import {
  CreationMergeContext,
  CreationMergeWorkspace,
} from './CreationMergeWorkspace'

let server: GitMergeCandidate
let savedText: string
const content = (): GitMergeContent => ({
  path: 'sketch.js',
  side: 'result',
  exists: true,
  version: server.files[0]?.version ?? 'v1',
  text: savedText,
  url: null,
  size: savedText.length,
  mime: 'text/javascript',
  durationMs: null,
  sampleRate: null,
  channels: null,
  waveform: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  server = {
    id: 'merge-1',
    revision: 1,
    relation: 'diverged',
    phase: 'active',
    source: 'incoming-commit',
    target: 'current-commit',
    base: 'base-commit',
    branch: 'main',
    name: 'Merge rhythm',
    files: [
      {
        path: 'sketch.js',
        status: 'modified',
        kind: 'text',
        conflict: 'text',
        resolved: false,
        version: 'v1',
        current: true,
        incoming: true,
      },
    ],
    unresolved: 1,
    result: null,
    detail: null,
    assistantOwner: null,
    canUndo: false,
  }
  savedText = 'conflicting text'
  calls.get.mockImplementation(async () => ({ status: 'ok', data: server }))
  calls.file.mockImplementation(async () => ({
    status: 'ok',
    data: content(),
  }))
  calls.save.mockImplementation(
    async (
      _identity: string,
      _id: string,
      _revision: number,
      _path: string,
      _version: string,
      text: string
    ) => {
      savedText = text
      server = {
        ...server,
        revision: server.revision + 1,
        unresolved: 0,
        files: server.files.map(file => ({
          ...file,
          resolved: true,
          version: 'v2',
        })),
      }
      return { status: 'ok', data: server }
    }
  )
  calls.validate.mockImplementation(async () => ({
    status: 'ok',
    data: server,
  }))
  calls.diagnose.mockResolvedValue({
    status: 'ok',
    data: { diagnostics: { staticPassed: true } },
  })
  calls.finish.mockImplementation(async () => ({
    status: 'ok',
    data: { ...server, phase: 'completed', result: 'merged-commit' },
  }))
  calls.rename.mockImplementation(
    async (_identity: string, _id: string, _revision: number, name: string) => {
      server = { ...server, name, revision: server.revision + 1 }
      return { status: 'ok', data: server }
    }
  )
  calls.cancel.mockResolvedValue({ status: 'ok', data: null })
  useCreationMergeStore.getState().clear()
  useCreationMergeStore.getState().attach('physical')
  useCreationMergeStore.setState({
    candidate: server,
    selectedPath: 'sketch.js',
    drafts: {
      'sketch.js': {
        text: savedText,
        savedText,
        version: 'v1',
        buffer: {} as TextBuffer,
        editorRevision: 0,
      },
    },
    contents: { 'result:sketch.js': content() },
  })
})

const workspace = () =>
  render(
    <CreationMergeWorkspace graph={null} loading={false} onMore={vi.fn()} />
  )

it('keeps the borderless return control available outside the history tab', async () => {
  render(<CreationMergeContext />)
  const back = screen.getByRole('button', { name: 'Return to history' })
  expect(back.closest('header')).toHaveClass('creation-merge-context')
  expect(back.classList.contains('border')).toBe(false)
  expect(screen.queryByLabelText('Version graph')).not.toBeInTheDocument()
  fireEvent.click(back)
  await waitFor(() => expect(calls.showGit).toHaveBeenCalled())
  expect(calls.cancel).toHaveBeenCalledWith('physical', 'merge-1', 1)
  expect(useCreationMergeStore.getState().candidate).toBeNull()
})

it('blocks completion until a binary conflict has an explicit choice', () => {
  server = {
    ...server,
    files: server.files.map(file => ({
      ...file,
      path: 'cover.png',
      kind: 'image',
      conflict: 'binary',
    })),
  }
  useCreationMergeStore.setState({
    candidate: server,
    selectedPath: 'cover.png',
    drafts: {},
    contents: {},
  })
  workspace()
  expect(screen.getByRole('button', { name: 'Complete merge' })).toBeDisabled()
  expect(calls.finish).not.toHaveBeenCalled()
})

it('flushes an edited text conflict before validating and completing without per-file confirmation', async () => {
  useCreationMergeStore.getState().edit('sketch.js', 'resolved rhythm')
  workspace()
  const complete = screen.getByRole('button', { name: 'Complete merge' })
  expect(complete).toBeEnabled()
  fireEvent.click(complete)
  await waitFor(() => expect(calls.finish).toHaveBeenCalled())
  expect(calls.save).toHaveBeenCalledWith(
    'physical',
    'merge-1',
    1,
    'sketch.js',
    'v1',
    'resolved rhythm'
  )
  expect(calls.validate).toHaveBeenCalledWith('physical', 'merge-1', 2)
  expect(calls.finish).toHaveBeenCalledWith(
    'physical',
    'merge-1',
    2,
    'Creator',
    ''
  )
  expect(calls.save.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
    calls.validate.mock.invocationCallOrder[0] ?? -Infinity
  )
  expect(calls.validate.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
    calls.finish.mock.invocationCallOrder[0] ?? -Infinity
  )
  expect(useCreationMergeStore.getState().completed?.result).toBe(
    'merged-commit'
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('renames the candidate in place through its pencil without a dialog', async () => {
  workspace()
  fireEvent.click(screen.getByRole('button', { name: 'Rename merge' }))
  const name = screen.getByRole('textbox', { name: 'Version name' })
  expect(name).toHaveValue('Merge rhythm')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.change(name, { target: { value: '  Balanced rhythm  ' } })
  fireEvent.keyDown(name, { key: 'Enter' })
  await screen.findByText('Balanced rhythm')
  expect(calls.rename).toHaveBeenCalledTimes(1)
  expect(calls.rename).toHaveBeenCalledWith(
    'physical',
    'merge-1',
    1,
    'Balanced rhythm'
  )
  expect(
    screen.queryByRole('textbox', { name: 'Version name' })
  ).not.toBeInTheDocument()
})

it('shows an exact fast-forward candidate read-only and without a rename action', async () => {
  server = {
    ...server,
    relation: 'fastForward',
    unresolved: 0,
    files: server.files.map(file => ({
      ...file,
      conflict: null,
      resolved: true,
    })),
  }
  useCreationMergeStore.setState({ candidate: server })
  workspace()
  expect(
    await screen.findByRole('textbox', { name: 'Candidate editor' })
  ).toHaveAttribute('readonly')
  expect(
    screen.getByText('Use the existing version exactly. Read-only.')
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Rename merge' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Complete merge' })).toBeEnabled()
})
