import type { AssistantContinuation } from './assistant-flow'
import type { AssistantErrorCode, AssistantMessage } from './assistant-types'
import type {
  AssistantHistoryAttachment,
  AssistantMode,
  AssistantTaskResumeRecovery,
  AssistantTaskResumeState,
} from './tauri-bindings'
import type { WholeProjectPlan } from './assistant-whole-project'
import {
  clearAssistantResume,
  decodeSavedAssistantRequest,
  encodeSavedAssistantRequest,
  loadAssistantResume,
  saveAssistantResume,
} from './assistant-resume'

export interface AssistantTaskAttempt {
  readonly mode: AssistantMode
  readonly owner: string
  readonly input: string
  readonly userId: string
  readonly replyId: string
  readonly modelKey?: string
  readonly locale?: 'en' | 'zh-CN'
  conversationId: string | null
  history: AssistantMessage[]
  wholePlan: WholeProjectPlan | null
  continuation: AssistantContinuation | null
  paused: boolean
  awaitingResources?: boolean
  attachments?: AssistantHistoryAttachment[]
}

const isContinueInput = (input: string) =>
  /^(?:继续(?:吧|执行|任务)?|接着做|continue|resume)[.!。！]?$/i.test(
    input.trim()
  )
const resumableErrors: readonly AssistantErrorCode[] = [
  'timeout',
  'requestDeadline',
  'network',
  'rateLimited',
  'serviceUnavailable',
  'protocol',
  'requestRejected',
  'outputTruncated',
  'responseInterrupted',
  'responseTooLarge',
  'contextWindowExceeded',
]

/** Owns logical task state and publication order, never chat state or a native
 * grant. Loading a checkpoint only offers resumption; the flow reauthorizes. */
export class AssistantTaskLifecycle {
  private epoch = 0
  private retained: AssistantTaskAttempt | null = null
  private active: {
    request: AbortController
    pause: AbortController
    executing: boolean
  } | null = null

  constructor(private readonly onPersistenceError: (owner: string) => void) {}

  get attempt(): Readonly<AssistantTaskAttempt> | null {
    return this.retained
  }

  fence() {
    const epoch = this.epoch
    return () => this.epoch === epoch
  }

  canContinue(input: string) {
    return (
      !!this.retained &&
      (input === this.retained.input || isContinueInput(input))
    )
  }

  continuationFor(
    input: string,
    owner: string | null,
    mode: AssistantMode,
    conversationId: string | null
  ): Readonly<AssistantTaskAttempt> | null {
    return this.retained?.owner === owner &&
      this.retained.mode === mode &&
      this.retained.conversationId === conversationId &&
      this.canContinue(input)
      ? this.retained
      : null
  }

  private invalidate() {
    this.epoch++
    this.active?.request.abort()
    this.active = null
  }

  private async persist(
    attempt: AssistantTaskAttempt,
    state: AssistantTaskResumeState
  ) {
    const continuation = attempt.continuation
    if (!continuation?.taskId || !attempt.modelKey) return
    await saveAssistantResume(attempt.owner, {
      taskId: continuation.taskId,
      mode: attempt.mode,
      userMessageId: attempt.userId,
      replyMessageId: attempt.replyId,
      conversationId: attempt.conversationId,
      input: attempt.input,
      locale: attempt.locale ?? 'en',
      modelKey: attempt.modelKey,
      state,
      payload: encodeSavedAssistantRequest({
        history: attempt.history,
        attachments: attempt.attachments ?? [],
        locale: attempt.locale ?? 'en',
        continuation,
      }),
    })
  }

  discard() {
    const previous = this.retained
    this.retained = null
    if (previous?.continuation?.taskId)
      void clearAssistantResume(
        previous.owner,
        previous.continuation.taskId
      ).catch(() => this.onPersistenceError(previous.owner))
  }

  stop(preserve: boolean) {
    const previous = this.retained
    this.invalidate()
    if (!preserve) this.discard()
    else {
      this.retained = null
      if (previous)
        void this.persist(
          previous,
          previous.awaitingResources ? 'awaitingResources' : 'paused'
        ).catch(() => this.onPersistenceError(previous.owner))
    }
  }

  pause() {
    const attempt = this.retained
    if (!attempt) return null
    attempt.paused = true
    if (this.active?.executing) {
      this.active.pause.abort()
      return { phase: 'pausing' as const, input: attempt.input }
    }
    this.invalidate()
    return { phase: 'idle' as const, input: attempt.input }
  }

