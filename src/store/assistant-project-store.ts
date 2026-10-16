import { create } from 'zustand'
import {
  commands,
  type AssistantProjectSnapshot,
  type ModelServiceConfig,
  type AssistantHistoryAttachment,
} from '@/lib/tauri-bindings'
import { modelConfigurationKey } from '@/lib/model-context-settings'
import { AssistantFlowError } from '@/lib/assistant-types'
import type { TextBuffer } from '@/lib/text-buffer'
import type { AssistantMessage } from '@/lib/assistant-types'
import {
  collectWholeProject,
  type WholeProjectPlan,
} from '@/lib/assistant-whole-project'
import { useAssistantOverviewStore } from './assistant-overview-store'
import i18n, { currentResolvedLanguage } from '@/i18n/config'
import { toast } from 'sonner'

export interface AssistantSelection {
  identity: string
  path: string
  version: string
  source: AssistantHistoryAttachment['source']
  buffer: TextBuffer
  proposalId?: string
  candidateRevision?: number
}
export interface PendingAssistantAttachment {
  snapshot: AssistantHistoryAttachment
  buffer: TextBuffer
  document: string
  baseVersion: string
  identity: string
}

interface ProjectConsent {
  owner: string
  service: string
  input: string
  snapshot: AssistantProjectSnapshot
  attachmentIds: string
}
interface AssistantProjectState {
  owner: string | null
  reading: boolean
  snapshot: AssistantProjectSnapshot | null
  consent: ProjectConsent | null
  authorization: { owner: string; service: string; paths: string[] } | null
  attachments: PendingAssistantAttachment[]
  attachmentError: boolean
  whole: WholeProjectPlan | null
  planning: boolean
  planWhole: (
    owner: string,
    config: ModelServiceConfig,
    input: string,
    history: readonly AssistantMessage[]
  ) => Promise<void>
  confirmWhole: (
    owner: string,
    config: ModelServiceConfig,
    input: string
  ) => Promise<boolean>
  cancelWhole: () => void
  attachSelection: (selection: AssistantSelection) => Promise<boolean>
  removeAttachment: (id: string) => void
  consumeAttachments: (ids: string[]) => void
  syncWorkspace: (owner: string | null) => void
  setReading: (reading: boolean) => void
  revoke: () => void
  cancelConsent: () => void
  confirmConsent: (
    owner: string,
    config: ModelServiceConfig,
    input: string
  ) => boolean
  prepare: (
    owner: string,
    config: ModelServiceConfig,
    input: string
  ) => Promise<AssistantProjectSnapshot | null | undefined>
}
let revision = 0

