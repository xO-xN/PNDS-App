import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantContinuation,
  type AssistantDependencies,
} from './assistant-flow'
import { beginAssistantTask } from './assistant-task-tools'
import {
  deserializeAssistantContinuation,
  serializeAssistantContinuation,
} from './assistant-resume'
import { HELP_BOOKS } from './help-corpus'
import {
  commands,
  type AssistantTask,
  type ControlledCheckReport,
} from './tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'

const task: AssistantTask = {
  id: '1700000000000000000-4242',
  mode: 'edit',
  files: [{ path: 'server.js', created: false, undone: false }],
}
const inventory = {
  fingerprint: 'saved-v1',
  files: [
    { path: 'server.js', version: 'v1', bytes: 20, reason: null },
    {
      path: 'tests/release.test.mjs',
      version: 'test-v1',
      bytes: 20,
      reason: null,
    },
  ],
}

function nativeReport(id: string, passed: boolean): ControlledCheckReport {
  return {
    schemaVersion: 1,
    checkerVersion: 'fixture',
    taskId: id,
    projectPath: '/score',
    mode: 'none',
    status: passed ? 'passed' : 'failed',
    error: passed ? null : 'The held voice ended before release',
    diagnostics: null,
    evidence: {
      sourceRoot: '/score',
      sourceIdentity: 'fixture-inode',
      sharedSourceRoot: null,
      projectSha256: 'saved-v1',
      sharedSha256: null,
      projectFiles: [],
      sharedFiles: [],
      productionDependencies: [],
      installedPackages: [],
      sharedLibraries: [],
      git: { head: null, dirty: null, state: 'none', detail: null },
      changedDuringPreparation: false,
      scope: 'saved',
      notes: [],
    },
    freshness: { stale: false, complete: true, reasons: [] },
    environment: {
      nodeBinary: '/offline/node',
      nodeVersion: null,
      outputDevice: null,
      sampleRate: null,
      channelPlan: null,
      oscTarget: null,
    },
    checks: [],
    health: null,
    outputTail: [],
    cleanup: {
      nodeConfirmed: true,
      audioConfirmed: true,
      temporaryFilesRemoved: true,
      errors: [],
    },
    unverified: ['sound'],
    ...(id.startsWith('node-tests-')
      ? {
          nodeTests: {
            entries: ['tests/release.test.mjs'],
            exitCode: passed ? 0 : 1,
          },
        }
      : {}),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'owner',
        root: '/score',
        name: 'Release fixture',
        source: 'folder',
      },
      files: [],
    },
  })
  useSessionStore.setState({ sessionStatus: 'idle', runId: 1 })
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValue({
    status: 'ok',
    data: task,
  })
  vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
    status: 'ok',
    data: inventory,
  })
  vi.mocked(commands.getAssistantBuildState).mockResolvedValue({
    status: 'ok',
    data: { needed: false, reason: null, receipt: null },
  })
  vi.mocked(commands.diagnoseCreationProject).mockResolvedValue({
    status: 'ok',
    data: {
      schemaVersion: 1,
      checkerVersion: 'fixture',
      projectPath: '/score',
      project: null,
      inputFingerprint: 'saved-v1',
      inputs: [],
      checks: [],
      issues: [],
      unverified: [],
      staticPassed: true,
    },
  })
  vi.mocked(commands.creationDiagnosticIsStale).mockResolvedValue({
    status: 'ok',
    data: false,
  })
  vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
    status: 'ok',
    data: false,
  })
  vi.mocked(commands.startAssistantTests).mockResolvedValue({
    status: 'ok',
    data: 'node-tests',
  })
  vi.mocked(commands.startAssistantCheck).mockResolvedValue({
    status: 'ok',
    data: 'smoke-check',
  })
})

afterEach(() => vi.restoreAllMocks())

