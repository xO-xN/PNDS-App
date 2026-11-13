import {
  commands,
  type AssistantMode,
  type AssistantTask,
  type ControlledCheckReport,
  type CreationErrorCode,
  type DiagnosticReport,
} from './tauri-bindings'
import {
  CreationCheckFailure,
  type CreationCheckRunner,
} from './creation-check-runner'
import { AssistantToolExecutionError } from './assistant-tool-contracts'
import {
  assistantDeliveryEvidence,
  type AssistantDeliveryEvidence,
  type AssistantEvidenceStage,
} from './assistant-delivery'
import { isSessionLive, useSessionStore } from '@/store/session-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'

/** The existing version-1 checkpoint projection; no execution authority lives here. */
export interface AssistantCheckCheckpointV1 {
  readonly needsCheck?: boolean
  readonly lastCheck?: string
  readonly lastCheckId?: string
}

export interface AssistantTaskCheckPolicy {
  readonly requiredBeforeReply: boolean
  readonly contextEvidence: string | undefined
  readonly deliveryEvidence?: AssistantDeliveryEvidence
  verifyDelivery?: () => Promise<void>
  saved: () => void
  recoveredPublication: () => void
  restore: (input: {
    checkpoint?: AssistantCheckCheckpointV1
    restarted: boolean
    savedInputsChanged: boolean
  }) => Promise<void>
  requested: (kind: 'project' | 'static' | 'tests') => Promise<string>
  beforeReply: () => Promise<string | undefined>
  checkpoint: () => AssistantCheckCheckpointV1
}

export interface AssistantTaskChecksOptions {
  identity: string
  mode: AssistantMode
  task: () => AssistantTask
  isCurrent: () => boolean
  runner: CreationCheckRunner
  invokeProjectCheckTool: () => Promise<string>
  prepareSavedInputs?: () => Promise<{
    build?: AssistantEvidenceStage
    blocked?: string
  }>
  hasProjectTests?: () => Promise<boolean>
  validateBuild?: () => Promise<{
    needed: boolean
    build?: AssistantEvidenceStage
  }>
}

function unwrap<T>(
  result:
    | { status: 'ok'; data: T }
    | { status: 'error'; error: { code: CreationErrorCode; detail?: string } }
): T {
  if (result.status === 'error')
    throw new AssistantToolExecutionError(
      result.error.code,
      result.error.detail,
      'native'
    )
  return result.data
}

function hasCreatorDraft(): boolean {
  return Object.values(useCreationFilesStore.getState().drafts).some(
    isDraftDirty
  )
}

/** The full native report stays available to the App. The model needs actionable
 * diagnostics, not thousands of dependency paths and content fingerprints. */
function checkSummary(
  report: ControlledCheckReport,
  stale: boolean,
  diagnostic: ReturnType<typeof staticSummary>
) {
  const checks = [...report.checks, ...(report.diagnostics?.checks ?? [])]
  const ordered = [
    ...checks.filter(check => check.status !== 'passed'),
    ...checks.filter(check => check.status === 'passed'),
  ]
  return {
    taskId: report.taskId,
    scope: 'savedCopySmoke',
    static: report.diagnostics ? staticSummary(report.diagnostics) : diagnostic,
    status: stale && report.status === 'passed' ? 'stale' : report.status,
    stale,
    error: report.error?.slice(0, 2048),
    checks: ordered.slice(0, 12).map(check => ({
      ...check,
      code: check.code.slice(0, 128),
      reason: check.reason.slice(0, 512),
    })),
    issues: report.diagnostics?.issues.slice(0, 8).map(issue => ({
      ...issue,
      path: issue.path?.slice(0, 256),
      field: issue.field?.slice(0, 128),
      reason: issue.reason.slice(0, 512),
    })),
    omittedChecks: Math.max(0, checks.length - 12),
    omittedIssues: Math.max(0, (report.diagnostics?.issues.length ?? 0) - 8),
    savedInput: report.evidence
      ? {
          projectSha256: report.evidence.projectSha256,
          sharedSha256: report.evidence.sharedSha256,
        }
      : null,
    ...(report.loadedImageSha256?.length
      ? { loadedImageSha256: report.loadedImageSha256 }
      : {}),
    outputTail: report.outputTail.slice(-8).map(line => line.slice(0, 512)),
    cleanup: {
      ...report.cleanup,
      errors: report.cleanup.errors
        .slice(0, 4)
        .map(error => error.slice(0, 512)),
    },
    unverified: report.unverified.slice(0, 16).map(item => item.slice(0, 128)),
    note:
      (stale
        ? 'Saved input changed or could not be verified. Do not claim the current files passed.'
        : 'This is a diagnostic summary; the full report remains in the App. Repair actionable failures, or conclude concisely when the original user task is implemented and verified. Do not repeat checks or planning for unchanged input.') +
      ' A passing smoke check does not establish fidelity to the original artwork. Missing original source remains a blocker; a runnable replacement demo does not complete a repair request.',
  }
}

