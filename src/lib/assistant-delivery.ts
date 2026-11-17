import type {
  AssistantDeliveryEvidence,
  AssistantEvidenceStage,
  AssistantTask,
} from './tauri-bindings'

export type { AssistantDeliveryEvidence, AssistantEvidenceStage }

const MAX_STAGE_TEXT_BYTES = 4096
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

/** History bounds UTF-8 bytes. Only the display projection is shortened; source
 * receipts and native reports retain the complete diagnostic and input version. */
function displayText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const encoded = encoder.encode(value)
  // Older diagnostic slices can end in a lone UTF-16 surrogate. Native JSON
  // requires Unicode scalar values, including for text below the byte limit.
  const text = decoder.decode(encoded)
  if (encoded.length <= MAX_STAGE_TEXT_BYTES) return text
  let bytes = encoder.encode('…').length
  let end = 0
  for (const character of text) {
    const size = encoder.encode(character).length
    if (bytes + size > MAX_STAGE_TEXT_BYTES) break
    bytes += size
    end += character.length
  }
  return `${text.slice(0, end)}…`
}

function displayStage(stage: AssistantEvidenceStage): AssistantEvidenceStage {
  const reason = displayText(stage.reason)
  const inputVersion = displayText(stage.inputVersion)
  return {
    status: stage.status,
    ...(reason ? { reason } : {}),
    ...(inputVersion ? { inputVersion } : {}),
  }
}

/** A receipt records what a trusted adapter actually checked. It is display
 * data, never permission to execute or a model-authored completion claim. */
export function assistantDeliveryEvidence(
  task: AssistantTask,
  receipt?: string,
  build?: AssistantEvidenceStage,
  projectTests?: AssistantEvidenceStage
): AssistantDeliveryEvidence | undefined {
  const savedPaths = task.files
    .filter(file => !file.undone && !file.directory)
    .map(file => file.path)
  if (!savedPaths.length) return undefined
  const documentsOnly = savedPaths.every(path => /\.(md|txt)$/i.test(path))
  const unexecuted = (reason: string): AssistantEvidenceStage => ({
    status: documentsOnly ? 'notRequired' : 'notRun',
    reason,
  })
  const evidence: AssistantDeliveryEvidence = {
    schemaVersion: 1,
    taskId: task.id,
    savedPaths,
    staticCheck: { status: 'notRun' },
    build:
      build ??
      (savedPaths.some(path => /^supercollider\/source\/.+\.scd$/i.test(path))
        ? { status: 'notRun', reason: 'compilationRequired' }
        : { status: 'notRequired' }),
    runtime: unexecuted('savedChangesNotLoaded'),
    behavior: unexecuted('behaviorNotVerified'),
    ...(projectTests ? { projectTests } : {}),
  }
  const display = (): AssistantDeliveryEvidence => ({
    ...evidence,
    staticCheck: displayStage(evidence.staticCheck),
    build: displayStage(evidence.build),
    runtime: displayStage(evidence.runtime),
    behavior: displayStage(evidence.behavior),
    ...(evidence.projectTests
      ? { projectTests: displayStage(evidence.projectTests) }
      : {}),
  })
  if (!receipt) return display()
  let result
  try {
    result = JSON.parse(receipt)
  } catch {
    return display()
  }
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return display()
  const stage = (value: unknown): AssistantEvidenceStage | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined
    const item = value as Record<string, unknown>
    if (
      ![
        'passed',
        'failed',
        'blocked',
        'notRun',
        'notRequired',
        'observed',
      ].includes(String(item.status))
    )
      return undefined
    return value as AssistantEvidenceStage
  }
  if (!build) evidence.build = stage(result.build) ?? evidence.build
  if (!projectTests && stage(result.projectTests))
    evidence.projectTests = stage(result.projectTests)
  if (result.static?.staticPassed !== undefined)
    evidence.staticCheck = {
      status: result.static.staticPassed ? 'passed' : 'failed',
      inputVersion: result.static.inputFingerprint,
    }
  if (result.staticStale || result.stale) {
    evidence.staticCheck = { status: 'notRun', reason: 'savedInputChanged' }
  }
  if (result.runtimeStale || result.stale) {
    evidence.runtime = unexecuted('savedInputChanged')
  } else if (result.runtime?.kind === 'liveObservation') {
    evidence.runtime = {
      status: result.runtime.passed === false ? 'failed' : 'observed',
      reason:
        result.runtime.passed === false
          ? 'existingRuntimeFailed'
          : 'existingRuntimeOnly',
      inputVersion: result.runtime.generation ?? result.runtime.key,
    }
  } else if (result.runtime?.status === 'blocked') {
    evidence.runtime = {
      status: 'blocked',
      reason: result.runtime.reason,
    }
  } else if (result.scope === 'savedCopySmoke') {
    evidence.runtime = {
      status: result.status === 'passed' ? 'passed' : 'failed',
      reason: 'savedCopySmokeOnly',
      inputVersion: result.savedInput?.projectSha256,
    }
  }
  return display()
}
