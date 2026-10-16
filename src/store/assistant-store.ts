import { create } from 'zustand'
import { useAssistantHandoffStore } from './assistant-handoff-store'
import { currentResolvedLanguage } from '@/i18n/config'
import { loadPreferences } from '@/lib/preferences'
import type {
  ContextMeasurement,
  ModelServiceConfig,
  AssistantProjectSnapshot,
} from '@/lib/tauri-bindings'
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
} from '@/lib/assistant-conversations'
import { modelProfileKey } from '@/lib/model-context-settings'
import i18n from '@/i18n/config'
import { AssistantFlowError, runAssistantRequest } from '@/lib/assistant-flow'
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
  phase: 'idle' | 'reading' | 'responding'
  error: AssistantErrorCode | null
  configured: boolean | null
  modelConfig: ModelServiceConfig | null
  contextMeasurement: ContextMeasurement | null
  organizing: boolean
  summaryDraft: {
    sections: AssistantSummarySections
    sourceIds: string[]
    serviceKey: string
    usage: AssistantRoundUsage | null
    token: number
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
  send: (whole?: boolean) => Promise<void>
  stop: () => void
  returnToMessage: (messageId: string) => void
}

let generation = 0
let configurationGeneration = 0
let controller: AbortController | null = null
let historyGeneration = 0
let saveSequence = 0

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
  owner: null,
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
  ...initialHistory(),
  syncWorkspace: owner => {
    if (get().owner === owner) return
    get().stop()
    useAssistantProjectStore.getState().syncWorkspace(owner)
    useAssistantOverviewStore.getState().syncWorkspace(owner)
    configurationGeneration += 1
    historyGeneration += 1
    set({
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
    get().stop()
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
        historyBusy: false,
        historySaving: false,
        historyEpoch: history.epoch,
        historyProjectKey: history.projectKey,
        historyAppVersion: history.appVersion,
        historicalMessageIds: messages.map(message => message.id),
      })
    } catch (error) {
      if (get().owner === owner && token === historyGeneration)
        set({
          historyState: 'error',
          historyBusy: false,
          historyError: historyFailure(error),
        })
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
  setInput: input => set({ input, error: null }),
  beginEditing: messageId => {
    const state = get()
    if (
      state.phase !== 'idle' ||
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
      message.scope !== 'platform' ||
      message.attachments?.length ||
      message.proposals?.length
    )
      return
    set({
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
    get().stop()
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
  },
  newTopic: () => {
    if (
      get().historyState !== 'ready' ||
      get().historyBusy ||
      get().historySaveError === 'staleHistory'
    )
      return
    get().stop()
    const id = crypto.randomUUID()
    set(state => ({
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
      roundLimit
    )
    if (!prepared.source.length) return
    const token = ++generation
    const requestController = new AbortController()
    controller = requestController
    const owns = () => get().owner === owner && generation === token
    let usage: AssistantRoundUsage | null = null
    set({
      phase: 'reading',
      organizing: true,
      summaryDraft: null,
      summaryText: '',
      error: null,
      contextMeasurement: null,
    })
    try {
      const result = await runAssistantRequest({
        identity: owner,
        input: prepared.input,
        history: [],
        locale: currentResolvedLanguage() === 'zh-CN' ? 'zh-CN' : 'en',
        signal: requestController.signal,
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
          usage,
          token,
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
      if (owns()) controller = null
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
      draft.token !== generation ||
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
  stop: () => {
    useAssistantProjectStore.getState().cancelConsent()
    useAssistantProjectStore.getState().cancelWhole()
    const pending = get().messages.some(message => message.status === 'pending')
    generation += 1
    controller?.abort()
    controller = null
    set(state => ({
      phase: 'idle',
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
  send: async (whole = false) => {
    const {
      owner,
      input: originalInput,
      phase,
      configured,
      modelConfig,
      editing,
    } = get()
    const wholePlan = whole ? useAssistantProjectStore.getState().whole : null
    if (!whole && useAssistantProjectStore.getState().whole) return
    if (
      useAssistantProjectStore.getState().planning ||
      (whole &&
        (!wholePlan?.approved || wholePlan.originalInput !== originalInput))
    )
      return
    const input = wholePlan?.input ?? originalInput
    let activeConversationId = get().activeConversationId
    let messages = conversationMessages(get().messages, activeConversationId)
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
    let project: AssistantProjectSnapshot | null | undefined
    let consumers: AssistantContextConsumer[] = []
    if (
      useAssistantProjectStore.getState().reading ||
      useAssistantProjectStore.getState().attachments.length
    ) {
      if (!modelConfig) {
        set({ error: 'notConfigured' })
        return
      }
      const preparing = ++generation
      set({ phase: 'reading', error: null })
      try {
        project = await useAssistantProjectStore
          .getState()
          .prepare(owner, modelConfig, input)
        if (get().owner !== owner || generation !== preparing) return
        if (project === null) {
          set({ phase: 'idle' })
          return
        }
        if (project) {
          useAssistantOverviewStore.getState().syncWorkspace(owner)
          const overview = await useAssistantOverviewStore
            .getState()
            .refresh(owner)
          if (get().owner !== owner || generation !== preparing) return
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
        if (get().owner === owner && generation === preparing)
          set({
            phase: 'idle',
            error:
              error instanceof AssistantFlowError
                ? error.code
                : 'projectUnavailable',
          })
        return
      }
    }
    const attachments = useAssistantProjectStore.getState().attachments
    if (wholePlan) useAssistantProjectStore.setState({ whole: null })
    const snapshots = attachments.map(item => ({
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
    const token = ++generation
    const requestController = new AbortController()
    controller = requestController
    const userId = crypto.randomUUID()
    const replyId = crypto.randomUUID()
    const serviceKey = modelConfig ? modelProfileKey(modelConfig) : undefined
    let nextPartialSave = 0
    const owns = () => get().owner === owner && generation === token
    const revise = (
      status: AssistantMessage['status'],
      error?: AssistantErrorCode
    ) => {
      set(state => ({
        messages: state.messages.map(message =>
          message.id === userId || message.id === replyId
            ? { ...message, status, ...(error ? { error } : {}) }
            : message
        ),
      }))
    }
    set({
      phase: 'reading',
      input: '',
      submittedInput: input,
      contextMeasurement: null,
      summaryDraft: null,
      summaryText: '',
      error: null,
      messages: appendConversationMessages(
        get().messages,
        activeConversationId,
        [
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
        ]
      ),
    })
    void get().persistHistory()
    try {
      const result = await runAssistantRequest({
        identity: owner,
        expectedConfig: modelConfig,
        projectReading: !!project,
        project: project ?? undefined,
        wholeProjectFingerprint: wholePlan?.snapshot.fingerprint,
        attachments: snapshots,
        consumers,
        input,
        history: messages,
        locale: currentResolvedLanguage() === 'zh-CN' ? 'zh-CN' : 'en',
        signal: requestController.signal,
        isCurrent: owns,
        onPhase: phase => {
          if (owns()) set({ phase })
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
      revise('completed')
      if (wholePlan) useAssistantProjectStore.getState().cancelWhole()
      useAssistantProjectStore
        .getState()
        .consumeAttachments(snapshots.map(item => item.id))
      set(state => ({
        phase: 'idle',
        submittedInput: null,
        messages: state.messages.map(message =>
          message.id === replyId
            ? { ...message, text: result.text, sources: result.sources }
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
      void get().persistHistory()
    } catch (error) {
      if (!owns()) return
      const code =
        error instanceof AssistantFlowError ? error.code : 'requestFailed'
      revise(code === 'cancelled' ? 'cancelled' : 'failed', code)
      set(state => ({
        phase: 'idle',
        error: code,
        input: state.input || state.submittedInput || '',
        submittedInput: null,
      }))
      void get().persistHistory()
    } finally {
      if (owns()) controller = null
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
  useAssistantStore.getState().stop()
  await useAssistantStore.getState().persistHistory()
  await flushAssistantHistory()
}

useCreationStore.subscribe(state => {
  const owner = state.active
    ? (state.workspace?.project.identity ?? null)
    : null
  useAssistantStore.getState().syncWorkspace(owner)
})

useAssistantProjectStore.subscribe((state, previous) => {
  if (previous.reading && !state.reading) useAssistantStore.getState().stop()
})
