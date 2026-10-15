import { create } from 'zustand'
import { currentResolvedLanguage } from '@/i18n/config'
import { loadPreferences } from '@/lib/preferences'
import type {
  ContextMeasurement,
  ModelServiceConfig,
} from '@/lib/tauri-bindings'
import type {
  AssistantSummarySections,
  AssistantRoundUsage,
} from '@/lib/tauri-bindings'
import { parseAssistantSummary, summaryInput } from '@/lib/assistant-context'
import { modelProfileKey } from '@/lib/model-context-settings'
import i18n from '@/i18n/config'
import { AssistantFlowError, runAssistantRequest } from '@/lib/assistant-flow'
import type {
  AssistantErrorCode,
  AssistantMessage,
} from '@/lib/assistant-types'
import { useCreationStore } from './creation-store'
import { useCreationReadingStore } from './creation-reading-store'
import {
  AssistantHistoryFailure,
  clearAssistantHistory,
  flushAssistantHistory,
  loadAssistantHistory,
  queueAssistantHistorySave,
  restoreAssistantMessages,
  type AssistantHistoryErrorCode,
} from '@/lib/assistant-history'

interface AssistantState {
  owner: string | null
  input: string
  messages: AssistantMessage[]
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
  send: () => Promise<void>
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
  messages: [],
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
    configurationGeneration += 1
    historyGeneration += 1
    set({
      owner,
      input: '',
      messages: [],
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
      set({
        messages: [],
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
    set({
      configured: prefs ? Boolean(prefs.modelService) : null,
      modelConfig: prefs?.modelService ?? null,
      contextMeasurement: null,
      ...(!prefs ? { error: 'requestFailed' as const } : { error: null }),
    })
  },
  setInput: input => set({ input, error: null }),
  newTopic: () => {
    if (
      get().historyState !== 'ready' ||
      get().historyBusy ||
      get().historySaveError === 'staleHistory'
    )
      return
    get().stop()
    set(state => ({
      messages: [
        ...state.messages,
        {
          id: crypto.randomUUID(),
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
    if (get().historySaveError === 'staleHistory') return
    const prepared = summaryInput(messages, modelConfig, roundLimit)
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
      messages: [
        ...state.messages,
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
      ],
    }))
    void get().persistHistory()
  },
  discardSummary: () => set({ summaryDraft: null, summaryText: '' }),
  stop: () => {
    const pending = get().messages.some(message => message.status === 'pending')
    generation += 1
    controller?.abort()
    controller = null
    set(state => ({
      phase: 'idle',
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
  send: async () => {
    const { owner, input, messages, phase, configured, modelConfig } = get()
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
      contextMeasurement: null,
      summaryDraft: null,
      summaryText: '',
      error: null,
      messages: [
        ...messages,
        {
          id: userId,
          contextServiceKey: serviceKey,
          role: 'user',
          text: input,
          sources: [],
          scope: 'platform',
          status: 'pending',
          appVersion: __APP_VERSION__,
        },
        {
          id: replyId,
          contextServiceKey: serviceKey,
          role: 'assistant',
          text: '',
          sources: [],
          scope: 'platform',
          status: 'pending',
          appVersion: __APP_VERSION__,
        },
      ],
    })
    void get().persistHistory()
    try {
      const result = await runAssistantRequest({
        identity: owner,
        expectedConfig: modelConfig,
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
      set(state => ({
        phase: 'idle',
        input: state.input === input ? '' : state.input,
        messages: state.messages.map(message =>
          message.id === replyId
            ? { ...message, text: result.text, sources: result.sources }
            : message
        ),
      }))
      void get().persistHistory()
    } catch (error) {
      if (!owns()) return
      const code =
        error instanceof AssistantFlowError ? error.code : 'requestFailed'
      revise(code === 'cancelled' ? 'cancelled' : 'failed', code)
      set({ phase: 'idle', error: code })
      void get().persistHistory()
    } finally {
      if (owns()) controller = null
    }
  },
  returnToMessage: messageId =>
    useCreationReadingStore.getState().showDiscussion(messageId),
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