function staticSummary(report: DiagnosticReport) {
  return {
    staticPassed: report.staticPassed,
    inputFingerprint: report.inputFingerprint,
    checks: report.checks
      .slice(0, 12)
      .map(check => ({ ...check, reason: check.reason.slice(0, 512) })),
    issues: report.issues
      .slice(0, 8)
      .map(issue => ({ ...issue, reason: issue.reason.slice(0, 512) })),
    omittedIssues: Math.max(0, report.issues.length - 8),
    unverified: report.unverified,
  }
}

/** Task-local check policy. Native authorization, check lifetime and cleanup stay
 * with the existing task and check runners. */
export class AssistantTaskChecks implements AssistantTaskCheckPolicy {
  private needsCheck = false
  private lastCheck?: string
  private lastCheckId?: string
  private build?: AssistantEvidenceStage
  private projectTests?: AssistantEvidenceStage
  private lastTests?: { id: string; text: string }

  constructor(private readonly options: AssistantTaskChecksOptions) {}

  get requiredBeforeReply(): boolean {
    return this.needsCheck
  }

  get contextEvidence(): string | undefined {
    return this.lastCheck
  }

  get deliveryEvidence(): AssistantDeliveryEvidence | undefined {
    return assistantDeliveryEvidence(
      this.options.task(),
      this.lastCheck,
      this.build,
      this.projectTests
    )
  }

  saved(): void {
    this.needsCheck = this.options.mode === 'edit'
    // Ordinary saved input invalidates a completed check, but the same runtime
    // can remain occupied. Keep that blocker while static diagnostics rerun.
    if (
      !this.lastCheck ||
      JSON.parse(this.lastCheck).runtime?.status !== 'blocked'
    )
      this.lastCheck = undefined
    this.lastCheckId = undefined
    this.build = undefined
    this.projectTests = undefined
  }

  recoveredPublication(): void {
    // A verified partial directory publication has always discarded all prior
    // evidence, including runtime blockers; preserve that separate behavior.
    this.needsCheck = true
    this.lastCheck = undefined
    this.lastCheckId = undefined
    this.build = undefined
    this.projectTests = undefined
  }

