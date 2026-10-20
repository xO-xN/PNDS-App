import { commands } from '@/lib/tauri-bindings'
import { create } from 'zustand'
import { useAssistantHandoffStore } from './assistant-handoff-store'
import { currentResolvedLanguage } from '@/i18n/config'
import { loadPreferences } from '@/lib/preferences'
import type {
  AssistantMode,
  AssistantResourcePlan,
  AssistantResourceDecision,
  ContextMeasurement,
  ModelServiceConfig,
  AssistantProjectSnapshot,
} from '@/lib/tauri-bindings'
import {
  clearAssistantResume,
  flushAssistantResume,
  loadAssistantResume,
} from '@/lib/assistant-resume'
import type {
  AssistantSummarySections,
  AssistantRoundUsage,
} from '@/lib/tauri-bindings'
import { parseAssistantSummary, summaryInput } from '@/lib/assistant-context'
import {
  assistantConversations,
  conversationMessages,
  appendConversationMessages,
  forkConversationPrefix,
  removeConversation,
} from '@/lib/assistant-conversations'
import { modelProfileKey } from '@/lib/model-context-settings'
import i18n from '@/i18n/config'
import { AssistantFlowError, runAssistantRequest } from '@/lib/assistant-flow'
import {
  AssistantTaskLifecycle,
  type AssistantTaskAttempt,
} from '@/lib/assistant-task-lifecycle'
import type {
  AssistantErrorCode,
  AssistantMessage,
  AssistantContextConsumer,
} from '@/lib/assistant-types'
import { useCreationStore } from './creation-store'
import { useCreationReadingStore } from './creation-reading-store'
import { useAssistantProjectStore } from './assistant-project-store'
import { useAssistantOverviewStore } from './assistant-overview-store'
import { useAssistantProposalStore } from './assistant-proposal-store'
import { modelConfigurationKey } from '@/lib/model-context-settings'
import {
  AssistantHistoryFailure,
  clearAssistantHistory,
  flushAssistantHistory,
  loadAssistantHistory,
  queueAssistantHistorySave,
  restoreAssistantMessages,
  type AssistantHistoryErrorCode,
} from '@/lib/assistant-history'

interface QuestionEdit {
  messageId: string
  previousInput: string
}

interface AssistantState {
  mode: AssistantMode
  setMode: (mode: AssistantMode) => void
  owner: string | null
  input: string
  submittedInput: string | null
  messages: AssistantMessage[]
  activeConversationId: string | null
  conversationDrafts: Record<
    string,
    { input: string; editing: QuestionEdit | null }
  >
  editing: QuestionEdit | null
  beginEditing: (messageId: string) => void
  cancelEditing: () => void
  switchConversation: (id: string | null) => void
  deleteConversation: (id: string | null) => Promise<boolean>
  phase:
    | 'idle'
    | 'reading'
    | 'responding'
    | 'compacting'
    | 'continuing'
    | 'pausing'
  paused: boolean
  resourceApproval: {
    taskId: string
    replyId: string
    plan: AssistantResourcePlan
  } | null
  resourceApprovalBusy: boolean
  decideResourceApproval: (
    decision: Exclude<AssistantResourceDecision, 'pending'>
  ) => Promise<void>
  resumeRestored: boolean
  resumeError: boolean
  restoreTask: (activate?: boolean) => Promise<void>
  error: AssistantErrorCode | null
  canContinue: boolean
  configured: boolean | null
  modelConfig: ModelServiceConfig | null
  contextMeasurement: ContextMeasurement | null
  organizing: boolean
  summaryDraft: {
    sections: AssistantSummarySections
    sourceIds: string[]
    serviceKey: string
    usage: AssistantRoundUsage | null
    isCurrent: () => boolean
    scope: AssistantMessage['scope']
  } | null
  summaryText: string
  organizeContext: (roundLimit?: number) => Promise<void>
  acceptSummary: () => void
  discardSummary: () => void
  newTopic: () => void
  historyState: 'loading' | 'ready' | 'error'
  historyBusy: boolean
  historySaving: boolean
  historyError: AssistantHistoryErrorCode | null
  historySaveError: AssistantHistoryErrorCode | null
  historyEpoch: string | null
  historyProjectKey: string | null
  historyAppVersion: string | null
  historicalMessageIds: string[]
  retryHistory: () => Promise<void>
  persistHistory: () => Promise<void>
  clearHistory: () => Promise<void>
  syncWorkspace: (identity: string | null) => void
  refreshConfiguration: () => Promise<void>
  setInput: (input: string) => void
  send: (whole?: boolean, continueTask?: boolean) => Promise<void>
  stop: (preserveTask?: boolean) => void
  pause: () => void
  returnToMessage: (messageId: string) => void
}

let configurationGeneration = 0
let historyGeneration = 0
let saveSequence = 0
const taskLifecycle = new AssistantTaskLifecycle(owner => {
  if (useAssistantStore.getState().owner === owner)
    useAssistantStore.setState({ resumeError: true })
})

