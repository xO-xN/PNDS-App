import {
  isProjectOrganizationRequest,
  isHandoffRequest,
  isStartWorkRequest,
} from '@/lib/assistant-workflow'
import {
  validOrganizationSources,
  type OrganizationSupplement,
  type OrganizationSource,
} from '@/lib/assistant-organization'
import {
  handoffDraftInput,
  selectedDiscussionPlan,
  selectedHandoffTask,
} from '@/lib/assistant-handoff'
import type { MaterialEvidence } from '@/lib/assistant-materials'
import {
  assistantSkills,
  skillRequestInput,
  type AssistantSkillCapture,
} from '@/lib/assistant-skills'
import {
  assistantFileReferenceKey,
  MAX_ASSISTANT_FILE_REFERENCES,
  verifyAssistantFileReferences,
  validAssistantFileReferences,
  type AssistantFileReference,
} from '@/lib/assistant-file-references'
import { useCreationHandoffStore } from './creation-handoff-store'
import { pendingQuestion } from '@/lib/assistant-questions'
import { handoffLanguage, handoffPrompt } from '@/lib/assistant-handoff-prompt'
import { commands } from '@/lib/tauri-bindings'
import { create } from 'zustand'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { validateAssistantToolCall } from '@/lib/assistant-tool-contracts'
import { useAssistantHandoffStore } from './assistant-handoff-store'
import { currentResolvedLanguage } from '@/i18n/config'
import { loadPreferences } from '@/lib/preferences'
import type {
  AssistantMode,
  AssistantQuestion,
  AssistantQuestionAnswer,
  AssistantResourcePlan,
  AssistantResourceDecision,
  ContextMeasurement,
  ModelServiceConfig,
  AssistantProjectSnapshot,
  AssistantSkillId,
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
import {
  canUseCreationTerminal,
  showCreationTerminal,
} from './creation-terminal-store'
import { terminalTaskDocument } from '@/lib/project-terminal-handoff'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { expectOk } from '@/lib/tauri-bindings'
import { useCreationMergeStore } from './creation-merge-store'
import { useMergeAssistantStore } from './merge-assistant-store'
import { useAssistantProjectStore } from './assistant-project-store'
import { useAssistantOverviewStore } from './assistant-overview-store'
import { useAssistantProposalStore } from './assistant-proposal-store'
import { modelConfigurationKey } from '@/lib/model-context-settings'
import {
  AssistantHistoryFailure,
  ASSISTANT_HISTORY_MESSAGE_LIMIT,
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

function handoffReplyLanguage(
  messages: readonly AssistantMessage[],
  id: string,
  previous?: string
) {
  const topic =
    assistantConversations(messages).find(chat =>
      chat.messages.some(message => message.id === id)
    )?.messages ?? []
  return handoffLanguage(
    topic.slice(0, topic.findIndex(message => message.id === id) + 1),
    previous
  )
}

function recordedHandoff(
  root: string,
  taskId: string,
  revision: string,
  language?: string
) {
  return {
    text: i18n.t('assistant.handoff.recordedReady'),
    handoff: { taskId, revision, prompt: handoffPrompt(root, language) },
  }
}

/** Only an explicit next-step action can select the current live plan. */
async function captureDiscussionPlan(
  state: AssistantState,
  selectHistory = false
) {
  const message = conversationMessages(
    state.messages,
    state.activeConversationId
  ).at(-1)
  const item = message
    ? useAssistantHandoffStore.getState().items[message.id]
    : undefined
  const live =
    item?.mode === 'discussion' &&
    item.identity === state.owner &&
    !state.historicalMessageIds.includes(message?.id ?? '')
  if (
    !message ||
    !state.owner ||
    message.role !== 'assistant' ||
    message.status !== 'completed' ||
    message.scope !== 'project' ||
    message.contextMarker ||
    message.handoff ||
    !message.text.trim() ||
    (!live && !selectHistory) ||
    useCreationStore.getState().workspace?.project.identity !== state.owner ||
    !state.modelConfig ||
    message.contextServiceKey !== modelProfileKey(state.modelConfig)
  )
    return undefined
  const projectSources = message.sources.flatMap(source =>
    source.project ? [source.project] : []
  )
  if (projectSources.length) {
    const inventory = await commands.assistantProjectInventory(state.owner)
    if (
      inventory.status === 'error' ||
      projectSources.some(
        source =>
          !inventory.data.files.some(
            file =>
              !file.reason &&
              file.path === source.path &&
              file.version === source.version
          )
      )
    )
      throw new AssistantFlowError('projectScopeChanged')
  }
  // Selecting a plan must not reintroduce prose from removed private materials.
  const materialSources = message.sources.flatMap(source =>
    source.material ? [source.material.material] : []
  )
  if (materialSources.length) {
    const catalog = await commands.listCreationMaterials(state.owner)
    if (
      catalog.status === 'error' ||
      materialSources.some(
        source =>
          !catalog.data.some(
            material =>
              material.id === source.id && material.version === source.version
          )
      )
    )
      throw new AssistantFlowError('projectScopeChanged')
  }
  return {
    source: selectedDiscussionPlan(
      message,
      live ? item?.suggestion : undefined
    ),
    materialEvidence: materialSources.map(({ id, version }) => ({
      id,
      version,
    })),
  }
}

function sameDiscussionChoice(before: AssistantState, after: AssistantState) {
  return (
    before.owner === after.owner &&
    before.activeConversationId === after.activeConversationId &&
    before.mode === after.mode &&
    before.modelConfig === after.modelConfig &&
    before.messages === after.messages &&
    after.phase === 'idle' &&
    !after.activeQuestion &&
    !after.resourceApproval &&
    !after.editing &&
    !after.canContinue &&
    !after.paused &&
    !after.resumeRestored &&
    after.historyState === 'ready' &&
    !after.historyBusy &&
    !after.historySaveError
  )
}

/** A new explicit selection references the old goal and check; it carries no
 * task ID to resume and never treats a past check as current verification. */
export function verificationContinuationSource(
  state: Pick<AssistantState, 'messages' | 'activeConversationId'>,
  messageId: string
) {
  const topic = conversationMessages(state.messages, state.activeConversationId)
  const index = topic.findIndex(message => message.id === messageId)
  const reply = topic[index]
  const evidence = reply?.checkOutcome
  if (
    !reply ||
    reply.role !== 'assistant' ||
    reply.status !== 'completed' ||
    reply.scope !== 'project' ||
    !evidence ||
    ![evidence.runtime, evidence.behavior].some(
      stage => stage.status !== 'passed' && stage.status !== 'notRequired'
    )
  )
    return undefined
  const goal = topic
    .slice(0, index)
    .reverse()
    .find(
      message =>
        message.role === 'user' &&
        message.status === 'completed' &&
        message.scope === 'project' &&
        !message.contextMarker &&
        message.text.trim()
    )
  if (!goal) return undefined
  return {
    goal: goal.text,
    evidence,
    materialEvidence: [...goal.sources, ...reply.sources].flatMap(source =>
      source.material
        ? [
            {
              id: source.material.material.id,
              version: source.material.material.version,
            },
          ]
        : []
    ),
  }
}

interface AssistantState {
  mode: AssistantMode
  prepareHandoff: () => Promise<void>
  startWork: (messageId: string) => Promise<void>
  handoffToTerminal: (messageId: string) => Promise<void>
  terminalHandoffBusy: boolean
  selectDiscussionPlan: (messageId: string) => Promise<void>
  continueVerification: (messageId: string) => Promise<void>
  preparingHandoff: boolean
  handoffDraftError: boolean
  handoffDraftIds: Record<string, string>
  setMode: (mode: AssistantMode) => void
  owner: string | null
  input: string
  submittedInput: string | null
  messages: AssistantMessage[]
  activeConversationId: string | null
  conversationTitles: Record<string, string>
  conversationDrafts: Record<
    string,
    {
      input: string
      editing: QuestionEdit | null
      fileReferences?: AssistantFileReference[]
      selectedSkill?: AssistantSkillId | null
    }
  >
  fileReferences: AssistantFileReference[]
  selectedSkill: AssistantSkillId | null
  skillModeMismatch: boolean
  selectSkill: (id: AssistantSkillId | null, input?: string) => void
  addFileReferences: (
    identity: string,
    conversationId: string | null,
    references: readonly AssistantFileReference[]
  ) => void
  removeFileReference: (key: string) => void
  editing: QuestionEdit | null
  beginEditing: (messageId: string) => void
  cancelEditing: () => void
  switchConversation: (id: string | null) => void
  renameConversation: (id: string | null, title: string) => Promise<boolean>
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
  activeQuestion: {
    taskId: string
    replyId: string
    question: AssistantQuestion
    ready: boolean
    conversationId: string | null
  } | null
  questionBusy: boolean
  questionCancelError: boolean
  answerQuestion: (
    questionId: string,
    answer: AssistantQuestionAnswer
  ) => Promise<void>
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
  organizeProject: (supplement?: OrganizationSupplement) => Promise<void>
  send: (
    whole?: boolean,
    continueTask?: boolean,
    handoffDraft?: boolean,
    taskInput?: string,
    organizationSources?: OrganizationSource[],
    materialEvidence?: MaterialEvidence[]
  ) => Promise<void>
  stop: (preserveTask?: boolean) => void
  pause: () => void
  returnToMessage: (messageId: string) => void
}

let configurationGeneration = 0
let historyGeneration = 0
let terminalHandoffRequest: object | null = null
let saveSequence = 0
let historyRemoval: {
  owner: string
  discarded: ReadonlySet<string> | null
  capacityFailure: boolean
} | null = null
const taskLifecycle = new AssistantTaskLifecycle(owner => {
  if (useAssistantStore.getState().owner === owner)
    useAssistantStore.setState({ resumeError: true })
}, retireAssistantTask)

/** Retirement is serialized with checkpoints. Revoke writes first, retain
 * canonical question facts in chat, and only then remove native recovery. */
function retireAssistantTask(attempt: Readonly<AssistantTaskAttempt>) {
  const taskId = attempt.nativeTaskId ?? attempt.continuation?.taskId
  if (!taskId) return () => Promise.resolve()
  const owner = attempt.owner
  const captured = useAssistantStore.getState()
  const historyEpoch = captured.owner === owner ? captured.historyEpoch : null
  const active =
    captured.owner === owner && captured.activeQuestion?.taskId === taskId
      ? captured.activeQuestion
      : null
  let published = false
  return () =>
    clearAssistantResume(owner, taskId, async () => {
      if (published) return
      const ended = await commands.endCreationAssistantTask(owner, taskId)
      if (ended.status === 'error') throw new Error(ended.error.code)
      let questions: AssistantQuestion[]
      if (active) questions = [active.question]
      else {
        const result = await commands.getCreationAssistantQuestions(
          owner,
          taskId
        )
        if (result.status === 'error') throw new Error(result.error.code)
        questions = result.data
      }
      const canonical: AssistantQuestion[] = []
      for (const question of questions) {
        if (question.status !== 'pending') {
          canonical.push(question)
          continue
        }
        let receipt: AssistantQuestion | undefined
        try {
          const result = await commands.cancelCreationAssistantQuestion(
            owner,
            taskId,
            question.id,
            question.scope
          )
          if (result.status === 'ok') receipt = result.data
        } catch {
          /* Reconcile an uncertain cancellation against native facts. */
        }
        if (!receipt) {
          const result = await commands.getCreationAssistantQuestions(
            owner,
            taskId
          )
          if (result.status === 'ok')
            receipt = result.data.find(item => item.id === question.id)
        }
        if (
          !receipt ||
          receipt.taskId !== taskId ||
          receipt.status === 'pending'
        ) {
          if (useAssistantStore.getState().owner === owner)
            useAssistantStore.setState({ questionCancelError: true })
          throw new Error('Assistant question cancellation is uncertain')
        }
        canonical.push(receipt)
      }
      const latest = useAssistantStore.getState()
      const current =
        latest.owner === owner && latest.historyEpoch === historyEpoch
      const source = current
        ? latest.messages
        : captured.owner === owner
          ? captured.messages
          : []
      const messages = source.map(message => ({
        ...message,
        ...(message.id === attempt.replyId && message.status === 'pending'
          ? { status: 'cancelled' as const }
          : {}),
        ...(message.questions
          ? {
              questions: message.questions.map(
                question =>
                  canonical.find(
                    receipt =>
                      receipt.id === question.id &&
                      receipt.taskId === question.taskId
                  ) ?? question
              ),
            }
          : {}),
      }))
      if (current) useAssistantStore.setState({ messages })
      if (messages.length && !historyEpoch)
        throw new Error('Assistant history is not available for retirement')
      // Explicit chat removal may retire a task whose full transcript no longer
      // fits. Its native cancellation remains mandatory; the selected messages
      // are then removed by the caller's ordinary atomic history publication.
      const discardingReply =
        historyRemoval?.owner === owner &&
        historyRemoval.capacityFailure &&
        (historyRemoval.discarded === null ||
          historyRemoval.discarded.has(attempt.replyId))
      if (historyEpoch && !discardingReply) {
        try {
          await queueAssistantHistorySave(
            owner,
            historyEpoch,
            messages,
            current ? latest.conversationTitles : captured.conversationTitles
          )
        } catch (error) {
          if (useAssistantStore.getState().owner === owner)
            useAssistantStore.setState({
              historySaveError: historyFailure(error),
            })
          throw error
        }
      }
      published = true
    })
}

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
  mode: 'discussion',
  terminalHandoffBusy: false,
  preparingHandoff: false,
  handoffDraftError: false,
  handoffDraftIds: {},
  setMode: mode => {
    if (
      get().phase === 'idle' &&
      !get().resourceApproval &&
      !get().activeQuestion &&
      !get().historyBusy &&
      mode !== get().mode
    ) {
      taskLifecycle.discard()
      set({
        mode,
        canContinue: false,
        paused: false,
        resumeRestored: false,
        handoffDraftError: false,
        skillModeMismatch: false,
      })
    }
  },
  owner: null,
  input: '',
  submittedInput: null,
  messages: [],
  activeConversationId: null,
  conversationTitles: {},
  conversationDrafts: {},
  fileReferences: [],
  selectedSkill: null,
  skillModeMismatch: false,
  selectSkill: (id, input) => {
    const state = get()
    if (
      state.phase !== 'idle' ||
      state.historyBusy ||
      state.resourceApproval ||
      state.activeQuestion ||
      state.editing ||
      (id && assistantSkills[id]?.mode !== state.mode)
    )
      return
    set({
      selectedSkill: id,
      skillModeMismatch: false,
      ...(id ? { canContinue: false } : {}),
      ...(input === undefined ? {} : { input }),
    })
  },
  addFileReferences: (identity, conversationId, references) => {
    const state = get()
    if (
      state.owner !== identity ||
      state.activeConversationId !== conversationId ||
      state.phase !== 'idle' ||
      state.historyBusy ||
      state.resourceApproval ||
      state.activeQuestion
    )
      return
    const next = new Map(
      state.fileReferences.map(reference => [
        assistantFileReferenceKey(reference),
        reference,
      ])
    )
    for (const reference of references) {
      if (next.size >= MAX_ASSISTANT_FILE_REFERENCES) break
      const key = assistantFileReferenceKey(reference)
      if (!next.has(key) && validAssistantFileReferences([reference]))
        next.set(key, reference)
    }
    set({ fileReferences: [...next.values()] })
  },
  removeFileReference: key =>
    set(state => ({
      fileReferences: state.fileReferences.filter(
        reference => assistantFileReferenceKey(reference) !== key
      ),
    })),
  editing: null,
  phase: 'idle',
  paused: false,
  resourceApproval: null,
  activeQuestion: null,
  questionBusy: false,
  questionCancelError: false,
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
      mode: 'discussion',
      terminalHandoffBusy: false,
      preparingHandoff: false,
      handoffDraftError: false,
      handoffDraftIds: {},
      owner,
      input: '',
      submittedInput: null,
      messages: [],
      activeConversationId: null,
      conversationTitles: {},
      conversationDrafts: {},
      fileReferences: [],
      selectedSkill: null,
      skillModeMismatch: false,
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
      questionCancelError: false,
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
      const project = useCreationStore.getState().workspace?.project
      const restored = restoreAssistantMessages(history)
      const messages = restored.map(message =>
        project?.identity === owner && message.handoff
          ? {
              ...message,
              handoff: {
                ...message.handoff,
                prompt: handoffPrompt(
                  project.root,
                  handoffReplyLanguage(
                    restored,
                    message.id,
                    message.handoff.prompt
                  )
                ),
              },
            }
          : message
      )
      set({
        messages,
        activeConversationId:
          assistantConversations(messages).at(-1)?.id ?? null,
        conversationTitles: Object.fromEntries(
          Object.entries(history.conversationTitles ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        ),
        conversationDrafts: {},
        fileReferences: [],
        selectedSkill: null,
        skillModeMismatch: false,
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
      if (get().owner !== owner || token !== historyGeneration) return
      const draftLabels = ['en', 'zh-CN'].map(language =>
        i18n.getFixedT(language)('assistant.handoff.draftReady')
      )
      const legacyReplies = new Set(
        messages
          .filter(
            message =>
              message.role === 'assistant' &&
              message.status === 'completed' &&
              message.scope === 'project' &&
              !message.contextMarker &&
              draftLabels.includes(message.text)
          )
          .map(message => message.id)
      )
      if (project?.identity === owner && legacyReplies.size) {
        // Older builds left the chat at "draft ready" after a successful write.
        // Only a complete native record can repair that display snapshot.
        const catalog = await commands
          .listHandoffBaselines(owner)
          .catch(() => null)
        if (get().owner !== owner || token !== historyGeneration) return
        if (catalog?.status === 'ok') {
          const recorded = new Map(
            catalog.data.baselines
              .filter(
                item =>
                  item.complete && item.task && legacyReplies.has(item.taskId)
              )
              .sort((a, b) => a.capturedAt - b.capturedAt)
              .map(item => [item.taskId, item])
          )
          if (recorded.size) {
            set(state => ({
              messages: state.messages.map(message => {
                const baseline = recorded.get(message.id)
                return baseline && draftLabels.includes(message.text)
                  ? {
                      ...message,
                      ...recordedHandoff(
                        project.root,
                        baseline.taskId,
                        baseline.revision,
                        handoffReplyLanguage(messages, message.id)
                      ),
                    }
                  : message
              }),
            }))
            await get().persistHistory()
          }
        }
      }
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
        if (!get().historySaveError && !get().historySaving)
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
      const questions = await commands.getCreationAssistantQuestions(
        owner,
        record.taskId
      )
      if (questions.status === 'error') throw new Error(questions.error.code)
      if (get().owner !== owner || !currentTask() || get().phase !== 'idle')
        return
      const pending = pendingQuestion({ questions: questions.data })
      const restored = taskLifecycle.restore(owner, recovered)
      const continuation = restored.continuation
      if (!continuation) throw new Error('Missing assistant task checkpoint')
      const scope = continuation.questionScope ?? {
        chatId: record.conversationId ?? 'original',
        messageId: record.replyMessageId,
      }
      if (
        pending &&
        (pending.scope.chatId !== scope.chatId ||
          pending.scope.messageId !== scope.messageId)
      )
        throw new Error('Question scope changed')
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
          text: restored.skill?.creatorText ?? record.input,
          ...(restored.skill ? { skill: restored.skill.id } : {}),
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
      messages = messages.map(message =>
        message.id === record.replyMessageId && questions.data.length
          ? { ...message, questions: questions.data }
          : message
      )
      set({
        messages,
        activeQuestion: pending
          ? {
              taskId: record.taskId,
              replyId: record.replyMessageId,
              question: pending,
              ready: false,
              conversationId: record.conversationId,
            }
          : null,
        questionBusy: false,
        activeConversationId: record.conversationId,
        mode: record.mode,
        input: pendingPlan
          ? draft
          : restored.skill
            ? draft || restored.skill.creatorText
            : record.input,
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
    const {
      owner,
      historyEpoch,
      historyState,
      historyBusy,
      messages,
      conversationTitles,
    } = get()
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
      await queueAssistantHistorySave(
        owner,
        historyEpoch,
        messages,
        conversationTitles
      )
      if (owns()) set({ historySaving: false, historySaveError: null })
    } catch (error) {
      if (owns())
        set({ historySaving: false, historySaveError: historyFailure(error) })
    }
  },
  clearHistory: async () => {
    const owner = get().owner
    if (!owner || get().historyBusy) return
    const removal = {
      owner,
      discarded: null,
      capacityFailure: get().historySaveError === 'tooLarge',
    }
    historyRemoval = removal
    get().stop()
    const token = ++historyGeneration
    set({ historyBusy: true, historySaving: false, historyError: null })
    try {
      await taskLifecycle.retireStored(owner)
      await clearAssistantResume(owner, null)
      const history = await clearAssistantHistory(owner)
      if (get().owner !== owner || token !== historyGeneration) return
      useAssistantProposalStore.getState().clear()
      set({
        messages: [],
        activeConversationId: null,
        conversationTitles: {},
        conversationDrafts: {},
        fileReferences: [],
        selectedSkill: null,
        skillModeMismatch: false,
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
    } finally {
      if (historyRemoval === removal) historyRemoval = null
    }
  },
  renameConversation: async (id, title) => {
    const name = title.trim()
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
      project.whole ||
      !name ||
      name.length > 120 ||
      /[\p{Cc}\u2028\u2029]/u.test(name) ||
      !assistantConversations(state.messages).some(chat => chat.id === id)
    )
      return false
    const key = id ?? 'original'
    if (
      Object.hasOwn(state.conversationTitles, key) &&
      state.conversationTitles[key] === name
    )
      return true
    const conversationTitles = { ...state.conversationTitles, [key]: name }
    const token = historyGeneration
    ++saveSequence
    const owns = () =>
      get().owner === owner &&
      historyGeneration === token &&
      get().historyEpoch === historyEpoch
    set({ historyBusy: true, historySaving: false, historyError: null })
    try {
      await queueAssistantHistorySave(
        owner,
        historyEpoch,
        state.messages,
        conversationTitles
      )
      if (!owns()) return false
      const latest = get()
      set({
        conversationTitles,
        historyBusy: false,
        historySaveError: null,
      })
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
    const conversationTitles = Object.fromEntries(
      Object.entries(state.conversationTitles).filter(
        ([key]) => key !== (id ?? 'original') && key !== candidate.promotedId
      )
    )
    if (
      candidate.promotedId &&
      Object.hasOwn(state.conversationTitles, candidate.promotedId)
    ) {
      const promotedTitle = state.conversationTitles[candidate.promotedId]
      if (typeof promotedTitle === 'string')
        conversationTitles.original = promotedTitle
    }
    const removal = {
      owner,
      discarded: candidate.removedIds,
      capacityFailure: state.historySaveError === 'tooLarge',
    }
    historyRemoval = removal
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
      await queueAssistantHistorySave(
        owner,
        historyEpoch,
        candidate.messages,
        conversationTitles
      )
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
      const retiresQuestion =
        activeDeleted ||
        invalidatesRetry ||
        (!!latest.activeQuestion &&
          removed.removedIds.has(latest.activeQuestion.replyId))
      if (retiresQuestion) taskLifecycle.stop(false)
      const activeQuestion = retiresQuestion
        ? null
        : latest.activeQuestion?.conversationId === removed.promotedId
          ? { ...latest.activeQuestion, conversationId: null }
          : latest.activeQuestion
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
        conversationTitles,
        activeConversationId,
        activeQuestion,
        questionBusy: retiresQuestion ? false : latest.questionBusy,
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
              fileReferences: draft?.fileReferences ?? [],
              selectedSkill: draft?.selectedSkill ?? null,
              skillModeMismatch: false,
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
    } finally {
      if (historyRemoval === removal) historyRemoval = null
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
      canContinue: !get().selectedSkill && taskLifecycle.canContinue(input),
    })
  },
  beginEditing: messageId => {
    const state = get()
    if (
      state.phase !== 'idle' ||
      !!state.resourceApproval ||
      !!state.activeQuestion ||
      state.historyBusy ||
      state.historyState !== 'ready' ||
      !!state.historySaveError
    )
      return
    const message = conversationMessages(
      state.messages,
      state.activeConversationId
    ).find(message => message.id === messageId)
    if (
      !message ||
      message.role !== 'user' ||
      message.skill ||
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
          fileReferences: state.fileReferences,
          selectedSkill: state.selectedSkill,
        },
      },
      input: state.conversationDrafts[id ?? 'original']?.input ?? '',
      editing: state.conversationDrafts[id ?? 'original']?.editing ?? null,
      fileReferences:
        state.conversationDrafts[id ?? 'original']?.fileReferences ?? [],
      selectedSkill:
        state.conversationDrafts[id ?? 'original']?.selectedSkill ?? null,
      skillModeMismatch: false,
      error: null,
      summaryText: '',
    }))
    void get().restoreTask()
  },
  newTopic: () => {
    if (
      get().historyState !== 'ready' ||
      get().historyBusy ||
      !!get().historySaveError
    )
      return
    if (get().messages.length >= ASSISTANT_HISTORY_MESSAGE_LIMIT) {
      set({ historySaveError: 'tooLarge' })
      return
    }
    get().stop()
    const owner = get().owner
    if (owner)
      void taskLifecycle.retireStored(owner).catch(() => {
        if (get().owner === owner) set({ resumeError: true })
      })
    const id = crypto.randomUUID()
    set(state => ({
      mode: 'discussion',
      activeConversationId: id,
      conversationDrafts: {
        ...state.conversationDrafts,
        [state.activeConversationId ?? 'original']: {
          input: state.input,
          editing: state.editing,
          fileReferences: state.fileReferences,
          selectedSkill: state.selectedSkill,
        },
      },
      editing: null,
      fileReferences: [],
      selectedSkill: null,
      skillModeMismatch: false,
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
  prepareHandoff: async () => {
    const state = get()
    const { owner, modelConfig, activeConversationId } = state
    if (
      !owner ||
      !modelConfig ||
      state.mode !== 'discussion' ||
      state.phase !== 'idle' ||
      state.activeQuestion ||
      state.resourceApproval ||
      state.historyState !== 'ready' ||
      state.historyBusy ||
      state.editing ||
      !!state.historySaveError ||
      useCreationHandoffStore.getState().busy
    )
      return
    const taskCurrent = taskLifecycle.fence()
    const current = () =>
      taskCurrent() &&
      get().owner === owner &&
      get().activeConversationId === activeConversationId &&
      get().mode === 'discussion' &&
      useCreationStore.getState().workspace?.project.identity === owner
    const topic = conversationMessages(state.messages, activeConversationId)
    const key = JSON.stringify([activeConversationId, topic.at(-1)?.id])
    const previous = state.handoffDraftIds[key]
    const pending =
      previous === undefined
        ? undefined
        : useCreationHandoffStore
            .getState()
            .pending.find(
              item => item.task.id === previous || item.originId === previous
            )
    if (pending) {
      await useCreationHandoffStore.getState().open(pending.task.id, current)
      return
    }
    // A copied display snapshot can refer to an existing task selected in the
    // review dialog. Resolve it against native records before reopening.
    const reference = topic.at(-1)?.handoff
    const recordedId = previous ?? reference?.taskId ?? topic.at(-1)?.id
    const revision =
      reference && reference.taskId === recordedId
        ? reference.revision
        : undefined
    const receipt = useCreationHandoffStore.getState().receipt
    if (
      receipt?.taskRecorded &&
      receipt.task.id === recordedId &&
      (!revision || receipt.revision === revision)
    ) {
      await useCreationHandoffStore
        .getState()
        .prepareTask(receipt.task, current, true)
      return
    }
    try {
      const catalog = await commands.listHandoffBaselines(owner)
      if (!current()) return
      if (catalog.status === 'error') throw new Error(catalog.error.code)
      const baseline = catalog.data.baselines
        .filter(
          item =>
            item.taskId === recordedId &&
            (!revision || item.revision === revision)
        )
        .sort((a, b) => b.capturedAt - a.capturedAt)[0]
      if (baseline) {
        if (!baseline.task) throw new Error('Recorded handoff is unavailable')
        await useCreationHandoffStore
          .getState()
          .prepareTask(baseline.task, current, baseline.complete)
        return
      }
      if (reference)
        throw new Error('Recorded handoff reference is unavailable')
    } catch {
      if (current()) set({ handoffDraftError: true })
      return
    }
    await get().send(false, false, true)
  },
  organizeContext: async roundLimit => {
    if (get().resourceApproval || get().activeQuestion) return
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
    if (get().historySaveError || get().editing) return
    const prepared = summaryInput(
      conversationMessages(messages, get().activeConversationId),
      modelConfig,
      roundLimit,
      useAssistantProjectStore.getState().snapshot ?? undefined
    )
    if (!prepared.source.length) return
    if (messages.length >= ASSISTANT_HISTORY_MESSAGE_LIMIT) {
      set({ historySaveError: 'tooLarge' })
      return
    }
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
      await get().persistHistory()
      await flushAssistantHistory()
      if (!owns()) return
      if (get().historySaveError || get().historySaving) {
        set({ phase: 'idle', organizing: false })
        return
      }
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
      !!get().historySaveError ||
      !modelConfig ||
      phase !== 'idle' ||
      !draft.isCurrent() ||
      draft.serviceKey !== modelProfileKey(modelConfig)
    )
      return
    if (get().messages.length >= ASSISTANT_HISTORY_MESSAGE_LIMIT) {
      set({ historySaveError: 'tooLarge' })
      return
    }
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
        input:
          get().input ||
          taskLifecycle.attempt?.skill?.creatorText ||
          (taskLifecycle.attempt?.skill ? '' : paused.input),
      })
    }
  },
  answerQuestion: async (questionId, answer) => {
    const { owner, activeQuestion: active, questionBusy } = get()
    if (
      !owner ||
      !active ||
      active.question.id !== questionId ||
      !active.ready ||
      questionBusy ||
      !!get().historySaveError ||
      get().phase !== 'idle' ||
      active.conversationId !== get().activeConversationId
    )
      return
    const current = taskLifecycle.fence()
    set({ questionBusy: true, resumeError: false })
    try {
      const result = await commands.answerCreationAssistantQuestion(
        owner,
        active.taskId,
        questionId,
        active.question.scope,
        answer
      )
      if (result.status === 'error') throw new Error(result.error.code)
      if (
        !current() ||
        get().owner !== owner ||
        get().activeQuestion?.question.id !== questionId ||
        get().activeQuestion?.taskId !== active.taskId ||
        get().activeQuestion?.replyId !== active.replyId
      )
        return
      set(state => ({
        activeQuestion: null,
        questionBusy: false,
        canContinue: true,
        paused: true,
        messages: state.messages.map(message =>
          message.id === active.replyId
            ? {
                ...message,
                questions: message.questions?.map(question =>
                  question.id === questionId ? result.data : question
                ),
              }
            : message
        ),
      }))
      await get().persistHistory()
      if (current() && get().owner === owner) await get().send(false, true)
    } catch {
      if (current() && get().owner === owner)
        set(state => ({
          questionBusy: false,
          resumeError: true,
          activeQuestion: state.activeQuestion?.question.materialConflict
            ? { ...state.activeQuestion, ready: false }
            : state.activeQuestion,
        }))
    }
  },
  decideResourceApproval: async decision => {
    const { owner, resourceApproval: approval, resourceApprovalBusy } = get()
    if (
      !owner ||
      !approval ||
      resourceApprovalBusy ||
      get().phase !== 'idle' ||
      get().historySaveError
    )
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
    terminalHandoffRequest = null
    const active = get().activeQuestion
    taskLifecycle.stop(preserveTask)
    useAssistantProjectStore.getState().cancelWhole()
    const pending = get().messages.some(message => message.status === 'pending')
    set(state => ({
      phase: 'idle',
      terminalHandoffBusy: false,
      preparingHandoff: false,
      handoffDraftError: false,
      paused: false,
      resourceApproval: null,
      activeQuestion: null,
      questionBusy: false,
      questionCancelError: false,
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
    if (pending || (!preserveTask && active)) void get().persistHistory()
  },
  continueVerification: async messageId => {
    const state = get()
    const project = useCreationStore.getState().workspace?.project
    const source = verificationContinuationSource(state, messageId)
    if (
      !source ||
      !state.owner ||
      !state.configured ||
      !state.modelConfig ||
      state.input.length > 0 ||
      !sameDiscussionChoice(state, state) ||
      state.organizing ||
      project?.identity !== state.owner ||
      project.source !== 'folder' ||
      useAssistantProjectStore.getState().planning ||
      useAssistantProjectStore.getState().whole
    )
      return
    const goal = i18n.t('assistant.delivery.continueTask', {
      goal: source.goal,
      evidence: JSON.stringify(source.evidence),
    })
    taskLifecycle.discard()
    get().setMode('edit')
    await get().send(
      false,
      false,
      false,
      goal,
      undefined,
      source.materialEvidence
    )
  },
  selectDiscussionPlan: async messageId => {
    const state = get()
    const { owner, modelConfig, historyEpoch, activeConversationId } = state
    const message = conversationMessages(
      state.messages,
      activeConversationId
    ).find(message => message.id === messageId)
    const plan = message?.discussionPlan
    const project = useCreationStore.getState().workspace?.project
    if (
      !owner ||
      !modelConfig ||
      !historyEpoch ||
      !state.configured ||
      state.mode !== 'discussion' ||
      !sameDiscussionChoice(state, state) ||
      state.organizing ||
      project?.identity !== owner ||
      project.source !== 'folder' ||
      !message ||
      message.role !== 'assistant' ||
      message.status !== 'completed' ||
      !plan ||
      message.text !== plan.plan ||
      !validateAssistantToolCall('propose_handoff', plan, {
        project: true,
        mode: 'discussion',
      }).ok
    )
      return
    if (state.messages.length + 2 > ASSISTANT_HISTORY_MESSAGE_LIMIT) {
      set({ historySaveError: 'tooLarge' })
      return
    }
    // A restored snapshot is reference data. A fresh selection checks its
    // evidence and creates new records; it never revives a prior task/grant.
    let saving = false
    try {
      const inventory = await commands.assistantProjectInventory(owner)
      const materials = message.sources.some(source => source.material)
        ? await commands.listCreationMaterials(owner)
        : undefined
      if (!sameDiscussionChoice(state, get())) return
      if (
        inventory.status === 'error' ||
        materials?.status === 'error' ||
        message.sources.some(
          source =>
            (source.project &&
              !inventory.data.files.some(
                file =>
                  !file.reason &&
                  file.path === source.project?.path &&
                  file.version === source.project.version
              )) ||
            (source.material &&
              !materials?.data.some(
                material =>
                  material.id === source.material?.material.id &&
                  material.version === source.material.material.version
              ))
        )
      ) {
        toast.error(i18n.t('assistant.workflow.stale'))
        return
      }
      const contextServiceKey = modelProfileKey(modelConfig)
      const selected: AssistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        status: 'completed',
        scope: 'project',
        text: plan.plan,
        sources: message.sources,
        discussionPlan: plan,
        contextServiceKey,
      }
      const messages = appendConversationMessages(
        state.messages,
        activeConversationId,
        [
          {
            id: crypto.randomUUID(),
            role: 'user',
            status: 'completed',
            scope: 'project',
            text: i18n.t('assistant.workflow.selected'),
            sources: [],
            contextServiceKey,
          },
          selected,
        ]
      )
      const generation = historyGeneration
      saving = true
      set({ historyBusy: true })
      await queueAssistantHistorySave(
        owner,
        historyEpoch,
        messages,
        get().conversationTitles
      )
      if (
        get().owner !== owner ||
        generation !== historyGeneration ||
        get().messages !== state.messages
      )
        return
      useAssistantHandoffStore
        .getState()
        .offer(owner, selected.id, plan, 'discussion')
      set({ messages, historyBusy: false })
    } catch (error) {
      if (get().owner === owner) {
        set({
          historyBusy: false,
          ...(saving ? { historySaveError: historyFailure(error) } : {}),
        })
        if (!saving) toast.error(i18n.t('assistant.workflow.stale'))
        logger.warn('[assistant-discussion] saved plan selection failed', {
          reason: error instanceof Error ? error.name : 'unavailable',
        })
      }
    }
  },
  handoffToTerminal: async messageId => {
    const state = get()
    const owner = state.owner
    const item = useAssistantHandoffStore.getState().items[messageId]
    const topic = conversationMessages(
      state.messages,
      state.activeConversationId
    )
    if (
      !owner ||
      !state.modelConfig ||
      state.terminalHandoffBusy ||
      state.mode !== 'discussion' ||
      !sameDiscussionChoice(state, state) ||
      state.organizing ||
      !state.configured ||
      item?.mode !== 'discussion' ||
      item.identity !== owner ||
      topic.at(-1)?.id !== messageId ||
      useAssistantProjectStore.getState().planning ||
      useAssistantProjectStore.getState().whole ||
      !canUseCreationTerminal(owner)
    )
      return
    const token = {}
    terminalHandoffRequest = token
    const owns = () =>
      terminalHandoffRequest === token &&
      sameDiscussionChoice(state, get()) &&
      useAssistantHandoffStore.getState().items[messageId] === item &&
      canUseCreationTerminal(owner)
    set({ terminalHandoffBusy: true })
    try {
      const plan = await captureDiscussionPlan(state)
      if (!plan || !owns()) return
      const key = modelProfileKey(state.modelConfig)
      const answers = handoffDraftInput(
        topic.filter(message => message.contextServiceKey === key)
      ).sources.filter(source => source.kind === 'answer')
      const task = selectedHandoffTask([plan.source, ...answers])
      if (!task) throw new Error(i18n.t('assistant.workflow.terminalFailed'))
      const language = handoffLanguage([
        {
          role: 'user',
          text: plan.source.selectedPlan?.text ?? plan.source.text,
        },
      ])
      const context = expectOk(
        await commands.getProjectTerminalTaskContext(owner, language)
      )
      if (!owns()) return
      const path = expectOk(
        await commands.writeProjectTerminalTask(
          owner,
          terminalTaskDocument(task, context, language)
        )
      )
      if (!owns()) return
      // The file is a static export. Recheck selected saved evidence before
      // making it the copied/current handoff; later disk edits remain external.
      const confirmed = await captureDiscussionPlan(state)
      if (!confirmed || !owns()) return
      await writeText(
        i18n.getFixedT(language)('assistant.workflow.terminalPrompt', {
          path: JSON.stringify(path),
        })
      )
      if (!owns()) return
      if (!showCreationTerminal(owner))
        throw new Error(i18n.t('assistant.workflow.terminalFailed'))
      toast.success(i18n.t('assistant.workflow.terminalCopied'))
    } catch (error) {
      if (owns())
        toast.error(i18n.t('assistant.workflow.terminalFailed'), {
          description:
            error instanceof AssistantFlowError
              ? i18n.t(`assistant.error.${error.code}`)
              : String(error),
        })
    } finally {
      if (terminalHandoffRequest === token) {
        terminalHandoffRequest = null
        set({ terminalHandoffBusy: false })
      }
    }
  },
  startWork: async messageId => {
    const state = get()
    const item = useAssistantHandoffStore.getState().items[messageId]
    const topic = conversationMessages(
      state.messages,
      state.activeConversationId
    )
    const project = useCreationStore.getState().workspace?.project
    if (
      !item ||
      item.mode !== 'discussion' ||
      item.identity !== state.owner ||
      project?.identity !== state.owner ||
      project.source !== 'folder' ||
      state.phase !== 'idle' ||
      !state.configured ||
      !state.modelConfig ||
      state.activeQuestion ||
      state.resourceApproval ||
      state.editing ||
      state.canContinue ||
      state.paused ||
      state.resumeRestored ||
      state.organizing ||
      state.historyBusy ||
      state.historyState !== 'ready' ||
      !!state.historySaveError ||
      state.historicalMessageIds.includes(messageId) ||
      topic.at(-1)?.id !== messageId ||
      topic.at(-1)?.status !== 'completed' ||
      useAssistantProjectStore.getState().planning ||
      useAssistantProjectStore.getState().whole
    )
      return
    let plan
    try {
      plan = await captureDiscussionPlan(state)
    } catch {
      if (get().owner === state.owner) set({ error: 'projectScopeChanged' })
      return
    }
    if (!plan || !sameDiscussionChoice(state, get())) return
    const serviceKey = modelProfileKey(state.modelConfig)
    const decisions = handoffDraftInput(
      topic.filter(message => message.contextServiceKey === serviceKey)
    )
      .sources.filter(source => source.kind === 'answer')
      .map(source => source.text)
      .join('\n\n')
    const goal = i18n.t('assistant.workflow.task', {
      plan: plan.source.text,
      decisions,
    })
    get().setMode('edit')
    await get().send(
      false,
      false,
      false,
      goal,
      undefined,
      plan.materialEvidence
    )
    // Preparation can fail before a new user/reply pair is published. Retain
    // that live plan so retrying Start work cannot submit an unrelated draft.
    if (
      get().owner === item.identity &&
      conversationMessages(get().messages, get().activeConversationId).at(-1)
        ?.id !== messageId
    )
      useAssistantHandoffStore.getState().dismiss(messageId)
  },
  organizeProject: async supplement => {
    const state = get()
    const project = useCreationStore.getState().workspace?.project
    if (
      !state.owner ||
      project?.identity !== state.owner ||
      project.source !== 'folder' ||
      state.phase !== 'idle' ||
      !state.configured ||
      !state.modelConfig ||
      state.canContinue ||
      state.paused ||
      state.editing ||
      state.resourceApproval ||
      state.activeQuestion ||
      state.organizing ||
      state.historyState !== 'ready' ||
      state.historyBusy ||
      !!state.historySaveError ||
      useAssistantProjectStore.getState().planning ||
      useAssistantProjectStore.getState().whole
    )
      return
    if (
      supplement &&
      (typeof supplement.text !== 'string' ||
        supplement.text.length > 8192 ||
        !validOrganizationSources(supplement.sources))
    )
      return
    const goal = [
      i18n.t('assistant.organization.task'),
      ...(supplement
        ? [
            i18n.t('assistant.organization.rules.policy'),
            JSON.stringify(supplement),
          ]
        : []),
    ].join('\n\n')
    get().setMode('edit')
    await get().send(false, false, false, goal, supplement?.sources)
  },
  send: async (
    whole = false,
    continueTask = false,
    handoffDraft = false,
    taskInput,
    organizationSources,
    materialEvidence
  ) => {
    const merge = useCreationMergeStore.getState()
    if (merge.candidate && merge.identity === get().owner) {
      toast.error(i18n.t('creation.merge.assistant.scopeOnly'))
      return
    }
    if (get().resourceApproval || (get().activeQuestion && !continueTask))
      return
    const draftSkill =
      !whole &&
      !continueTask &&
      !handoffDraft &&
      taskInput === undefined &&
      !get().editing
        ? get().selectedSkill
        : null
    const originalInput = continueTask
      ? (taskLifecycle.attempt?.input ?? '')
      : handoffDraft
        ? i18n.t('assistant.handoff.generate')
        : (taskInput ?? get().input)
    const { owner, phase, configured, modelConfig, editing } = get()
    const retry =
      !whole &&
      (continueTask || get().error || get().canContinue || get().paused) &&
      (continueTask || !draftSkill) &&
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
    const skill: AssistantSkillCapture | undefined =
      retry?.skill ??
      (draftSkill && !retry
        ? {
            id: draftSkill,
            version: assistantSkills[draftSkill].version,
            creatorText: originalInput,
          }
        : undefined)
    const input =
      retry?.input ??
      wholePlan?.input ??
      (skill ? skillRequestInput(skill) : originalInput)
    let activeConversationId = get().activeConversationId
    let messages =
      retry?.history ??
      conversationMessages(get().messages, activeConversationId)
    if (!owner || phase !== 'idle' || !input.trim()) return
    if (
      get().historyState !== 'ready' ||
      get().historyBusy ||
      !!get().historySaveError
    )
      return
    if (configured === false) {
      set({ error: 'notConfigured' })
      return
    }
    if (
      skill &&
      assistantSkills[skill.id].mode !== (retry?.mode ?? get().mode)
    ) {
      set({ skillModeMismatch: true })
      return
    }
    if (
      !retry &&
      !continueTask &&
      !handoffDraft &&
      taskInput === undefined &&
      !editing &&
      !skill &&
      !get().fileReferences.length &&
      (get().mode === 'discussion' || isStartWorkRequest(originalInput))
    ) {
      const project = useCreationStore.getState().workspace?.project
      if (
        project?.identity === owner &&
        project.source === 'folder' &&
        !get().paused &&
        !get().canContinue &&
        !get().resumeRestored
      ) {
        if (isProjectOrganizationRequest(originalInput)) get().setMode('edit')
        else if (
          isHandoffRequest(originalInput) &&
          messages.some(
            message => message.role === 'user' && message.status === 'completed'
          )
        ) {
          set({ input: '' })
          await get().prepareHandoff()
          return
        } else if (isStartWorkRequest(originalInput)) {
          const last = messages.at(-1)
          if (
            last &&
            last.role === 'assistant' &&
            last.status === 'completed' &&
            modelConfig &&
            last.contextServiceKey === modelProfileKey(modelConfig) &&
            !get().historicalMessageIds.includes(last.id) &&
            useAssistantHandoffStore.getState().items[last.id]?.identity ===
              owner &&
            useAssistantHandoffStore.getState().items[last.id]?.mode ===
              'discussion'
          ) {
            set({ input: '' })
            await get().startWork(last.id)
            return
          }
          toast.error(i18n.t('assistant.workflow.planRequired'))
          return
        }
      }
    }
    const preparingHandoff =
      handoffDraft || retry?.continuation?.purpose === 'handoffDraft'
    let selectedPlan
    if (preparingHandoff && !retry?.continuation) {
      const state = get()
      try {
        selectedPlan = await captureDiscussionPlan(state, true)
      } catch {
        if (get().owner === owner) set({ handoffDraftError: true })
        return
      }
      if (!sameDiscussionChoice(state, get())) return
    }
    const handoffSources = preparingHandoff
      ? (retry?.continuation?.handoffDraftSources ?? [
          ...handoffDraftInput(messages).sources,
          ...(selectedPlan ? [selectedPlan.source] : []),
        ])
      : undefined
    const handoffKey = preparingHandoff
      ? (retry?.continuation?.handoffDraftKey ??
        JSON.stringify([activeConversationId, messages.at(-1)?.id]))
      : undefined
    if (
      preparingHandoff &&
      (!handoffSources?.some(
        source => source.kind === 'creator' || source.kind === 'answer'
      ) ||
        get().mode !== 'discussion')
    )
      return
    const userId = retry?.userId ?? crypto.randomUUID()
    const replyId = retry?.replyId ?? crypto.randomUUID()
    const attempt: AssistantTaskAttempt = {
      skill,
      fileReferences:
        retry?.fileReferences ??
        (!retry &&
        !whole &&
        !continueTask &&
        taskInput === undefined &&
        !preparingHandoff
          ? get().fileReferences
          : undefined),
      materialEvidence:
        retry?.materialEvidence ??
        retry?.continuation?.materialEvidence ??
        materialEvidence ??
        selectedPlan?.materialEvidence ??
        [],
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
      // Detached entries must capture their empty set before preparation can pause.
      organizationSources:
        retry?.organizationSources ??
        (organizationSources
          ? structuredClone(organizationSources)
          : undefined),
      attachments:
        retry?.attachments ??
        (taskInput !== undefined || preparingHandoff ? [] : undefined),
    }
    const execution = taskLifecycle.start(attempt)
    const owns = () => get().owner === owner && execution.isCurrent()
    set({
      phase: 'reading',
      paused: false,
      canContinue: false,
      resumeRestored: false,
      resumeError: false,
      questionCancelError: false,
      skillModeMismatch: false,
    })
    try {
      if (taskLifecycle.retirementPending)
        await taskLifecycle.waitForRetirements(owner)
    } catch {
      if (owns()) set({ phase: 'idle', resumeError: true })
      execution.release()
      return
    }
    if (!owns()) {
      execution.release()
      return
    }
    let project: AssistantProjectSnapshot | null | undefined
    let consumers: AssistantContextConsumer[] = []
    {
      if (!modelConfig) {
        set({ phase: 'idle', error: 'notConfigured' })
        execution.release()
        return
      }
      set({ phase: 'reading', error: null })
      try {
        project = await useAssistantProjectStore
          .getState()
          .prepare(
            owner,
            !preparingHandoff &&
              taskInput === undefined &&
              (!retry || !!retry.attachments?.length)
          )
        if (!owns()) {
          execution.release()
          return
        }
        if (project) {
          useAssistantOverviewStore.getState().syncWorkspace(owner)
          const overview = await useAssistantOverviewStore
            .getState()
            .refresh(owner)
          if (!owns()) {
            execution.release()
            return
          }
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
          if (!retry && attempt.fileReferences?.length) {
            await verifyAssistantFileReferences(
              owner,
              project,
              attempt.fileReferences
            )
            if (!owns()) {
              execution.release()
              return
            }
          }
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
        execution.release()
        return
      }
    }
    const attachments = useAssistantProjectStore.getState().attachments
    if (wholePlan) useAssistantProjectStore.setState({ whole: null })
    const snapshots =
      preparingHandoff || taskInput !== undefined
        ? []
        : (retry?.attachments ??
          attachments.map(item => ({
            ...item.snapshot,
            projectKey: get().historyProjectKey ?? '',
          })))
    const beforeAdmission = get()
    if (editing) {
      const index = messages.findIndex(
        message => message.id === editing.messageId && message.role === 'user'
      )
      if (index < 0) {
        execution.release()
        return
      }
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
            fileReferences: state.fileReferences,
            selectedSkill: state.selectedSkill,
          },
        },
        editing: null,
        selectedSkill: null,
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
      preparingHandoff,
      handoffDraftError: false,
      input:
        continueTask ||
        preparingHandoff ||
        taskInput !== undefined ||
        get().input !== originalInput
          ? get().input
          : '',
      submittedInput: skill?.creatorText ?? input,
      ...(draftSkill && !retry ? { selectedSkill: null } : {}),
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
                text: skill?.creatorText ?? input,
                ...(skill ? { skill: skill.id } : {}),
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
    await get().persistHistory()
    await flushAssistantHistory()
    if (!owns() || execution.signal.aborted) {
      execution.release()
      return
    }
    if (get().historySaveError || get().historySaving) {
      taskLifecycle.stop(true)
      const previous = new Map(
        beforeAdmission.messages.map(message => [message.id, message])
      )
      set(state => ({
        // Retire only this admission's new records. Existing proposal publishers
        // may have updated an older reply while the queued saves were pending.
        messages: state.messages.flatMap(message => {
          const original = previous.get(message.id)
          if (!original) return []
          if (message.id === userId || message.id === replyId)
            return [
              {
                ...message,
                status: original.status,
                error: original.error,
                ...(message.id === replyId
                  ? {
                      text: original.text,
                      activity: original.activity,
                      sources: original.sources,
                    }
                  : {}),
              },
            ]
          return [message]
        }),
        activeConversationId: beforeAdmission.activeConversationId,
        conversationDrafts: beforeAdmission.conversationDrafts,
        historicalMessageIds: beforeAdmission.historicalMessageIds,
        editing: beforeAdmission.editing,
        selectedSkill: state.selectedSkill ?? beforeAdmission.selectedSkill,
        input: state.input || beforeAdmission.input || originalInput,
        submittedInput: null,
        phase: 'idle',
        preparingHandoff: false,
      }))
      execution.release()
      return
    }
    try {
      const selectedTask = preparingHandoff
        ? selectedHandoffTask(handoffSources ?? [])
        : undefined
      const selectedMaterials = attempt.materialEvidence ?? []
      if (selectedTask && selectedMaterials.length) {
        const catalog = await commands.listCreationMaterials(owner)
        if (!owns() || execution.signal.aborted) return
        if (
          catalog.status === 'error' ||
          selectedMaterials.some(
            source =>
              !catalog.data.some(
                material =>
                  material.id === source.id &&
                  material.version === source.version
              )
          )
        )
          throw new AssistantFlowError('projectScopeChanged')
      }
      if (!owns() || execution.signal.aborted) return
      const result: Awaited<ReturnType<typeof runAssistantRequest>> =
        selectedTask
          ? { text: '', sources: [], handoffDraft: selectedTask }
          : await runAssistantRequest({
              identity: owner,
              skill: attempt.skill,
              materialEvidence: attempt.materialEvidence,
              organizationSources: attempt.organizationSources,
              fileReferences: attempt.fileReferences,
              purpose: preparingHandoff ? 'handoffDraft' : undefined,
              handoffDraftSources: handoffSources,
              handoffDraftKey: handoffKey,
              mode: attempt.mode,
              questionScope: retry?.continuation?.questionScope ?? {
                chatId: attempt.conversationId ?? 'original',
                messageId: replyId,
              },
              onTask: task => {
                execution.bindTask(task.id)
                if (owns() && task.questions?.length)
                  set(state => ({
                    messages: state.messages.map(message =>
                      message.id === replyId
                        ? { ...message, questions: task.questions }
                        : message
                    ),
                  }))
              },
              expectedConfig: modelConfig,
              projectReading: !!project,
              project: project ?? undefined,
              wholeProjectFingerprint: wholePlan?.snapshot.fingerprint,
              attachments: snapshots,
              consumers: preparingHandoff ? [] : consumers,
              input,
              history: preparingHandoff ? [] : messages,
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
                if (preparingHandoff) return
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
                      message.id === replyId
                        ? { ...message, activity }
                        : message
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
              onReadmeResult: readmeResult => {
                if (!owns()) return
                set(state => ({
                  messages: state.messages.map(message =>
                    message.id === replyId
                      ? { ...message, readmeResult }
                      : message
                  ),
                }))
                void get().persistHistory()
              },
            })
      if (!owns()) return
      if (result.question) {
        await execution.waitForQuestion()
        if (!owns()) return
        const taskId = attempt.continuation?.taskId
        if (!taskId) throw new AssistantFlowError('requestFailed')
        set({
          phase: 'idle',
          error: null,
          paused: false,
          canContinue: false,
          submittedInput: null,
          preparingHandoff: false,
          activeQuestion: {
            taskId,
            replyId,
            question: result.question,
            ready: true,
            conversationId: attempt.conversationId,
          },
          questionBusy: false,
        })
        await get().persistHistory()
        return
      }
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
      const handoffTask = preparingHandoff ? result.handoffDraft : null
      if (preparingHandoff && !handoffTask)
        throw new AssistantFlowError('protocol')
      await execution.complete(async () => {
        if (result.handoff)
          useAssistantHandoffStore
            .getState()
            .offer(owner, replyId, result.handoff, attempt.mode)
        revise('completed')
        if (wholePlan) useAssistantProjectStore.getState().cancelWhole()
        useAssistantProjectStore
          .getState()
          .consumeAttachments(snapshots.map(item => item.id))
        set(state => ({
          phase: 'idle',
          ...(get().activeConversationId === activeConversationId
            ? {
                fileReferences: state.fileReferences.filter(
                  reference => !attempt.fileReferences?.includes(reference)
                ),
              }
            : {}),
          preparingHandoff: false,
          paused: false,
          canContinue: false,
          submittedInput: null,
          messages: state.messages.map(message =>
            message.id === replyId
              ? {
                  ...message,
                  text: handoffTask
                    ? i18n.t('assistant.handoff.draftReady')
                    : result.discussionIncomplete
                      ? `${i18n.t('assistant.workflow.incomplete')}\n\n${result.text}`
                      : result.text,
                  sources: result.sources,
                  reasoningContent: result.reasoningContent,
                  checkOutcome: result.checkOutcome,
                  ...(result.readmeResult
                    ? { readmeResult: result.readmeResult }
                    : {}),
                  ...(result.handoff?.plan
                    ? {
                        discussionPlan: {
                          ...result.handoff,
                          plan: result.handoff.plan,
                        },
                      }
                    : {}),
                }
              : message
          ),
        }))
        if (handoffTask && handoffKey) {
          const id = replyId
          set(state => ({
            handoffDraftIds: {
              ...state.handoffDraftIds,
              [handoffKey]: id,
              [JSON.stringify([activeConversationId, replyId])]: id,
            },
          }))
          await useCreationHandoffStore
            .getState()
            .prepareTask({ ...handoffTask, id }, owns)
        }
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
        preparingHandoff: false,
        handoffDraftError: preparingHandoff,
        error: paused ? null : code,
        paused,
        canContinue,
        input:
          state.input ||
          skill?.creatorText ||
          (skill ? '' : state.submittedInput) ||
          '',
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
export async function stopAndPersistAssistantHistory(): Promise<boolean> {
  await useMergeAssistantStore.getState().stop()
  const owner = useAssistantStore.getState().owner
  useAssistantStore.getState().stop(true)
  await useAssistantStore.getState().persistHistory()
  await flushAssistantHistory()
  await flushAssistantResume().catch(() => undefined)
  const state = useAssistantStore.getState()
  return (
    !owner ||
    (state.owner === owner &&
      state.messages.length === 0 &&
      !state.historySaveError) ||
    (state.owner === owner &&
      state.historyState === 'ready' &&
      !state.historyBusy &&
      !state.historySaveError)
  )
}

export async function waitForAssistantTaskRetirements(): Promise<void> {
  await taskLifecycle.waitForRetirements(
    useAssistantStore.getState().owner ?? undefined
  )
}

useCreationStore.subscribe(state => {
  const owner = state.active
    ? (state.workspace?.project.identity ?? null)
    : null
  useAssistantStore.getState().syncWorkspace(owner)
})

// Recording happens after generation. Publish its actual receipt back at the
// original reply as a durable display snapshot, without restoring a live action.
useCreationHandoffStore.subscribe((next, previous) => {
  const receipt = next.receipt
  if (!receipt?.taskRecorded || receipt === previous.receipt) return
  const state = useAssistantStore.getState()
  const project = useCreationStore.getState().workspace?.project
  if (!project || project.identity !== state.owner) return
  const originId = next.receiptOriginId ?? receipt.task.id
  if (
    !state.messages.some(
      message =>
        message.id === originId &&
        message.role === 'assistant' &&
        message.status === 'completed' &&
        message.scope === 'project' &&
        !message.contextMarker
    )
  )
    return
  const recorded = recordedHandoff(
    project.root,
    receipt.task.id,
    receipt.revision,
    handoffReplyLanguage(state.messages, originId)
  )
  useAssistantStore.setState({
    messages: state.messages.map(message =>
      message.id === originId ? { ...message, ...recorded } : message
    ),
    handoffDraftIds: Object.fromEntries(
      Object.entries(state.handoffDraftIds).map(([key, id]) => [
        key,
        id === originId ? receipt.task.id : id,
      ])
    ),
  })
  void useAssistantStore.getState().persistHistory()
})