it.each([
  { name: 'failed assertions', passed: false, expected: 'failed', runs: 1 },
  {
    name: 'passed assertions after a smoke check',
    passed: true,
    expected: 'passed',
    runs: 1,
  },
  {
    name: 'failed assertions across restart',
    passed: false,
    restart: true,
    expected: 'failed',
    runs: 1,
  },
  {
    name: 'passed assertions across restart',
    passed: true,
    restart: true,
    expected: 'passed',
    runs: 1,
  },
  {
    name: 'expired receipt',
    passed: true,
    freshness: 'stale',
    expected: 'passed',
    runs: 2,
  },
  {
    name: 'unavailable receipt across restart',
    passed: true,
    restart: true,
    freshness: 'unknown',
    expected: 'passed',
    runs: 2,
  },
  {
    name: 'unavailable receipt during the current process',
    passed: true,
    freshness: 'unknown',
    expected: 'notRun',
    runs: 1,
  },
  {
    name: 'receipt from another Work task',
    passed: true,
    receipt: 'foreign',
    expected: 'passed',
    runs: 2,
  },
  {
    name: 'legacy stage without its receipt',
    passed: true,
    receipt: 'legacy',
    expected: 'passed',
    runs: 2,
  },
  {
    name: 'unparseable legacy check across restart',
    passed: true,
    restart: true,
    receipt: 'legacyText',
    expected: 'passed',
    runs: 2,
  },
])(
  'continues interrupted Work with trustworthy Node-test evidence: $name',
  async ({ passed, restart, freshness, receipt, expected, runs }) => {
    let currentNativeCheck: string | undefined
    let tests = 0
    vi.mocked(commands.startAssistantTests).mockImplementation(async () => {
      currentNativeCheck = `node-tests-${++tests}`
      return { status: 'ok', data: currentNativeCheck }
    })
    vi.mocked(commands.startAssistantCheck).mockImplementation(async () => {
      currentNativeCheck = 'smoke-check'
      return { status: 'ok', data: currentNativeCheck }
    })
    vi.mocked(commands.getCreationCheck).mockImplementation(
      async (identity, id) =>
        id === currentNativeCheck
          ? {
              status: 'ok',
              data: {
                identity,
                taskId: id,
                progress: null,
                report: nativeReport(id, passed),
              },
            }
          : {
              status: 'error',
              error: {
                code: 'io',
                detail: 'A later check owns the native slot',
              },
            }
    )
    let interrupted = false
    let checkpoint: AssistantContinuation | undefined
    const deps: AssistantDependencies = {
      begin: async (_, requestId) => ({
        requestId,
        model: 'scripted',
        baseUrl: 'https://fixture.invalid',
      }),
      corpus: async () =>
        HELP_BOOKS.flatMap(book =>
          book.documentIds.map(id => ({
            id,
            path: `${id}.md`,
            markdown: `# ${id}\n\nFixture contract.`,
          }))
        ),
      cancel: async () => undefined,
      task: beginAssistantTask,
      projectInventory: async () => inventory,
      turn: async () => {
        if (!interrupted) {
          interrupted = true
          return { text: 'Saved the requested change.', toolCalls: [] }
        }
        throw new Error('Provider connection lost after the test result')
      },
    }
    const request = {
      identity: 'owner',
      mode: 'edit' as const,
      input: 'Keep the voice active until its explicit release event.',
      locale: 'en' as const,
      history: [],
      projectReading: true,
      project: inventory,
      signal: new AbortController().signal,
      isCurrent: () => true,
      onContinuation: (value: AssistantContinuation | null) => {
        if (value) checkpoint = value
      },
    }
    await expect(runAssistantRequest(request, deps)).rejects.toMatchObject({
      code: 'requestFailed',
    })
    expect(checkpoint?.lastCheck).toContain('projectTests')
    if (!checkpoint?.lastCheck)
      throw new Error('Missing completed check boundary')
    let continuation = checkpoint
    if (receipt) {
      const previous = JSON.parse(checkpoint.lastCheck)
      if (receipt === 'legacy') delete previous.projectTestReceipt
      else if (receipt === 'foreign')
        previous.projectTestReceipt.taskId = 'another-work-task'
      continuation = {
        ...checkpoint,
        lastCheck:
          receipt === 'legacyText'
            ? 'Legacy check is unavailable'
            : JSON.stringify(previous),
      }
    }
    if (freshness) {
      vi.mocked(commands.creationCheckIsStale).mockImplementation(
        async (_, id) =>
          id === 'node-tests-1' && freshness === 'unknown'
            ? {
                status: 'error',
                error: { code: 'io', detail: 'Private receipt unavailable' },
              }
            : {
                status: 'ok',
                data: id === 'node-tests-1' && freshness === 'stale',
              }
      )
    }
    const restored = restart
      ? deserializeAssistantContinuation(
          serializeAssistantContinuation(continuation)
        )
      : continuation
    if (!restored) throw new Error('The saved Work checkpoint could not reopen')
    const resumed = await runAssistantRequest(
      { ...request, continuation: restored },
      {
        ...deps,
        turn: async () => ({
          text: 'Saved; the original test outcome remains part of delivery.',
          toolCalls: [],
        }),
      }
    )
    expect(resumed.checkOutcome?.projectTests).toMatchObject({
      status: expected,
      ...(expected === 'notRun'
        ? { reason: 'evidenceUnavailable' }
        : {
            inputVersion: 'saved-v1',
            ...(expected === 'failed'
              ? { reason: 'The held voice ended before release' }
              : {}),
          }),
    })
    expect(commands.startAssistantTests).toHaveBeenCalledTimes(runs)
  }
)
