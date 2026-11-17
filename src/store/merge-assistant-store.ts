import { create } from 'zustand'
import { currentResolvedLanguage } from '@/i18n/config'
import {
  commands,
  type AssistantQuestionAnswer,
  type GitMergeAssistantTask,
} from '@/lib/tauri-bindings'
import { AssistantFlowError } from '@/lib/assistant-types'
import { assistantModelTransport } from '@/lib/assistant-flow'
import {
  answerMergeAssistantQuestion,
  mergeAssistantResult,
  nativeMergeAssistantDependencies,
  type MergeAssistantScope,
} from '@/lib/merge-assistant-dependencies'
import { runMergeAssistantRequest } from '@/lib/merge-assistant-flow'
import {
  registerMergeAssistantStop,
  useCreationMergeStore,
} from './creation-merge-store'

interface MergeAssistantState {
  scope: MergeAssistantScope | null
  input: string
  tasks: GitMergeAssistantTask[]
  activeTaskId: string | null
  phase: 'idle' | 'starting' | 'running' | 'waiting' | 'stopping'
  response: string
  loading: boolean
  error: string | null
  activate: (identity: string, candidateId: string) => Promise<void>
  setInput: (input: string) => void
  send: () => Promise<void>
  resume: () => Promise<void>
  answer: (questionId: string, answer: AssistantQuestionAnswer) => Promise<void>
  stop: () => Promise<void>
  undo: () => Promise<void>
}

let epoch = 0
let active: {
  scope: MergeAssistantScope
  controller: AbortController
  finished: Promise<void>
} | null = null
let stopping: Promise<void> | null = null
let pendingAction: Promise<void> | null = null

function releaseExecution(controller: AbortController) {
  if (active?.controller === controller) active = null
}

function same(a: MergeAssistantScope | null, b: MergeAssistantScope | null) {
  return (
    !!a && !!b && a.identity === b.identity && a.candidateId === b.candidateId
  )
}

function current(scope: MergeAssistantScope, generation: number) {
  const merge = useCreationMergeStore.getState()
  return (
    generation === epoch &&
    same(useMergeAssistantStore.getState().scope, scope) &&
    merge.identity === scope.identity &&
    merge.candidate?.id === scope.candidateId
  )
}

function dependencies(scope: MergeAssistantScope) {
  return nativeMergeAssistantDependencies(scope, async () => {
    const state = useCreationMergeStore.getState()
    if (
      state.identity === scope.identity &&
      state.candidate?.id === scope.candidateId
    )
      await state.refresh()
  })
}

function failure(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2048) : 'requestFailed'
}

async function execute(input: string, resume?: GitMergeAssistantTask) {
  const state = useMergeAssistantStore.getState(),
    scope = state.scope
  if (!scope || active || stopping) return
  const generation = epoch,
    controller = new AbortController()
  const publish = (task: GitMergeAssistantTask) => {
    if (!current(scope, generation)) return
    useMergeAssistantStore.setState(state => ({
      activeTaskId: task.id,
      tasks: [...state.tasks.filter(item => item.id !== task.id), task].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
      ),
      response: task.response,
    }))
  }
  useMergeAssistantStore.setState({
    phase: 'starting',
    error: null,
    input: '',
    response: '',
  })
  const finished = (async () => {
    try {
      if (!resume) await useCreationMergeStore.getState().saveAll()
      if (!current(scope, generation) || controller.signal.aborted) return
      useMergeAssistantStore.setState({ phase: 'running' })
      const result = await runMergeAssistantRequest(
        {
          ...scope,
          input,
          questionScope: resume?.scope ?? {
            chatId: `merge:${scope.candidateId}`,
            messageId: crypto.randomUUID(),
          },
          locale: currentResolvedLanguage() === 'zh-CN' ? 'zh-CN' : 'en',
          signal: controller.signal,
          isCurrent: () => current(scope, generation),
          history: useMergeAssistantStore.getState().tasks,
          resume,
          onTask: publish,
          onText: text => {
            if (current(scope, generation) && !controller.signal.aborted)
              useMergeAssistantStore.setState({ response: text })
          },
        },
        dependencies(scope)
      )
      if (current(scope, generation) && !controller.signal.aborted)
        useMergeAssistantStore.setState({
          phase: result.question ? 'waiting' : 'idle',
          activeTaskId: result.question ? result.task.id : null,
        })
    } catch (error) {
      if (current(scope, generation))
        useMergeAssistantStore.setState(state => ({
          phase: controller.signal.aborted ? 'stopping' : 'idle',
          activeTaskId:
            useCreationMergeStore.getState().candidate?.assistantOwner ?? null,
          input: state.input || input,
          error:
            controller.signal.aborted ||
            (error instanceof AssistantFlowError && error.code === 'cancelled')
              ? null
              : failure(error),
        }))
    } finally {
      releaseExecution(controller)
      if (
        current(scope, generation) &&
        useMergeAssistantStore.getState().phase === 'starting'
      )
        useMergeAssistantStore.setState({ phase: 'idle' })
    }
  })()
  active = { scope, controller, finished }
  await finished
}