/** Transient sending authority, never persisted with local history. */
export const useAssistantProjectStore = create<AssistantProjectState>(
  (set, get) => ({
    owner: null,
    reading: false,
    snapshot: null,
    consent: null,
    authorization: null,
    attachments: [],
    attachmentError: false,
    whole: null,
    planning: false,
    syncWorkspace: owner => {
      if (get().owner === owner) return
      revision++
      set({
        owner,
        reading: false,
        snapshot: null,
        consent: null,
        authorization: null,
        attachments: [],
        attachmentError: false,
        whole: null,
        planning: false,
      })
    },
    setReading: reading => {
      revision++
      set({
        reading,
        consent: null,
        authorization: null,
        whole: null,
        planning: false,
      })
    },
    revoke: () => {
      revision++
      set({ consent: null, authorization: null, whole: null, planning: false })
    },
    cancelConsent: () => {
      revision++
      set({ consent: null })
    },
    cancelWhole: () => {
      revision++
      set({ whole: null, planning: false })
    },
    planWhole: async (owner, config, input, history) => {
      if (get().owner !== owner || get().planning) return
      const token = ++revision
      const current = () => {
        if (token !== revision || get().owner !== owner)
          throw new AssistantFlowError('cancelled')
      }
      set({ reading: true, consent: null, whole: null, planning: true })
      let plan: WholeProjectPlan | null = null
      try {
        const inventory = await commands.assistantProjectInventory(owner)
        current()
        if (inventory.status === 'error')
          throw new AssistantFlowError('projectUnavailable')
        const attachments = get().attachments.map(item => item.snapshot)
        const locale = currentResolvedLanguage() === 'zh-CN' ? 'zh-CN' : 'en'
        plan = {
          owner,
          service: modelConfigurationKey(config),
          originalInput: input,
          input: input.trim() ? input : i18n.t('assistant.whole.defaultInput'),
          snapshot: inventory.data,
          consumer: null,
          measurement: null,
          error: null,
          approved: false,
          attachmentIds: attachments.map(item => item.id).join(','),
        }
        set({ whole: plan, snapshot: inventory.data })
        useAssistantOverviewStore.getState().syncWorkspace(owner)
        const overview = await useAssistantOverviewStore
          .getState()
          .refresh(owner)
        current()
        if (
          !overview ||
          overview.snapshot.fingerprint !== inventory.data.fingerprint
        )
          throw new AssistantFlowError('projectScopeChanged')
        const facts = useAssistantOverviewStore
          .getState()
          .contextConsumer(owner, config, locale)
        if (!facts) throw new AssistantFlowError('projectScopeChanged')
        const collected = await collectWholeProject({
          owner,
          config,
          input: plan.input,
          history,
          snapshot: inventory.data,
          attachments,
          consumers: [facts],
          locale,
          check: current,
        })
        const latest = await commands.assistantProjectInventory(owner)
        current()
        if (
          latest.status === 'error' ||
          latest.data.fingerprint !== plan.snapshot.fingerprint
        )
          throw new AssistantFlowError('projectScopeChanged')
        set({
          whole: { ...plan, ...collected, overviewConsumer: facts },
          planning: false,
        })
      } catch (error) {
        if (token === revision && get().owner === owner)
          set({
            planning: false,
            whole: plan
              ? {
                  ...plan,
                  error:
                    error instanceof AssistantFlowError
                      ? error.code
                      : 'projectUnavailable',
                }
              : null,
            attachmentError: plan === null,
          })
      }
    },
    confirmWhole: async (owner, config, input) => {
      const plan = get().whole
      if (
        !plan ||
        plan.error ||
        !plan.consumer ||
        get().planning ||
        !get().reading ||
        plan.owner !== owner ||
        plan.service !== modelConfigurationKey(config) ||
        plan.originalInput !== input ||
        plan.attachmentIds !==
          get()
            .attachments.map(item => item.snapshot.id)
            .join(',')
      )
        return false
      const token = ++revision
      set({ planning: true })
      try {
        const result = await commands.assistantProjectInventory(owner)
        if (token !== revision || get().owner !== owner) return false
        if (
          result.status === 'error' ||
          result.data.fingerprint !== plan.snapshot.fingerprint
        ) {
          set({
            planning: false,
            whole: {
              ...plan,
              error: 'projectScopeChanged',
              consumer: null,
              measurement: null,
            },
          })
          return false
        }
        set({
          planning: false,
          whole: { ...plan, approved: true },
          authorization: {
            owner,
            service: plan.service,
            paths: plan.snapshot.files
              .filter(file => !file.reason)
              .map(file => file.path),
          },
        })
        return true
      } catch {
        if (token === revision)
          set({
            planning: false,
            whole: { ...plan, error: 'projectUnavailable' },
          })
        return false
      }
    },
    confirmConsent: (owner, config, input) => {
      const consent = get().consent
      if (
        !consent ||
        !get().reading ||
        consent.owner !== owner ||
        consent.service !== modelConfigurationKey(config) ||
        consent.input !== input ||
        consent.attachmentIds !==
          get()
            .attachments.map(item => item.snapshot.id)
            .join(',')
      ) {
        set({ consent: null })
        return false
      }
      set({
        authorization: {
          owner,
          service: consent.service,
          paths: consent.snapshot.files
            .filter(file => !file.reason)
            .map(file => file.path),
        },
        consent: null,
      })
      return true
    },
    attachSelection: async selection => {
      const { identity, path, buffer, version, source } = selection
      const document = buffer.text
      const text = buffer.selectedText
      const state = buffer.getSnapshot()
      const { from, to } = buffer.selection
      const startLine = state.doc.lineAt(from).number
      const endLine = state.doc.lineAt(Math.max(from, to - 1)).number
      const token = revision
      const fail = () => {
        if (get().owner === identity && token === revision) {
          set({ attachmentError: true })
          toast.error(i18n.t('assistant.error.attachmentExcluded'))
        }
        return false
      }
      if (
        get().owner !== identity ||
        !text ||
        text.length > 2000 ||
        new TextEncoder().encode(document).length > 65536 ||
        get().attachments.length >= 8 ||
        get().attachments.reduce(
          (sum, item) => sum + item.snapshot.text.length,
          0
        ) +
          text.length >
          12000
      )
        return fail()
      try {
        const result = await commands.assistantProjectRead(identity, {
          path,
          version: null,
          offset: 0,
          pageLength: 64,
        })
        if (get().owner !== identity || token !== revision) return false
        if (
          result.status === 'error' ||
          (source === 'saved' && result.data.version !== version)
        )
          return fail()
        const id = crypto.randomUUID()
        revision++
        set(current => ({
          consent: null,
          whole: null,
          planning: false,
          attachmentError: false,
          attachments: [
            ...current.attachments,
            {
              identity,
              buffer,
              document,
              baseVersion: version,
              snapshot: {
                id,
                projectKey: '',
                path,
                startLine,
                endLine,
                text,
                source,
                version:
                  source === 'saved' ? version : `${version}:${source}:${id}`,
                sourceVersion: version,
                ...(selection.proposalId
                  ? { proposalId: selection.proposalId }
                  : {}),
                ...(selection.candidateRevision !== undefined
                  ? { candidateRevision: selection.candidateRevision }
                  : {}),
              },
            },
          ],
        }))
        return true
      } catch {
        return fail()
      }
    },
    removeAttachment: id => {
      revision++
      set(state => ({
        consent: null,
        whole: null,
        planning: false,
        attachments: state.attachments.filter(item => item.snapshot.id !== id),
        attachmentError: false,
      }))
    },
    consumeAttachments: ids =>
      set(state => ({
        attachments: state.attachments.filter(
          item => !ids.includes(item.snapshot.id)
        ),
      })),
    prepare: async (owner, config, input) => {
      if (!get().reading) {
        if (get().attachments.length)
          throw new AssistantFlowError('projectReadingDisabled')
        return undefined
      }
      const token = ++revision
      const result = await commands.assistantProjectInventory(owner)
      if (token !== revision || get().owner !== owner || !get().reading)
        throw new AssistantFlowError('cancelled')
      if (result.status === 'error')
        throw new AssistantFlowError('projectUnavailable')
      const snapshot = result.data
      for (const item of get().attachments) {
        if (
          item.identity !== owner ||
          !snapshot.files.some(
            file => !file.reason && file.path === item.snapshot.path
          )
        )
          throw new AssistantFlowError('attachmentExcluded')
      }
      const service = modelConfigurationKey(config)
      const authorization = get().authorization
      set({ snapshot })
      if (
        !authorization ||
        authorization.owner !== owner ||
        authorization.service !== service ||
        snapshot.files.some(
          file => !file.reason && !authorization.paths.includes(file.path)
        )
      ) {
        set({
          authorization: null,
          consent: {
            owner,
            service,
            input,
            snapshot,
            attachmentIds: get()
              .attachments.map(item => item.snapshot.id)
              .join(','),
          },
        })
        return null
      }
      return snapshot
    },
  })
)