  restore(
    owner: string,
    recovered: AssistantTaskResumeRecovery
  ): Readonly<AssistantTaskAttempt> {
    const { record, files } = recovered
    const saved = decodeSavedAssistantRequest(record)
    if (!saved) throw new Error('Invalid assistant task checkpoint')
    saved.continuation.recoveryFiles = files
    const attempt: AssistantTaskAttempt = {
      owner,
      mode: record.mode,
      input: record.input,
      conversationId: record.conversationId,
      userId: record.userMessageId,
      replyId: record.replyMessageId,
      history: saved.history,
      wholePlan: null,
      continuation: saved.continuation,
      paused: true,
      awaitingResources: record.state === 'awaitingResources',
      modelKey: record.modelKey,
      locale: saved.locale,
      attachments: saved.attachments,
    }
    this.retained = attempt
    return attempt
  }

  /** Inspect recovery before deleting chat content. A load failure cannot mean
   * "no task", which could let a deleted chat reappear on the next restart. */
  async beforeChatRemoval(owner: string, removedIds: ReadonlySet<string>) {
    const recovered = await loadAssistantResume(owner)
    if (
      recovered &&
      (removedIds.has(recovered.record.replyMessageId) ||
        removedIds.has(recovered.record.userMessageId))
    )
      await clearAssistantResume(owner, recovered.record.taskId)
  }

  removeChatReferences(
    removedIds: ReadonlySet<string>,
    activeDeleted: boolean,
    promotedId: string | null
  ) {
    const attempt = this.retained
    const invalidated =
      !!attempt &&
      (activeDeleted ||
        removedIds.has(attempt.userId) ||
        removedIds.has(attempt.replyId) ||
        attempt.history.some(message => removedIds.has(message.id)))
    if (invalidated) this.discard()
    else if (attempt && attempt.conversationId === promotedId)
      attempt.conversationId = null
    return invalidated
  }

  start(attempt: AssistantTaskAttempt | null) {
    this.invalidate()
    const previous = this.retained
    const sameTask =
      !!previous &&
      !!attempt &&
      previous.owner === attempt.owner &&
      previous.mode === attempt.mode &&
      previous.input === attempt.input &&
      previous.userId === attempt.userId &&
      previous.replyId === attempt.replyId &&
      previous.modelKey === attempt.modelKey &&
      previous.locale === attempt.locale
    if (previous !== attempt && !sameTask) this.discard()
    this.retained = attempt
    const active = {
      request: new AbortController(),
      pause: new AbortController(),
      executing: attempt === null,
    }
    this.active = active
    const current = this.fence()
    let publicationFailed = false
    return {
      signal: active.request.signal,
      pauseSignal: active.pause.signal,
      isCurrent: current,
      activate: (
        conversationId: string | null,
        history: AssistantMessage[],
        attachments: AssistantHistoryAttachment[]
      ) => {
        if (!current()) return
        active.executing = true
        if (attempt)
          Object.assign(attempt, { conversationId, history, attachments })
      },
      checkpoint: async (continuation: AssistantContinuation | null) => {
        if (!current() || !attempt || !continuation) return
        attempt.continuation = continuation
        try {
          await this.persist(
            attempt,
            attempt.awaitingResources
              ? 'awaitingResources'
              : attempt.paused
                ? 'paused'
                : 'running'
          )
        } catch (error) {
          publicationFailed = true
          if (current()) this.onPersistenceError(attempt.owner)
          throw error
        }
      },
      waitForResources: async () => {
        if (!current() || !attempt) return
        attempt.awaitingResources = true
        try {
          await this.persist(attempt, 'awaitingResources')
        } catch (error) {
          publicationFailed = true
          if (current()) this.onPersistenceError(attempt.owner)
          throw error
        }
      },
      complete: async (commitChat: () => Promise<boolean>) => {
        if (!current()) return
        const taskId = attempt?.continuation?.taskId
        if (this.retained === attempt) this.retained = null
        // Chat persistence is a separate adapter. Its successful publication
        // is required before the matching execution checkpoint can be cleared.
        if (!(await commitChat()) || !attempt || !taskId) return
        try {
          await clearAssistantResume(attempt.owner, taskId)
        } catch {
          if (current()) this.onPersistenceError(attempt.owner)
        }
      },
      fail: async (code: AssistantErrorCode) => {
        const paused = !!attempt?.paused && code === 'cancelled'
        if (!current()) return { paused: false, canContinue: false }
        if (!paused && !resumableErrors.includes(code) && !publicationFailed)
          this.discard()
        const retained = this.retained
        if (retained?.continuation) {
          retained.continuation.interruption = code
          try {
            await this.persist(retained, paused ? 'paused' : 'failed')
          } catch {
            if (current()) this.onPersistenceError(retained.owner)
          }
        }
        return {
          paused,
          canContinue: !!retained && (paused || retained.continuation !== null),
        }
      },
      release: () => {
        if (current() && this.active === active) this.active = null
      },
    }
  }
}