  async restore({
    checkpoint,
    restarted,
    savedInputsChanged,
  }: {
    checkpoint?: AssistantCheckCheckpointV1
    restarted: boolean
    savedInputsChanged: boolean
  }): Promise<void> {
    const hasSavedChanges = this.options.task().files.some(file => !file.undone)
    this.needsCheck =
      checkpoint?.needsCheck ??
      (this.options.mode === 'edit' && hasSavedChanges)
    this.lastCheck = checkpoint?.lastCheck
    this.lastCheckId = checkpoint?.lastCheckId
    if (savedInputsChanged) {
      this.lastCheck = undefined
      this.lastCheckId = undefined
      this.needsCheck = this.options.mode === 'edit'
    }
    if (this.lastCheck) await this.restoreTests(this.lastCheck)
    if (
      restarted &&
      this.options.mode === 'edit' &&
      !this.needsCheck &&
      hasSavedChanges
    ) {
      const verified = await this.verifyLastCheck()
      this.assertCurrent()
      if (!verified) {
        this.needsCheck = true
        this.lastCheck = undefined
        this.lastCheckId = undefined
      }
    }
    if (
      restarted &&
      !this.needsCheck &&
      hasSavedChanges &&
      this.options.validateBuild
    ) {
      const state = await this.options.validateBuild()
      this.assertCurrent()
      this.build = state.build
      if (state.needed) {
        this.needsCheck = true
        this.lastCheck = undefined
        this.lastCheckId = undefined
      }
    }
  }

  checkpoint(): AssistantCheckCheckpointV1 {
    const lastCheck = this.projectTests
      ? JSON.stringify({
          ...(this.lastCheck ? JSON.parse(this.lastCheck) : {}),
          projectTests: this.projectTests,
          ...(this.lastTests
            ? {
                projectTestReceipt: {
                  taskId: this.options.task().id,
                  checkId: this.lastTests.id,
                  result: JSON.parse(this.lastTests.text),
                },
              }
            : {}),
        })
      : this.lastCheck
    return {
      needsCheck: this.needsCheck,
      lastCheck,
      lastCheckId: this.lastCheckId,
    }
  }

