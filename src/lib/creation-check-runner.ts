import {
  commands,
  type ControlledCheckOptions,
  type CreationCheckTask,
  type CreationError,
} from './tauri-bindings'
import { logger } from './logger'

type Submission =
  | { kind: 'manual'; options: () => Promise<ControlledCheckOptions> }
  | { kind: 'assistant'; taskId: string }
  | { kind: 'assistantTests'; taskId: string }

interface Observer {
  onTask?: (task: CreationCheckTask) => void
  // The manual dialog retains transient polling errors and keeps collecting
  // cleanup. Assistant execution instead returns the typed failure to its loop.
  onPollError?: (error: CreationError) => void
}

export interface CheckFreshness {
  status: 'fresh' | 'stale' | 'unknown'
  error?: CreationError
}

export class CreationCheckFailure extends Error {
  constructor(readonly error: CreationError) {
    super(error.detail)
  }
}

function failure(cause: unknown): CreationError {
  return cause instanceof CreationCheckFailure
    ? cause.error
    : {
        code: 'io',
        detail: cause instanceof Error ? cause.message : String(cause),
      }
}

function unwrap<T>(
  result: { status: 'ok'; data: T } | { status: 'error'; error: CreationError }
): T {
  if (result.status === 'error') throw new CreationCheckFailure(result.error)
  return result.data
}

/** One frontend owner of a native check. Product policy stays with the caller;
 * native commands continue to own authorization, the runtime lease and cleanup. */
export class CreationCheckRunner {
  private epoch = 0
  private disposed = false
  private running = false
  private taskId: string | null = null
  private cancelRequested = false
  private cancellation: Promise<void> | null = null
  private readonly lifetime = new AbortController()
  private readonly watchers = new Set<() => void>()

  constructor(
    private readonly identity: string,
    private readonly isCurrent: () => boolean
  ) {}

  get active() {
    return this.running
  }

  private current(epoch = this.epoch) {
    return !this.disposed && this.epoch === epoch && this.isCurrent()
  }

  private cancelNative(taskId: string) {
    return commands.cancelCreationCheck(taskId).then(result => {
      unwrap(result)
    })
  }

  async cancel(): Promise<void> {
    if (!this.running) return
    this.cancelRequested = true
    if (!this.taskId) return
    if (!this.cancellation) {
      this.cancellation = this.cancelNative(this.taskId).catch(cause => {
        this.cancellation = null
        throw cause
      })
    }
    await this.cancellation
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.lifetime.abort()
    for (const stop of this.watchers) stop()
    await this.cancel()
  }

  private wait() {
    return new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(timer)
        this.lifetime.signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, 300)
      this.lifetime.signal.addEventListener('abort', done, { once: true })
      if (this.lifetime.signal.aborted) done()
    })
  }

  async run(
    submission: Submission,
    observer: Observer = {}
  ): Promise<CreationCheckTask | null> {
    if (this.running || !this.current()) return null
    for (const stop of this.watchers) stop()
    const epoch = ++this.epoch
    this.running = true
    this.taskId = null
    this.cancelRequested = false
    this.cancellation = null
    let completed = false
    try {
      let started: Awaited<ReturnType<typeof commands.startCreationCheck>>
      if (submission.kind === 'manual') {
        const options = await submission.options()
        if (!this.current(epoch) || this.cancelRequested) return null
        started = await commands.startCreationCheck(this.identity, options)
      } else if (submission.kind === 'assistantTests') {
        started = await commands.startAssistantTests(
          this.identity,
          submission.taskId
        )
      } else {
        started = await commands.startAssistantCheck(
          this.identity,
          submission.taskId
        )
      }
      const taskId = unwrap(started)
      this.taskId = taskId
      if (!this.current(epoch) || this.cancelRequested) await this.cancel()
      if (!this.current(epoch)) return null
      observer.onTask?.({
        identity: this.identity,
        taskId,
        progress: null,
        report: null,
      })
      while (this.current(epoch)) {
        let task: CreationCheckTask
        try {
          task = unwrap(await commands.getCreationCheck(this.identity, taskId))
        } catch (cause) {
          if (!this.current(epoch)) return null
          if (!observer.onPollError) throw cause
          observer.onPollError(failure(cause))
          await this.wait()
          continue
        }
        if (!this.current(epoch)) return null
        if (
          task.identity !== this.identity ||
          task.taskId !== taskId ||
          (task.report && task.report.taskId !== taskId) ||
          (task.progress && task.progress.taskId !== taskId)
        )
          throw new CreationCheckFailure({
            code: 'invalidIdentity',
            detail: 'The check reply belongs to another workspace or task',
          })
        observer.onTask?.(task)
        if (task.report) {
          completed = true
          return task
        }
        await this.wait()
      }
      return null
    } catch (cause) {
      if (!this.current(epoch)) return null
      throw new CreationCheckFailure(failure(cause))
    } finally {
      if (!completed && this.taskId) {
        try {
          await this.cancel()
        } catch (cause) {
          logger.warn('Controlled-check cancellation failed', {
            taskId: this.taskId,
            error: failure(cause),
          })
        }
      }
      this.running = false
    }
  }

  /** Native content evidence remains authoritative, including restored receipts.
   * A failed or superseded verification never becomes a fresh result. */
  async freshness(taskId: string): Promise<CheckFreshness> {
    const epoch = this.epoch
    if (!this.current(epoch)) return { status: 'unknown' }
    try {
      const stale = unwrap(
        await commands.creationCheckIsStale(this.identity, taskId)
      )
      return this.current(epoch)
        ? { status: stale ? 'stale' : 'fresh' }
        : { status: 'unknown' }
    } catch (cause) {
      return this.current(epoch)
        ? { status: 'unknown', error: failure(cause) }
        : { status: 'unknown' }
    }
  }

  /** The dialog watches only while visible; assistant policy asks once when
   * completing or reusing a receipt. Neither path submits another check. */
  watchFreshness(taskId: string, publish: (result: CheckFreshness) => void) {
    if (!this.current()) return () => undefined
    const epoch = this.epoch
    let live = true
    let checking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const current = () => live && this.current(epoch)
    const check = async () => {
      if (checking || !current()) return
      checking = true
      clearTimeout(timer)
      try {
        const result = await this.freshness(taskId)
        if (current()) publish(result)
      } finally {
        checking = false
        if (current()) timer = setTimeout(() => void check(), 10_000)
      }
    }
    const focused = () => void check()
    const stop = () => {
      live = false
      clearTimeout(timer)
      window.removeEventListener('focus', focused)
      this.watchers.delete(stop)
    }
    this.watchers.add(stop)
    void check()
    window.addEventListener('focus', focused)
    return stop
  }
}
