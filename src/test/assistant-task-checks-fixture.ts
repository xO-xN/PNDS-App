import { vi } from 'vitest'
import { AssistantTaskChecks } from '@/lib/assistant-task-checks'
import { CreationCheckRunner } from '@/lib/creation-check-runner'
import {
  commands,
  type AssistantMode,
  type AssistantTask,
  type ControlledCheckReport,
} from '@/lib/tauri-bindings'

/** Scripted model replays keep the real check policy and native-check runner. */
export function createAssistantTaskChecksFixture({
  identity,
  mode = 'edit',
  task,
  invokeProjectCheckTool,
  result = () => ({ status: 'passed', error: null }),
}: {
  identity: string
  mode?: AssistantMode
  task: () => AssistantTask
  invokeProjectCheckTool: () => Promise<string>
  result?: () => Pick<ControlledCheckReport, 'status' | 'error'> & {
    unverified?: string[]
  }
}) {
  let check = 0
  vi.mocked(commands.diagnoseCreationProject).mockResolvedValue({
    status: 'ok',
    data: {
      schemaVersion: 1,
      checkerVersion: 'test',
      projectPath: '/score',
      project: null,
      inputFingerprint: 'fixture-static',
      inputs: [],
      checks: [],
      issues: [],
      unverified: [],
      staticPassed: true,
    },
  })
  vi.mocked(commands.startAssistantCheck).mockImplementation(async () => ({
    status: 'ok',
    data: `${task().id}-check-${++check}`,
  }))
  vi.mocked(commands.getCreationCheck).mockImplementation(
    async (owner, taskId) => ({
      status: 'ok',
      data: {
        identity: owner,
        taskId,
        progress: null,
        report: {
          schemaVersion: 1,
          checkerVersion: 'test',
          taskId,
          projectPath: '/score',
          mode: 'none',
          diagnostics: null,
          evidence: {
            sourceRoot: '/score',
            sourceIdentity: 'fixture-inode',
            sharedSourceRoot: null,
            projectSha256: `fixture-${check}`,
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
          unverified: [],
          ...result(),
        },
      },
    })
  )
  vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
    status: 'ok',
    data: false,
  })
  return new AssistantTaskChecks({
    identity,
    mode,
    task,
    isCurrent: () => true,
    runner: new CreationCheckRunner(identity, () => true),
    invokeProjectCheckTool,
  })
}
