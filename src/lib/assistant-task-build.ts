import {
  commands,
  type AssistantCompilationReceipt,
  type AssistantCompileResult,
  type AssistantTask,
  type CreationErrorCode,
} from './tauri-bindings'
import type { AssistantEvidenceStage } from './assistant-delivery'
import { AssistantToolExecutionError } from './assistant-tool-contracts'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'

export function assistantCompileSummary(result: AssistantCompileResult) {
  return {
    status: result.status,
    reused: result.reused,
    inputs: result.inputs,
    artifacts: result.artifacts,
    report: {
      ...result.report,
      output: result.report.output.slice(-8192),
      error: result.report.error?.slice(0, 2048),
    },
    note: 'Compilation and artifact symbol/reference checks only. No running performance was restarted and sound behavior is not established. Repair compiler diagnostics in this task; do not ask the creator to perform routine compilation.',
  }
}

function unwrap<T>(
  result:
    | { status: 'ok'; data: T }
    | {
        status: 'error'
        error: { code: CreationErrorCode; detail?: string }
      }
): T {
  if (result.status === 'error')
    throw new AssistantToolExecutionError(
      result.error.code,
      result.error.detail,
      'native'
    )
  return result.data
}

async function buildEvidence(
  receipt: AssistantCompilationReceipt
): Promise<AssistantEvidenceStage> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      inputs: receipt.inputs,
      artifacts: receipt.artifacts,
    })
  )
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return {
    status: 'passed',
    inputVersion: Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0')
    ).join(''),
  }
}

/** Both automatic preparation and the explicit tool use the same native task
 * operation, including its binary journal and fresh receipt validation. */
export function assistantTaskBuild({
  identity,
  taskId,
  assertCurrent,
  published,
}: {
  identity: string
  taskId: string
  assertCurrent: () => void
  published: (task: AssistantTask) => Promise<void>
}) {
  const compile = async (): Promise<AssistantCompileResult> => {
    assertCurrent()
    const protectedPaths = Object.entries(
      useCreationFilesStore.getState().drafts
    )
      .filter(
        ([, draft]) =>
          isDraftDirty(draft) ||
          draft.conflict ||
          draft.saving ||
          draft.renaming ||
          draft.diskChanged
      )
      .map(([path]) => path)
    const result = unwrap(
      await commands.compileAssistantSynthdefs(identity, taskId, protectedPaths)
    )
    assertCurrent()
    if (result.status === 'succeeded' && !result.reused)
      await published(result.task)
    assertCurrent()
    return result
  }
  const validate = async (projectCheck = false) => {
    assertCurrent()
    const state = unwrap(
      await commands.getAssistantBuildState(identity, taskId, projectCheck)
    )
    assertCurrent()
    return {
      needed: state.needed,
      build:
        state.receipt && !state.needed
          ? await buildEvidence(state.receipt)
          : state.needed
            ? undefined
            : { status: 'notRequired' as const },
    }
  }
  return {
    compile,
    validate,
    prepare: async (): Promise<{
      build?: AssistantEvidenceStage
      blocked?: string
    }> => {
      const state = await validate(true)
      if (!state.needed) {
        return { build: state.build }
      }
      const result = await compile()
      if (result.status === 'succeeded')
        return { build: await buildEvidence(result) }
      if (result.status === 'cancelled') throw new Error('cancelled')
      return {
        build: {
          status:
            result.status === 'compilerUnavailable' ? 'blocked' : 'failed',
          reason: (
            result.report.error ??
            result.report.output ??
            result.status
          ).slice(0, 2048),
        },
        blocked: JSON.stringify(assistantCompileSummary(result)),
      }
    },
  }
}