export const useMergeAssistantStore = create<MergeAssistantState>(
  (set, get) => ({
    scope: null,
    input: '',
    tasks: [],
    activeTaskId: null,
    phase: 'idle',
    response: '',
    loading: false,
    error: null,
    activate: async (identity, candidateId) => {
      const scope = { identity, candidateId }
      if (same(get().scope, scope)) return
      // Merely opening the candidate tab never stops a restored owned round.
      // Workspace transitions already await the registered cleanup participant.
      if (active) await get().stop()
      const generation = ++epoch
      set({
        scope,
        input: '',
        tasks: [],
        activeTaskId: null,
        phase: 'idle',
        response: '',
        loading: true,
        error: null,
      })
      try {
        const tasks = mergeAssistantResult(
          await commands.getGitMergeAssistantTasks(identity, candidateId)
        )
        if (!current(scope, generation)) return
        const candidate = useCreationMergeStore.getState().candidate
        const task =
          tasks.find(item => item.id === candidate?.assistantOwner) ??
          (candidate?.relation === 'fastForward'
            ? [...tasks]
                .reverse()
                .find(
                  item => item.state === 'waiting' || item.state === 'running'
                )
            : undefined)
        set({
          tasks,
          activeTaskId: task?.id ?? null,
          phase: task?.state === 'waiting' ? 'waiting' : 'idle',
          input: task
            ? ''
            : tasks.at(-1)?.state === 'failed'
              ? (tasks.at(-1)?.input ?? '')
              : '',
        })
      } catch (error) {
        if (current(scope, generation)) set({ error: failure(error) })
      } finally {
        if (current(scope, generation)) set({ loading: false })
      }
    },
    setInput: input => set({ input }),
    send: async () => {
      const state = get(),
        candidate = useCreationMergeStore.getState().candidate
      if (
        state.phase !== 'idle' ||
        !state.input.trim() ||
        !candidate ||
        useCreationMergeStore.getState().busy ||
        candidate.phase !== 'active' ||
        candidate.assistantOwner
      )
        return
      await execute(state.input.trim())
    },
    resume: async () => {
      const state = get(),
        task = state.tasks.find(item => item.id === state.activeTaskId)
      if (
        state.phase !== 'idle' ||
        useCreationMergeStore.getState().busy ||
        !task?.checkpoint ||
        task.questions.some(question => question.status === 'pending')
      )
        return
      await execute(task.input, task)
    },
    answer: async (questionId, answer) => {
      const state = get(),
        scope = state.scope,
        task = state.tasks.find(item => item.id === state.activeTaskId)
      if (
        !scope ||
        pendingAction ||
        stopping ||
        state.phase !== 'waiting' ||
        !task?.questions.some(
          question =>
            question.id === questionId && question.status === 'pending'
        )
      )
        return
      set({ phase: 'starting', error: null })
      const pending = (async () => {
        try {
          const updated = await answerMergeAssistantQuestion(
            scope,
            task.id,
            questionId,
            answer
          )
          if (!same(get().scope, scope) || stopping) return
          set(state => ({
            tasks: state.tasks.map(item =>
              item.id === updated.id ? updated : item
            ),
            phase: 'idle',
          }))
          await execute(updated.input, updated)
        } catch (error) {
          if (same(get().scope, scope) && !stopping)
            set({ phase: 'waiting', error: failure(error) })
        }
      })()
      pendingAction = pending
      try {
        await pending
      } finally {
        if (pendingAction === pending) pendingAction = null
      }
    },
    stop: async () => {
      if (stopping) return stopping
      stopping = (async () => {
        const executing = active
        const prior = get(),
          root = useCreationMergeStore.getState()
        const scope =
          executing?.scope ??
          (root.identity && root.candidate
            ? { identity: root.identity, candidateId: root.candidate.id }
            : prior.scope)
        if (!scope) return
        set({ phase: 'stopping' })
        executing?.controller.abort()
        const drain = (async () => {
          const merge = useCreationMergeStore.getState()
          if (
            merge.identity === scope.identity &&
            merge.candidate?.id === scope.candidateId
          ) {
            const tasks = mergeAssistantResult(
              await commands.getGitMergeAssistantTasks(
                scope.identity,
                scope.candidateId
              )
            )
            const taskIds = [
              merge.candidate.assistantOwner,
              same(get().scope, scope) ? get().activeTaskId : null,
              ...tasks
                .filter(
                  task => task.state === 'running' || task.state === 'waiting'
                )
                .map(task => task.id),
            ].filter((value): value is string => !!value)
            // A stale/reopened candidate can have cleared its core owner while a
            // previously issued provider request still needs explicit cancellation.
            for (const taskId of new Set(taskIds)) {
              const task = tasks.find(item => item.id === taskId)
              if (task?.requestId)
                await assistantModelTransport.cancel(task.requestId)
              await dependencies(scope).end(taskId)
            }
            if (same(get().scope, scope)) {
              try {
                const tasks = mergeAssistantResult(
                  await commands.getGitMergeAssistantTasks(
                    scope.identity,
                    scope.candidateId
                  )
                )
                set({ tasks })
              } catch (error) {
                set({ error: failure(error) })
              }
            }
          }
        })()
        // Start native retirement/cancellation immediately so a bounded check
        // can be interrupted; still wait for every local callback before handoff.
        await Promise.all([drain, executing?.finished, pendingAction])
        set({ phase: 'idle', activeTaskId: null })
      })()
        .catch(error => {
          set({ error: failure(error), phase: 'idle' })
          throw error
        })
        .finally(() => {
          stopping = null
        })
      return stopping
    },
    undo: async () => {
      const state = get(),
        scope = state.scope,
        merge = useCreationMergeStore.getState(),
        candidate = merge.candidate
      if (
        !scope ||
        !candidate ||
        merge.busy ||
        pendingAction ||
        stopping ||
        state.phase !== 'idle' ||
        !candidate.canUndo ||
        candidate.assistantOwner
      )
        return
      set({ phase: 'starting', error: null })
      const pending = (async () => {
        try {
          await merge.saveAll()
          const current = useCreationMergeStore.getState().candidate
          if (!current || current.id !== scope.candidateId || stopping) return
          mergeAssistantResult(
            await commands.undoGitMergeAssistant(
              scope.identity,
              scope.candidateId,
              current.revision
            )
          )
          await merge.refresh()
        } catch (error) {
          set({ error: failure(error) })
        } finally {
          if (same(get().scope, scope) && !stopping) set({ phase: 'idle' })
        }
      })()
      pendingAction = pending
      try {
        await pending
      } finally {
        if (pendingAction === pending) pendingAction = null
      }
    },
  })
)

registerMergeAssistantStop(() => useMergeAssistantStore.getState().stop())