  private async restoreTests(lastCheck: string): Promise<void> {
    let previous
    try {
      previous = JSON.parse(lastCheck)
    } catch {
      // Older V1 records already fall back to a new full check on restart.
      return
    }
    if (!previous || typeof previous !== 'object' || !previous.projectTests)
      return
    // Display stages alone cannot establish a current test result. Keep the
    // native check identity and its actual bounded summary in the existing
    // JSON checkpoint. getCreationCheck only retains the latest native slot;
    // freshness can also validate older completed receipts from private disk.
    this.lastTests = undefined
    this.projectTests = { status: 'notRun', reason: 'evidenceUnavailable' }
    const receipt = previous.projectTestReceipt
    if (
      !receipt ||
      receipt.taskId !== this.options.task().id ||
      typeof receipt.checkId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,128}$/.test(receipt.checkId) ||
      receipt.result?.taskId !== receipt.checkId ||
      receipt.result?.scope !== 'projectTests' ||
      !['passed', 'failed', 'cancelled', 'notExecuted'].includes(
        receipt.result?.status
      ) ||
      typeof receipt.result?.savedInput?.projectSha256 !== 'string' ||
      !receipt.result.savedInput.projectSha256
    ) {
      this.lastCheckId = undefined
      this.needsCheck = this.options.mode === 'edit'
      return
    }
    try {
      const freshness = await this.options.runner.freshness(receipt.checkId)
      this.assertCurrent()
      if (freshness.status === 'fresh') {
        this.projectTests = {
          status:
            receipt.result.status === 'passed'
              ? 'passed'
              : receipt.result.status === 'failed'
                ? 'failed'
                : 'notRun',
          inputVersion: receipt.result.savedInput.projectSha256,
          reason:
            typeof receipt.result.error === 'string'
              ? receipt.result.error
              : undefined,
        }
        this.lastTests = {
          id: receipt.checkId,
          text: JSON.stringify(receipt.result),
        }
      } else {
        // A fresh smoke receipt cannot bypass a missing prerequisite test.
        this.lastCheckId = undefined
        this.projectTests = {
          status: 'notRun',
          reason:
            freshness.status === 'stale'
              ? 'savedInputChanged'
              : 'evidenceUnavailable',
        }
        if (freshness.status === 'stale')
          this.needsCheck = this.options.mode === 'edit'
      }
    } catch (cause) {
      this.assertCurrent()
      if (cause instanceof Error && cause.message === 'cancelled') throw cause
      // A missing/failed native read is an evidence gap, never restored success.
      this.lastCheckId = undefined
      this.projectTests = { status: 'notRun', reason: 'evidenceUnavailable' }
    }
  }

  async verifyDelivery(): Promise<void> {
    // A tool-free/read-only Work reply has no delivery claim to refresh. The
    // request loop still fences publication; do not query unrelated native
    // build state without a saved change or an existing check receipt.
    if (
      !this.lastCheck &&
      !this.build &&
      !this.projectTests &&
      !this.lastTests &&
      !this.options.task().files.some(file => !file.undone)
    )
      return
    this.assertCurrent()
    let stale = false
    if (this.options.validateBuild) {
      try {
        const state = await this.options.validateBuild()
        this.assertCurrent()
        if (state.needed) {
          if (!this.build || this.build.status === 'passed') {
            stale = true
            this.build = { status: 'notRun', reason: 'compilationRequired' }
          }
        } else this.build = state.build
      } catch (cause) {
        this.assertCurrent()
        if (cause instanceof Error && cause.message === 'cancelled') throw cause
        stale = true
        this.build = { status: 'blocked', reason: 'evidenceUnavailable' }
      }
    }
    if (this.lastTests) {
      const freshness = await this.options.runner.freshness(this.lastTests.id)
      this.assertCurrent()
      if (freshness.status !== 'fresh') {
        stale = true
        this.projectTests = {
          status: 'notRun',
          reason:
            freshness.status === 'stale'
              ? 'savedInputChanged'
              : 'evidenceUnavailable',
        }
        this.lastTests = undefined
      }
    }
    if (!this.lastCheck) return
    const result = JSON.parse(this.lastCheck)
    if (!this.lastCheckId && result.static?.inputFingerprint) {
      const freshness = await commands.creationDiagnosticIsStale(
        this.options.identity,
        result.static.inputFingerprint
      )
      this.assertCurrent()
      result.staticStale = freshness.status !== 'ok' || freshness.data
      stale ||= result.staticStale
    }
    if (this.lastCheckId) {
      const freshness = await this.options.runner.freshness(this.lastCheckId)
      this.assertCurrent()
      result.runtimeStale = freshness.status !== 'fresh'
      result.staticStale = result.runtimeStale
      stale ||= result.runtimeStale
    }
    result.build = this.build
    result.projectTests = this.projectTests
    if (stale) {
      result.status = 'stale'
      result.note =
        'Some evidence expired before delivery. Report the affected stages as unverified. A previous successful build, test or runtime observation cannot establish the current saved input; do not claim full completion.'
    }
    this.lastCheck = JSON.stringify(result)
  }

  async beforeReply(): Promise<string | undefined> {
    if (!this.needsCheck) return undefined
    this.assertCurrent()
    // Use the normal tool entry so pending questions/resource choices and its
    // structured refusals retain their existing behavior. A thrown cancellation
    // does not settle this automatic-check obligation.
    const report = await this.options.invokeProjectCheckTool()
    this.assertCurrent()
    this.needsCheck = false
    return report
  }

  async requested(kind: 'project' | 'static' | 'tests'): Promise<string> {
    this.assertCurrent()
    if (this.options.mode !== 'edit')
      throw new AssistantToolExecutionError('invalidToolArguments')
    if (hasCreatorDraft())
      throw new AssistantToolExecutionError(
        'creatorDraft',
        'Unsaved editor changes exist. Ask the creator to save or discard them before checking.'
      )
    if (kind === 'tests') return this.runTests()
    if (kind === 'project' && this.options.prepareSavedInputs) {
      const preparation = await this.options.prepareSavedInputs()
      this.assertCurrent()
      this.build = preparation.build
      if (preparation.blocked) {
        this.needsCheck = false
        this.lastCheckId = undefined
        this.lastCheck = JSON.stringify({
          status: 'blocked',
          build: preparation.build,
          reason: preparation.blocked,
          note: 'The required build or project test did not pass. Repair actionable errors in this same task and rerun. Retain a real environment blocker; do not delegate routine compilation to the creator or claim completion.',
        })
        return this.lastCheck
      }
    }
    const previous = this.lastCheck ? JSON.parse(this.lastCheck) : null
    if (
      kind === 'project' &&
      !isSessionLive(useSessionStore.getState().sessionStatus) &&
      this.lastCheck &&
      this.lastCheckId &&
      !JSON.parse(this.lastCheck).stale
    ) {
      const receipt = this.lastCheck
      const receiptId = this.lastCheckId
      const freshness = await this.options.runner.freshness(receiptId)
      if (
        freshness.status === 'fresh' &&
        this.lastCheck === receipt &&
        this.lastCheckId === receiptId &&
        !isSessionLive(useSessionStore.getState().sessionStatus)
      ) {
        this.assertCurrent()
        this.needsCheck = false
        return JSON.stringify({
          ...JSON.parse(receipt),
          reused: true,
          note: 'Reused the actual check for identical saved input. No new check was started. A passing smoke check does not establish fidelity to the original artwork. Missing original source remains a blocker; a runnable replacement demo does not complete a repair request. Do not request it again; implement only remaining steps of the original user task, or return the final result/blocker.',
        })
      }
      this.lastCheck = undefined
      this.lastCheckId = undefined
    }
    const diagnostic = staticSummary(
      unwrap(await commands.diagnoseCreationProject(this.options.identity))
    )
    this.assertCurrent()
    if (kind === 'static')
      return JSON.stringify({
        status: diagnostic.staticPassed ? 'passed' : 'failed',
        static: diagnostic,
        build: this.build,
        note: 'Static contracts only; no runtime or visual success is implied.',
      })
    const savedFiles = this.options.task().files.filter(file => !file.undone)
    if (
      savedFiles.length &&
      savedFiles.every(file => file.directory || /\.(md|txt)$/i.test(file.path))
    ) {
      this.needsCheck = false
      this.lastCheckId = undefined
      this.lastCheck = JSON.stringify({
        status: diagnostic.staticPassed ? 'passed' : 'failed',
        static: diagnostic,
        runtime: { status: 'notRequired' },
        note: 'Only document files were saved. Static contracts were checked; compilation and runtime execution are not required for this task.',
      })
      return this.lastCheck
    }
    if (
      this.options.hasProjectTests &&
      (await this.options.hasProjectTests())
    ) {
      const tests = JSON.parse(await this.runTests())
      this.assertCurrent()
      if (tests.status !== 'passed') {
        this.needsCheck = false
        this.lastCheckId = undefined
        this.lastCheck = JSON.stringify({
          status: tests.status === 'blocked' ? 'blocked' : 'failed',
          static: diagnostic,
          build: this.build,
          projectTests: this.projectTests,
          tests,
          note: 'Project tests have not passed for the saved input. Repair actionable failures in this same task, then rerun. Preserve a real environment/runtime blocker and the remaining validation; do not report the task as fully verified.',
        })
        return this.lastCheck
      }
    }
    const session = useSessionStore.getState()
    const runtimeKey = `${session.runId}:${session.sessionStatus}`
    const blocked = (reason: string) => {
      this.needsCheck = false
      this.lastCheck = JSON.stringify({
        status: 'blocked',
        static: diagnostic,
        build: this.build,
        projectTests: this.projectTests,
        runtime: { status: 'blocked', reason, key: runtimeKey },
        note: 'Saved changes are retained. Static diagnostics ran; runtime validation did not run. Do not retry while the runtime state is unchanged. Report the blocker once and finish.',
      })
      this.lastCheckId = undefined
      return this.lastCheck
    }
    if (session.sessionStatus === 'ready') {
      const observation = unwrap(
        await commands.inspectCreationRuntime(this.options.identity, true)
      )
      this.assertCurrent()
      if (
        useSessionStore.getState().runId !== session.runId ||
        useSessionStore.getState().sessionStatus !== 'ready'
      )
        return blocked('runtimeChanged')
      this.needsCheck = false
      this.lastCheckId = undefined
      this.lastCheck = JSON.stringify({
        status:
          diagnostic.staticPassed && observation.passed ? 'partial' : 'failed',
        static: diagnostic,
        build: this.build,
        projectTests: this.projectTests,
        runtime: {
          kind: 'liveObservation',
          status: 'observed',
          passed: observation.passed,
          key: runtimeKey,
          savedChangesVerified: false,
          generation: observation.generation,
          checks: observation.checks,
        },
        note: 'Saved-file static diagnostics and read-only observations of the EXISTING runtime only. The saved implementation is not runtime-verified. Report saved, built, loaded and behavior-verified stages separately. Retain pending loading/verification in the task report; static success does not close missing compilation or tests. Do not interrupt the active performance. Ask for a suitable restart time only when loading the changes actually requires it; do not repeat this observation for unchanged input.',
      })
      return this.lastCheck
    }
    if (isSessionLive(session.sessionStatus)) return blocked('activeSession')
    if (
      previous?.runtime?.status === 'blocked' &&
      previous.runtime.key === runtimeKey
    )
      return blocked(previous.runtime.reason)
    if (!diagnostic.staticPassed) {
      this.needsCheck = false
      this.lastCheckId = undefined
      this.lastCheck = JSON.stringify({
        status: 'failed',
        static: diagnostic,
        build: this.build,
        projectTests: this.projectTests,
        runtime: { status: 'notExecuted' },
      })
      return this.lastCheck
    }
    let snapshot
    try {
      snapshot = await this.options.runner.run({
        kind: 'assistant',
        taskId: this.options.task().id,
      })
    } catch (cause) {
      if (
        cause instanceof CreationCheckFailure &&
        cause.error.code === 'runtimeBusy'
      )
        return blocked('runtimeBusy')
      throw cause
    }
    if (!snapshot?.report) throw new Error('cancelled')
    this.assertCurrent()
    const freshness = snapshot.report.evidence
      ? await this.options.runner.freshness(snapshot.taskId)
      : { status: 'unknown' as const }
    if ('error' in freshness && freshness.error)
      throw new CreationCheckFailure(freshness.error)
    this.assertCurrent()
    this.lastCheck = JSON.stringify({
      ...checkSummary(
        snapshot.report,
        freshness.status !== 'fresh',
        diagnostic
      ),
      build: this.build,
      projectTests: this.projectTests,
    })
    this.lastCheckId = snapshot.taskId
    this.needsCheck = false
    await this.verifyDelivery()
    return this.lastCheck
  }

  private assertCurrent(): void {
    if (!this.options.isCurrent()) throw new Error('cancelled')
  }

  private async runTests(): Promise<string> {
    this.assertCurrent()
    if (isSessionLive(useSessionStore.getState().sessionStatus)) {
      this.projectTests = { status: 'blocked', reason: 'activeSession' }
      return JSON.stringify({
        status: 'blocked',
        reason: 'activeSession',
        note: 'Project tests were not executed while the performance owns the runtime. Do not stop the performance or retry until its state changes.',
      })
    }
    if (this.lastTests) {
      const previous = this.lastTests
      const freshness = await this.options.runner.freshness(previous.id)
      this.assertCurrent()
      if (freshness.status === 'fresh' && this.lastTests === previous) {
        const result = JSON.parse(previous.text)
        this.projectTests = {
          status: result.status === 'passed' ? 'passed' : 'failed',
          inputVersion: result.savedInput?.projectSha256,
          reason: typeof result.error === 'string' ? result.error : undefined,
        }
        return previous.text
      }
      this.lastTests = undefined
    }
    let snapshot
    try {
      snapshot = await this.options.runner.run({
        kind: 'assistantTests',
        taskId: this.options.task().id,
      })
    } catch (cause) {
      if (
        !(cause instanceof CreationCheckFailure) ||
        cause.error.code !== 'runtimeBusy'
      )
        throw cause
      this.projectTests = { status: 'blocked', reason: 'runtimeBusy' }
      return JSON.stringify({ status: 'blocked', reason: 'runtimeBusy' })
    }
    if (!snapshot?.report) throw new Error('cancelled')
    const report = snapshot.report
    const freshness = report.evidence
      ? await this.options.runner.freshness(snapshot.taskId)
      : { status: 'unknown' as const }
    this.assertCurrent()
    const stale = freshness.status !== 'fresh'
    const status = stale && report.status === 'passed' ? 'stale' : report.status
    this.projectTests = {
      status:
        status === 'passed'
          ? 'passed'
          : status === 'failed'
            ? 'failed'
            : 'notRun',
      reason:
        freshness.status === 'stale'
          ? 'savedInputChanged'
          : stale
            ? 'evidenceUnavailable'
            : report.error?.slice(0, 2048),
      inputVersion: report.evidence?.projectSha256,
    }
    const text = JSON.stringify({
      taskId: snapshot.taskId,
      status,
      scope: 'projectTests',
      savedInput: { projectSha256: report.evidence?.projectSha256 },
      entries: report.nodeTests?.entries,
      exitCode: report.nodeTests?.exitCode,
      checks: report.checks.slice(0, 12).map(check => ({
        ...check,
        code: check.code.slice(0, 128),
        reason: check.reason.slice(0, 512),
      })),
      error: report.error?.slice(0, 2048),
      outputTail: report.outputTail.slice(-16).map(line => line.slice(0, 512)),
      cleanup: {
        ...report.cleanup,
        errors: report.cleanup.errors
          .slice(0, 4)
          .map(error => error.slice(0, 512)),
      },
      note: 'These are the actual fixed Node test entries and results for saved input. A passing suite establishes only its assertions, not artistic fidelity or actual sound. Compare those assertions against the confirmed trigger, sustain and end behavior.',
    })
    if (!stale) this.lastTests = { id: snapshot.taskId, text }
    return text
  }

  private async verifyLastCheck(): Promise<boolean> {
    const owned = () => this.options.isCurrent() && !hasCreatorDraft()
    if (!owned()) return false
    if (this.options.mode !== 'edit') return true
    const receipt = this.lastCheck
    const receiptId = this.lastCheckId
    if (!receipt) return false
    try {
      const previous = JSON.parse(receipt)
      if (
        !previous ||
        typeof previous !== 'object' ||
        Array.isArray(previous) ||
        previous.stale ||
        !['passed', 'failed', 'cancelled', 'notExecuted', 'blocked'].includes(
          previous.status
        )
      )
        return false
      const stillCurrent = () =>
        owned() && this.lastCheck === receipt && this.lastCheckId === receiptId
      if (previous.runtime?.status === 'blocked') {
        // An old process's occupied lease cannot establish current occupancy.
        if (previous.runtime.reason === 'runtimeBusy') return false
        if (useSessionStore.getState().sessionStatus === 'ready') return false
        const runtimeKey = () => {
          const session = useSessionStore.getState()
          return `${session.runId}:${session.sessionStatus}`
        }
        if (
          previous.status !== 'blocked' ||
          previous.runtime.key !== runtimeKey() ||
          typeof previous.static?.inputFingerprint !== 'string' ||
          !previous.static.inputFingerprint
        )
          return false
        const freshness = await commands.creationDiagnosticIsStale(
          this.options.identity,
          previous.static.inputFingerprint
        )
        return (
          freshness.status === 'ok' &&
          !freshness.data &&
          stillCurrent() &&
          previous.runtime.key === runtimeKey()
        )
      }
      if (!receiptId) return false
      const freshness = await this.options.runner.freshness(receiptId)
      return freshness.status === 'fresh' && stillCurrent()
    } catch {
      return false
    }
  }
}