const initialHistory = () => ({
  historyState: 'loading' as const,
  historyBusy: false,
  historySaving: false,
  historyError: null,
  historySaveError: null,
  historyEpoch: null,
  historyProjectKey: null,
  historyAppVersion: null,
  historicalMessageIds: [],
})
const historyFailure = (error: unknown): AssistantHistoryErrorCode =>
  error instanceof AssistantHistoryFailure ? error.code : 'io'

export const useAssistantStore = create<AssistantState>((set, get) => ({
  mode: 'handoff',
  setMode: mode => {
    if (
      get().phase === 'idle' &&
      !get().resourceApproval &&
      !get().historyBusy &&
      mode !== get().mode
    ) {
      taskLifecycle.discard()
      set({ mode, canContinue: false, paused: false, resumeRestored: false })
    }
  },
  owner: null,
  input: '',
  submittedInput: null,
  messages: [],
  activeConversationId: null,
  conversationDrafts: {},
  editing: null,
  phase: 'idle',
  paused: false,
  resourceApproval: null,
  resourceApprovalBusy: false,
  resumeRestored: false,
  resumeError: false,
  error: null,
  canContinue: false,
  configured: null,
  modelConfig: null,
  contextMeasurement: null,
  organizing: false,
  summaryDraft: null,
  summaryText: '',
  ...initialHistory(),
  syncWorkspace: owner => {
    if (get().owner === owner) return
    get().stop(true)
    useAssistantProjectStore.getState().syncWorkspace(owner)
    useAssistantOverviewStore.getState().syncWorkspace(owner)
    configurationGeneration += 1
    historyGeneration += 1
    set({
      mode: 'handoff',
      owner,
      input: '',
      submittedInput: null,
      messages: [],
      activeConversationId: null,
      conversationDrafts: {},
      editing: null,
      phase: 'idle',
      error: null,
      configured: null,
      modelConfig: null,
      contextMeasurement: null,
      organizing: false,
      summaryDraft: null,
      summaryText: '',
      resumeRestored: false,
      resumeError: false,
      ...initialHistory(),
    })
    if (owner) {
      void get().retryHistory()
      void get().refreshConfiguration()
    }
  },
  retryHistory: async () => {
    const owner = get().owner
    if (!owner) return
    get().stop(true)
    useAssistantProposalStore.getState().clear()
    const token = ++historyGeneration
    set({
      historyState: 'loading',
      historyBusy: true,
      historySaving: false,
      historyError: null,
      historySaveError: null,
      summaryText: '',
    })
    try {
      const history = await loadAssistantHistory(owner)
      if (get().owner !== owner || token !== historyGeneration) return
      const messages = restoreAssistantMessages(history)
      set({
        messages,
        activeConversationId:
          assistantConversations(messages).at(-1)?.id ?? null,
        conversationDrafts: {},
        editing: null,
        phase: 'idle',
        historyState: 'ready',
        historyBusy: true,
        historySaving: false,
        historyEpoch: history.epoch,
        historyProjectKey: history.projectKey,
        historyAppVersion: history.appVersion,
        historicalMessageIds: messages.map(message => message.id),
      })
      await get().restoreTask(true)
    } catch (error) {
      if (get().owner === owner && token === historyGeneration)
        set({
          historyState: 'error',
          historyBusy: false,
          historyError: historyFailure(error),
        })
    }
  },
  restoreTask: async (activate = false) => {
    const owner = get().owner
    if (!owner || get().phase !== 'idle' || get().historyState !== 'ready')
      return
    const currentTask = taskLifecycle.fence()
    const historyToken = historyGeneration
    const draft = get().input
    set({ historyBusy: true })
    try {
      const recovered = await loadAssistantResume(owner)
      if (
        !recovered ||
        get().owner !== owner ||
        !currentTask() ||
        get().input !== draft ||
        get().phase !== 'idle'
      )
        return
      const { record } = recovered
      if (!activate && record.conversationId !== get().activeConversationId)
        return
      if (
        get().messages.some(
          message =>
            message.id === record.replyMessageId &&
            message.status === 'completed'
        )
      ) {
        await clearAssistantResume(owner, record.taskId)
        return
      }
      const resourcePlans = await commands.getCreationAssistantResourcePlans(
        owner,
        record.taskId
      )
      if (resourcePlans.status === 'error')
        throw new Error(resourcePlans.error.code)
      if (get().owner !== owner || !currentTask() || get().phase !== 'idle')
        return
      const pendingPlan = resourcePlans.data.find(
        plan => plan.decision === 'pending'
      )
      const restored = taskLifecycle.restore(owner, recovered)
      const continuation = restored.continuation
      if (!continuation) throw new Error('Missing assistant task checkpoint')
      // A checkpoint can reach disk before the corresponding chat snapshot.
      // Restore missing display entries without submitting a new user input.
      let messages = get().messages
      if (
        record.conversationId &&
        !messages.some(message => message.id === record.conversationId)
      ) {
        const index = messages.findIndex(
          message =>
            message.id === record.userMessageId ||
            message.id === record.replyMessageId
        )
        const position = index < 0 ? messages.length : index
        const marker: AssistantMessage = {
          id: record.conversationId,
          role: 'assistant',
          text: i18n.t('assistant.context.topicRecord'),
          scope: 'platform',
          status: 'completed',
          sources: [],
          contextMarker: { type: 'topic' },
        }
        messages = [
          ...messages.slice(0, position),
          marker,
          ...messages.slice(position),
        ]
      }
      const missing: AssistantMessage[] = []
      if (!messages.some(message => message.id === record.userMessageId))
        missing.push({
          id: record.userMessageId,
          role: 'user',
          text: record.input,
          scope: 'project',
          status: 'cancelled',
          sources: [],
        })
      if (!messages.some(message => message.id === record.replyMessageId))
        missing.push({
          id: record.replyMessageId,
          role: 'assistant',
          text: continuation.text,
          activity: continuation.activity,
          scope: 'project',
          status: 'cancelled',
          sources: continuation.sources,
        })
      const missingUser = missing.find(message => message.role === 'user')
      const replyIndex = messages.findIndex(
        message => message.id === record.replyMessageId
      )
      if (missingUser && replyIndex >= 0) {
        messages = [
          ...messages.slice(0, replyIndex),
          missingUser,
          ...messages.slice(replyIndex),
        ]
        missing.splice(missing.indexOf(missingUser), 1)
      }
      const missingReply = missing.find(message => message.role === 'assistant')
      const userIndex = messages.findIndex(
        message => message.id === record.userMessageId
      )
      if (missingReply && userIndex >= 0) {
        messages = [
          ...messages.slice(0, userIndex + 1),
          missingReply,
          ...messages.slice(userIndex + 1),
        ]
        missing.splice(missing.indexOf(missingReply), 1)
      }
      messages = appendConversationMessages(
        messages,
        record.conversationId,
        missing
      )
      set({
        messages,
        activeConversationId: record.conversationId,
        mode: record.mode,
        input: pendingPlan ? draft : record.input,
        paused: !pendingPlan,
        canContinue: !pendingPlan,
        resourceApproval: pendingPlan
          ? {
              taskId: record.taskId,
              replyId: record.replyMessageId,
              plan: pendingPlan,
            }
          : null,
        resourceApprovalBusy: false,
        resumeRestored: true,
        resumeError: false,
        error: null,
      })
    } catch {
      if (get().owner === owner && currentTask()) set({ resumeError: true })
    } finally {
      if (get().owner === owner && historyGeneration === historyToken)
        set({ historyBusy: false })
    }
  },
  persistHistory: async () => {
    const { owner, historyEpoch, historyState, historyBusy, messages } = get()
    if (!owner || !historyEpoch || historyState !== 'ready' || historyBusy)
      return
    const token = historyGeneration
    const save = ++saveSequence
    const owns = () =>
      get().owner === owner &&
      historyGeneration === token &&
      get().historyEpoch === historyEpoch &&
      saveSequence === save
    set({ historySaving: true })
    try {
      await queueAssistantHistorySave(owner, historyEpoch, messages)
      if (owns()) set({ historySaving: false, historySaveError: null })
    } catch (error) {
      if (owns())
        set({ historySaving: false, historySaveError: historyFailure(error) })
    }
  },
  clearHistory: async () => {
    const owner = get().owner
    if (!owner || get().historyBusy) return
    get().stop()
    const token = ++historyGeneration
    set({ historyBusy: true, historySaving: false, historyError: null })
    try {
      await clearAssistantResume(owner, null)
      const history = await clearAssistantHistory(owner)
      if (get().owner !== owner || token !== historyGeneration) return
      useAssistantProposalStore.getState().clear()
      set({
        messages: [],
        activeConversationId: null,
        conversationDrafts: {},
        editing: null,
        historicalMessageIds: [],
        phase: 'idle',
        error: null,
        historyState: 'ready',
        historyBusy: false,
        historySaveError: null,
        summaryText: '',
        historyEpoch: history.epoch,
        historyProjectKey: history.projectKey,
        historyAppVersion: history.appVersion,
      })
    } catch (error) {
      if (get().owner === owner && token === historyGeneration)
        set({ historyBusy: false, historyError: historyFailure(error) })
    }
  },
  deleteConversation: async id => {
    const state = get()
    const { owner, historyEpoch } = state
    const project = useAssistantProjectStore.getState()
    if (
      !owner ||
      !historyEpoch ||
      state.phase !== 'idle' ||
      state.historyState !== 'ready' ||
      state.historyBusy ||
      state.historySaveError === 'staleHistory' ||
      project.planning ||
      project.whole
    )
      return false
    const candidate = removeConversation(state.messages, id)
    if (!candidate) return false
    const token = historyGeneration
    ++saveSequence
    const owns = () =>
      get().owner === owner &&
      historyGeneration === token &&
      get().historyEpoch === historyEpoch
    set({ historyBusy: true, historySaving: false, historyError: null })
    try {
      await taskLifecycle.beforeChatRemoval(owner, candidate.removedIds)
      if (!owns()) return false
      // Keep the visible transcript until this snapshot reaches the same queue
      // as earlier streaming/proposal saves. Never clear the project's epoch.
      await queueAssistantHistorySave(owner, historyEpoch, candidate.messages)
      if (!owns()) return false
      const latest = get()
      const removed = removeConversation(latest.messages, id)
      if (!removed) return false
      const activeDeleted = latest.activeConversationId === id
      const invalidatesRetry = taskLifecycle.removeChatReferences(
        removed.removedIds,
        activeDeleted,
        removed.promotedId
      )
      const drafts = Object.fromEntries(
        Object.entries(latest.conversationDrafts).filter(
          ([key]) => key !== (id ?? 'original') && key !== removed.promotedId
        )
      )
      if (removed.promotedId) {
        const promotedDraft = latest.conversationDrafts[removed.promotedId]
        if (promotedDraft) drafts.original = promotedDraft
      }
      const activeConversationId = activeDeleted
        ? removed.neighborId
        : latest.activeConversationId === removed.promotedId
          ? null
          : latest.activeConversationId
      const draft = drafts[activeConversationId ?? 'original']
      const invalidatesSummary =
        activeDeleted ||
        latest.summaryDraft?.sourceIds.some(source =>
          removed.removedIds.has(source)
        )
      set({
        messages: removed.messages,
        activeConversationId,
        conversationDrafts: drafts,
        historicalMessageIds: latest.historicalMessageIds.filter(
          messageId => !removed.removedIds.has(messageId)
        ),
        historyBusy: false,
        historySaveError: null,
        ...(activeDeleted
          ? {
              input: draft?.input ?? '',
              editing: draft?.editing ?? null,
              submittedInput: null,
              error: null,
              contextMeasurement: null,
              paused: false,
              canContinue: false,
            }
          : invalidatesRetry
            ? { paused: false, canContinue: false }
            : {}),
        ...(invalidatesSummary ? { summaryDraft: null, summaryText: '' } : {}),
      })
      if (activeDeleted) useAssistantProjectStore.getState().cancelWhole()
      const removedIds = [...removed.removedIds]
      useAssistantProposalStore.getState().removeMessages(removedIds)
      for (const messageId of removedIds)
        useAssistantHandoffStore.getState().dismiss(messageId)
      const reading = useCreationReadingStore.getState()
      if (
        reading.returnMessageId &&
        removed.removedIds.has(reading.returnMessageId)
      )
        useCreationReadingStore.setState({
          returnMessageId: null,
          extension: null,
          ...(reading.view === 'extension'
            ? { view: 'discussion' as const }
            : {}),
        })
      // A retained proposal may publish while saving; preserve and enqueue its
      // newest snapshot rather than replacing it with the captured candidate.
      if (latest.messages !== state.messages) void get().persistHistory()
      return true
    } catch (error) {
      if (owns()) {
        const failure = historyFailure(error)
        set({
          historyBusy: false,
          historyError: failure,
          ...(failure === 'staleHistory' || get().messages !== state.messages
            ? { historySaveError: failure }
            : {}),
        })
      }
      return false
    }
  },
  refreshConfiguration: async () => {
    const owner = get().owner
    const token = ++configurationGeneration
    const prefs = await loadPreferences()
    if (get().owner !== owner || token !== configurationGeneration) return
    const previousConfig = get().modelConfig
    if (
      previousConfig &&
      (!prefs?.modelService ||
        modelConfigurationKey(previousConfig) !==
          modelConfigurationKey(prefs.modelService))
    ) {
      get().stop()
      useAssistantProjectStore.getState().revoke()
    }
    set({
      configured: prefs ? Boolean(prefs.modelService) : null,
      modelConfig: prefs?.modelService ?? null,
      contextMeasurement: null,
      ...(!prefs ? { error: 'requestFailed' as const } : { error: null }),
    })
  },
  setInput: input => {
    // Keep the candidate checkpoint while typing. A different submitted task
    // replaces it; exact continuation text never replaces the original goal.
    set({
      input,
      error: null,
      canContinue: taskLifecycle.canContinue(input),
    })
  },
  beginEditing: messageId => {
    const state = get()
    if (
      state.phase !== 'idle' ||
      !!state.resourceApproval ||
      state.historyBusy ||
      state.historyState !== 'ready' ||
      state.historySaveError === 'staleHistory'
    )
      return
    const message = conversationMessages(
      state.messages,
      state.activeConversationId
    ).find(message => message.id === messageId)
    if (
      !message ||
      message.role !== 'user' ||
      message.attachments?.length ||
      message.proposals?.length
    )
      return
    taskLifecycle.discard()
    set({
      canContinue: false,
      input: message.text,
      editing: {
        messageId,
        previousInput: state.editing?.previousInput ?? state.input,
      },
      error: null,
    })
  },
  cancelEditing: () => {
    const editing = get().editing
    if (editing)
      set({ input: editing.previousInput, editing: null, error: null })
  },
  switchConversation: id => {
    if (!assistantConversations(get().messages).some(chat => chat.id === id))
      return
    if (get().activeConversationId === id || get().historyBusy) return
    get().stop(true)
    set(state => ({
      activeConversationId: id,
      conversationDrafts: {
        ...state.conversationDrafts,
        [state.activeConversationId ?? 'original']: {
          input: state.input,
          editing: state.editing,
        },
      },
      input: state.conversationDrafts[id ?? 'original']?.input ?? '',
      editing: state.conversationDrafts[id ?? 'original']?.editing ?? null,
      error: null,
      summaryText: '',
    }))
    void get().restoreTask()
  },
  newTopic: () => {
    if (
      get().historyState !== 'ready' ||
      get().historyBusy ||
      get().historySaveError === 'staleHistory'
    )
      return
    get().stop()
    const owner = get().owner
    if (owner)
      void clearAssistantResume(owner, null).catch(() => {
        if (get().owner === owner) set({ resumeError: true })
      })
    const id = crypto.randomUUID()
    set(state => ({
      mode: 'handoff',
      activeConversationId: id,
      conversationDrafts: {
        ...state.conversationDrafts,
        [state.activeConversationId ?? 'original']: {
          input: state.input,
          editing: state.editing,
        },
      },
      editing: null,
      messages: [
        ...state.messages,
        {
          id,
          role: 'assistant',
          text: i18n.t('assistant.context.topicRecord'),
          scope: 'platform',
          status: 'completed',
          sources: [],
          contextMarker: { type: 'topic' },
        },
      ],
      error: null,
      summaryText: '',
    }))
    void get().persistHistory()
  },
  organizeContext: async roundLimit => {
    if (get().resourceApproval) return
    const { owner, modelConfig, messages, phase, historyState, historyBusy } =
      get()
    if (
      !owner ||
      !modelConfig ||
      phase !== 'idle' ||
      historyState !== 'ready' ||
      historyBusy
    )
      return
    if (get().historySaveError === 'staleHistory' || get().editing) return
    const prepared = summaryInput(
      conversationMessages(messages, get().activeConversationId),
      modelConfig,
      roundLimit,
      useAssistantProjectStore.getState().snapshot ?? undefined
    )
    if (!prepared.source.length) return
    const execution = taskLifecycle.start(null)
    const owns = () => get().owner === owner && execution.isCurrent()
    let usage: AssistantRoundUsage | null = null
    set({
      phase: 'reading',
      organizing: true,
      summaryDraft: null,
      summaryText: '',
      error: null,
      canContinue: false,
      contextMeasurement: null,
    })
    try {
      const result = await runAssistantRequest({
        identity: owner,
        input: prepared.input,
        history: [],
        locale: currentResolvedLanguage() === 'zh-CN' ? 'zh-CN' : 'en',
        signal: execution.signal,
        isCurrent: owns,
        purpose: 'summary',
        expectedConfig: modelConfig,
        onPhase: phase => {
          if (owns()) set({ phase })
        },
        onText: summaryText => {
          if (owns()) set({ summaryText })
        },
        onContext: contextMeasurement => {
          if (owns()) set({ contextMeasurement })
        },
        onUsage: value => {
          usage = value
        },
      })
      if (!owns()) return
      const sourceIds = prepared.source.map(message => message.id)
      let sections: AssistantSummarySections
      try {
        sections = parseAssistantSummary(result.text, sourceIds)
      } catch {
        throw new AssistantFlowError('invalidSummary')
      }
      set({
        phase: 'idle',
        organizing: false,
        summaryDraft: {
          sections,
          sourceIds,
          serviceKey: modelProfileKey(modelConfig),
          scope: prepared.source.some(message => message.scope === 'project')
            ? 'project'
            : 'platform',
          usage,
          isCurrent: execution.isCurrent,
        },
      })
    } catch (error) {
      if (owns())
        set({
          phase: 'idle',
          organizing: false,
          error:
            error instanceof AssistantFlowError ? error.code : 'requestFailed',
        })
    } finally {
      execution.release()
    }
  },
  acceptSummary: () => {
    const { summaryDraft: draft, modelConfig, phase } = get()
    if (
      !draft ||
      get().historyState !== 'ready' ||
      get().historyBusy ||
      get().historySaveError === 'staleHistory' ||
      !modelConfig ||
      phase !== 'idle' ||
      !draft.isCurrent() ||
      draft.serviceKey !== modelProfileKey(modelConfig)
    )
      return
    set(state => ({
      summaryDraft: null,
      summaryText: '',
      messages: appendConversationMessages(
        state.messages,
        state.activeConversationId,
        [
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: i18n.t('assistant.context.summaryRecord'),
            scope: 'platform',
            status: 'completed',
            sources: [],
            contextMarker: {
              type: 'summary',
              sourceIds: draft.sourceIds,
              serviceKey: draft.serviceKey,
              sections: draft.sections,
            },
            ...(draft.usage ? { usage: draft.usage } : {}),
          },
        ]
      ),
    }))
    void get().persistHistory()
  },
  discardSummary: () => set({ summaryDraft: null, summaryText: '' }),
  pause: () => {
    if (get().organizing) {
      get().stop()
      return
    }
    const paused = taskLifecycle.pause()
    if (!paused) {
      get().stop()
      return
    }
    if (paused.phase === 'pausing') {
      set({ phase: 'pausing', paused: true, error: null })
    } else {
      // Project preparation has not started a model/native task yet.
      set({
        phase: 'idle',
        paused: true,
        canContinue: true,
        input: paused.input,
      })
    }
  },
  decideResourceApproval: async decision => {
    const { owner, resourceApproval: approval, resourceApprovalBusy } = get()
    if (!owner || !approval || resourceApprovalBusy || get().phase !== 'idle')
      return
    const current = taskLifecycle.fence()
    set({ resourceApprovalBusy: true, error: null })
    try {
      const result = await commands.decideCreationAssistantResources(
        owner,
        approval.taskId,
        approval.plan.id,
        decision
      )
      if (result.status === 'error') throw new Error(result.error.code)
      if (
        !current() ||
        get().owner !== owner ||
        get().resourceApproval !== approval
      )
        return
      set({
        resourceApproval: null,
        resourceApprovalBusy: false,
        canContinue: true,
        paused: true,
      })
      await get().send(false, true)
    } catch {
      if (current() && get().owner === owner)
        set({ resourceApprovalBusy: false, resumeError: true })
    }
  },
  stop: (preserveTask = false) => {
    taskLifecycle.stop(preserveTask)
    useAssistantProjectStore.getState().cancelWhole()
    const pending = get().messages.some(message => message.status === 'pending')
    set(state => ({
      phase: 'idle',
      paused: false,
      resourceApproval: null,
      resourceApprovalBusy: false,
      canContinue: false,
      resumeRestored: false,
      input: state.input || state.submittedInput || '',
      submittedInput: null,
      contextMeasurement: null,
      organizing: false,
      summaryDraft: null,
      messages: state.messages.map(message =>
        message.status === 'pending'
          ? { ...message, status: 'cancelled' as const }
          : message
      ),
    }))
    if (pending) void get().persistHistory()
  },
  send: async (whole = false, continueTask = false) => {
    if (get().resourceApproval) return
    const originalInput = continueTask
      ? (taskLifecycle.attempt?.input ?? '')
      : get().input
    const { owner, phase, configured, modelConfig, editing } = get()
    const retry =
      !whole &&
      (continueTask || get().error || get().canContinue || get().paused) &&
      !editing
        ? taskLifecycle.continuationFor(
            originalInput,
            owner,
            get().mode,
            get().activeConversationId
          )
        : null
    if (
      retry?.modelKey &&
      (!modelConfig || retry.modelKey !== modelConfigurationKey(modelConfig))
    ) {
      set({ error: 'projectScopeChanged', resumeError: true })
      return
    }
    const wholePlan =
      retry?.wholePlan ??
      (whole ? useAssistantProjectStore.getState().whole : null)
    if (
      useAssistantProjectStore.getState().planning ||
      (whole &&
        (!wholePlan?.approved || wholePlan.originalInput !== originalInput))
    )
      return
    if (!whole && !retry && useAssistantProjectStore.getState().whole)
      useAssistantProjectStore.getState().cancelWhole()
    const input = retry?.input ?? wholePlan?.input ?? originalInput
    let activeConversationId = get().activeConversationId
    let messages =
      retry?.history ??
      conversationMessages(get().messages, activeConversationId)
    if (!owner || phase !== 'idle' || !input.trim()) return
    if (
      get().historyState !== 'ready' ||
      get().historyBusy ||
      get().historySaveError === 'staleHistory'
    )
      return
    if (configured === false) {
      set({ error: 'notConfigured' })
      return
    }
    const userId = retry?.userId ?? crypto.randomUUID()
    const replyId = retry?.replyId ?? crypto.randomUUID()
    const attempt: AssistantTaskAttempt = {
      mode: retry?.mode ?? get().mode,
      owner,
      input,
      conversationId: activeConversationId,
      userId,
      replyId,
      history: messages,
      wholePlan,
      continuation: retry?.continuation ?? null,
      paused: false,
      modelKey: modelConfig ? modelConfigurationKey(modelConfig) : undefined,
      locale:
        retry?.locale ??
        (currentResolvedLanguage() === 'zh-CN' ? 'zh-CN' : 'en'),
      attachments: retry?.attachments,
    }
    const execution = taskLifecycle.start(attempt)
    const owns = () => get().owner === owner && execution.isCurrent()
    set({
      paused: false,
      canContinue: false,
      resumeRestored: false,
      resumeError: false,
    })
    let project: AssistantProjectSnapshot | null | undefined
    let consumers: AssistantContextConsumer[] = []
    {
      if (!modelConfig) {
        set({ error: 'notConfigured' })
        return
      }
      set({ phase: 'reading', error: null })
      try {
        project = await useAssistantProjectStore.getState().prepare(owner)
        if (!owns()) return
        if (project) {
          useAssistantOverviewStore.getState().syncWorkspace(owner)
          const overview = await useAssistantOverviewStore
            .getState()
            .refresh(owner)
          if (!owns()) return
          if (!overview) throw new AssistantFlowError('projectUnavailable')
          if (
            overview.snapshot.files.some(
              file =>
                !file.reason &&
                !project?.files.some(
                  allowed => !allowed.reason && allowed.path === file.path
                )
            )
          )
            throw new AssistantFlowError('projectScopeChanged')
          project = overview.snapshot
          if (
            wholePlan &&
            wholePlan.snapshot.fingerprint !== project.fingerprint
          )
            throw new AssistantFlowError('projectScopeChanged')
          const consumer =
            wholePlan?.overviewConsumer ??
            useAssistantOverviewStore
              .getState()
              .contextConsumer(
                owner,
                modelConfig,
                currentResolvedLanguage() === 'zh-CN' ? 'zh-CN' : 'en'
              )
          if (!consumer) throw new AssistantFlowError('projectScopeChanged')
          consumers = [consumer]
        }
        if (wholePlan?.consumer) consumers.push(wholePlan.consumer)
        set({ phase: 'idle' })
      } catch (error) {
        if (owns()) {
          taskLifecycle.discard()
          set({
            phase: 'idle',
            canContinue: false,
            error:
              error instanceof AssistantFlowError
                ? error.code
                : 'projectUnavailable',
          })
        }
        return
      }
    }
    const attachments = useAssistantProjectStore.getState().attachments
    if (wholePlan) useAssistantProjectStore.setState({ whole: null })
    const snapshots =
      retry?.attachments ??
      attachments.map(item => ({
        ...item.snapshot,
        projectKey: get().historyProjectKey ?? '',
      }))
    if (editing) {
      const index = messages.findIndex(
        message => message.id === editing.messageId && message.role === 'user'
      )
      if (index < 0) return
      const copies = forkConversationPrefix(messages.slice(0, index))
      const previousId = activeConversationId
      activeConversationId = crypto.randomUUID()
      const marker: AssistantMessage = {
        id: activeConversationId,
        role: 'assistant',
        text: i18n.t('assistant.context.topicRecord'),
        status: 'completed',
        scope: 'platform',
        sources: [],
        contextMarker: { type: 'topic' },
      }
      set(state => ({
        activeConversationId,
        messages: [...state.messages, marker, ...copies],
        historicalMessageIds: [
          ...state.historicalMessageIds,
          ...copies.map(message => message.id),
        ],
        conversationDrafts: {
          ...state.conversationDrafts,
          [previousId ?? 'original']: {
            input: editing.previousInput,
            editing: null,
          },
        },
        editing: null,
      }))
      messages = copies
    }
    execution.activate(activeConversationId, messages, snapshots)
    const serviceKey = modelConfig ? modelProfileKey(modelConfig) : undefined
    let nextPartialSave = 0
    const revise = (
      status: AssistantMessage['status'],
      error?: AssistantErrorCode
    ) => {
      set(state => ({
        messages: state.messages.map(message =>
          message.id === userId || message.id === replyId
            ? { ...message, status, error }
            : message
        ),
      }))
    }
    set({
      phase: 'reading',
      input: continueTask ? get().input : '',
      submittedInput: input,
      contextMeasurement: null,
      summaryDraft: null,
      summaryText: '',
      error: null,
      canContinue: false,
      historicalMessageIds: retry
        ? get().historicalMessageIds.filter(
            id => id !== userId && id !== replyId
          )
        : get().historicalMessageIds,
      messages:
        retry && get().messages.some(message => message.id === userId)
          ? get().messages.map(message =>
              message.id === userId || message.id === replyId
                ? {
                    ...message,
                    status: 'pending' as const,
                    error: undefined,
                    ...(message.id === replyId
                      ? {
                          text: retry.continuation?.text ?? '',
                          activity:
                            retry.continuation?.activity ?? message.activity,
                          sources: retry.continuation?.sources ?? [],
                        }
                      : {}),
                  }
                : message
            )
          : appendConversationMessages(get().messages, activeConversationId, [
              {
                id: userId,
                contextServiceKey: serviceKey,
                role: 'user',
                text: input,
                ...(snapshots.length ? { attachments: snapshots } : {}),
                sources: [],
                scope: project ? 'project' : 'platform',
                status: 'pending',
                appVersion: __APP_VERSION__,
              },
              {
                id: replyId,
                contextServiceKey: serviceKey,
                role: 'assistant',
                text: '',
                sources: [],
                scope: project ? 'project' : 'platform',
                status: 'pending',
                appVersion: __APP_VERSION__,
              },
            ]),
    })
    void get().persistHistory()
    try {
      const result = await runAssistantRequest({
        identity: owner,
        mode: attempt.mode,
        expectedConfig: modelConfig,
        projectReading: !!project,
        project: project ?? undefined,
        wholeProjectFingerprint: wholePlan?.snapshot.fingerprint,
        attachments: snapshots,
        consumers,
        input,
        history: messages,
        locale: attempt.locale ?? 'en',
        signal: execution.signal,
        pauseSignal: execution.pauseSignal,
        isCurrent: owns,
        continuation: retry?.continuation ?? undefined,
        onContinuation: async continuation => {
          if (!owns() || !continuation) return
          await execution.checkpoint(continuation)
        },
        onPhase: phase => {
          if (owns() && !attempt.paused) set({ phase })
        },
        onContext: contextMeasurement => {
          if (owns()) set({ contextMeasurement })
        },
        onUsage: usage => {
          if (owns())
            set(state => ({
              messages: state.messages.map(message =>
                message.id === replyId ? { ...message, usage } : message
              ),
            }))
        },
        onText: text => {
          if (owns())
            set(state => ({
              messages: state.messages.map(message =>
                message.id === replyId ? { ...message, text } : message
              ),
            }))
          // Stream updates render immediately; bound disk snapshots to once a
          // second. Stop, failure, completion and quit still flush the latest text.
          const now = performance.now()
          if (owns() && now >= nextPartialSave) {
            nextPartialSave = now + 1000
            void get().persistHistory()
          }
        },
        onActivity: activity => {
          if (owns())
            set(state => ({
              messages: state.messages.map(message =>
                message.id === replyId ? { ...message, activity } : message
              ),
            }))
        },
        onSources: sources => {
          if (owns())
            set(state => ({
              messages: state.messages.map(message =>
                message.id === replyId ? { ...message, sources } : message
              ),
            }))
          if (owns()) void get().persistHistory()
        },
      })
      if (!owns()) return
      if (result.resourcePlan) {
        await execution.waitForResources()
        if (!owns()) return
        const taskId = attempt.continuation?.taskId
        if (!taskId) throw new AssistantFlowError('requestFailed')
        set({
          phase: 'idle',
          error: null,
          paused: false,
          canContinue: false,
          submittedInput: null,
          resourceApproval: { taskId, replyId, plan: result.resourcePlan },
          resourceApprovalBusy: false,
        })
        await get().persistHistory()
        return
      }
      await execution.complete(async () => {
        revise('completed')
        if (wholePlan) useAssistantProjectStore.getState().cancelWhole()
        useAssistantProjectStore
          .getState()
          .consumeAttachments(snapshots.map(item => item.id))
        set(state => ({
          phase: 'idle',
          paused: false,
          canContinue: false,
          submittedInput: null,
          messages: state.messages.map(message =>
            message.id === replyId
              ? {
                  ...message,
                  text: result.text,
                  sources: result.sources,
                  reasoningContent: result.reasoningContent,
                }
              : message
          ),
        }))
        if (result.handoff)
          useAssistantHandoffStore
            .getState()
            .offer(owner, replyId, result.handoff)
        const projectKey = get().historyProjectKey
        if (result.proposals?.length && projectKey) {
          useAssistantProposalStore
            .getState()
            .install(owner, replyId, projectKey, result.proposals, snapshot => {
              if (
                get().owner !== owner ||
                get().historicalMessageIds.includes(replyId)
              )
                return
              set(state => ({
                messages: state.messages.map(message =>
                  message.id === replyId
                    ? {
                        ...message,
                        proposals: [
                          ...(message.proposals ?? []).filter(
                            proposal => proposal.id !== snapshot.id
                          ),
                          snapshot,
                        ],
                      }
                    : message
                ),
              }))
              void get().persistHistory()
            })
        }
        await get().persistHistory()
        return !get().historySaveError
      })
    } catch (error) {
      if (!owns()) return
      const code =
        error instanceof AssistantFlowError ? error.code : 'requestFailed'
      const { paused, canContinue } = await execution.fail(code)
      if (!owns()) return
      revise(code === 'cancelled' ? 'cancelled' : 'failed', code)
      set(state => ({
        phase: 'idle',
        error: paused ? null : code,
        paused,
        canContinue,
        input: state.input || state.submittedInput || '',
        submittedInput: null,
      }))
      void get().persistHistory()
    } finally {
      execution.release()
    }
  },
  returnToMessage: messageId => {
    const chat = assistantConversations(get().messages).find(chat =>
      chat.messages.some(message => message.id === messageId)
    )
    if (chat) get().switchConversation(chat.id)
    useCreationReadingStore.getState().showDiscussion(messageId)
  },
}))

/** Stop producers before draining snapshots, shared by workspace cleanup and quit. */
export async function stopAndPersistAssistantHistory(): Promise<void> {
  useAssistantStore.getState().stop(true)
  await useAssistantStore.getState().persistHistory()
  await flushAssistantHistory()
  await flushAssistantResume().catch(() => undefined)
}

useCreationStore.subscribe(state => {
  const owner = state.active
    ? (state.workspace?.project.identity ?? null)
    : null
  useAssistantStore.getState().syncWorkspace(owner)
})
