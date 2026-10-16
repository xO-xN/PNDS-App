import { create } from 'zustand'
import {
  commands,
  type ParameterCandidate,
  type ParameterRequest,
  type CreationFileChange,
  type CreationError,
  type AssistantHistoryProposal,
} from '@/lib/tauri-bindings'
import type { ProposedText } from '@/lib/assistant-proposals'
import type { AssistantProposal } from '@/components/creation/AssistantProposalCard'
import { TextBuffer } from '@/lib/text-buffer'
import { useCreationStore, creationTransportError } from './creation-store'
import { useCreationFilesStore, isDraftDirty } from './creation-files-store'
import { useParameterPreviewStore } from './parameter-preview-store'
import { useSessionStore } from './session-store'
import { parameterValueValid } from '@/lib/parameter-values'

export interface LiveProposal extends AssistantProposal {
  before: string
  recommended: string
  requests: ParameterRequest[]
  binding: ParameterCandidate | null
  buffer: TextBuffer
  applying: boolean
  bindingBusy: boolean
  error: CreationError | null
  records: readonly CreationFileChange[]
  projectKey: string
}
type Publish = (snapshot: AssistantHistoryProposal) => void
interface ProposalState {
  items: Record<string, LiveProposal>
  install: (
    identity: string,
    messageId: string,
    projectKey: string,
    proposals: ProposedText[],
    publish: Publish
  ) => void
  editCode: (id: string, text: string) => void
  setParameter: (
    id: string,
    parameterId: string,
    value: number | boolean | string
  ) => Promise<void>
  rebind: (id: string) => Promise<boolean>
  preview: (id: string) => Promise<void>
  apply: (id: string) => Promise<void>
  reload: (id: string) => Promise<void>
  clear: () => void
}
const publishers = new Map<string, Publish>()
const parameterTickets = new Map<string, number>()
let epoch = 0
function owned(proposal: LiveProposal) {
  return (
    useCreationStore.getState().workspace?.project.identity ===
    proposal.identity
  )
}
function snapshot(item: LiveProposal): AssistantHistoryProposal {
  return {
    id: item.id,
    projectKey: item.projectKey,
    path: item.source.path,
    sourceVersion: item.source.version,
    candidateRevision: item.candidate.revision,
    text: item.candidate.text,
    preview: item.preview,
    pendingRefresh: item.pendingRefresh,
    appliedDiff: item.appliedDiff,
  }
}

/** Buffers and execution records never alias file drafts or one another. */
export const useAssistantProposalStore = create<ProposalState>((set, get) => {
  const patch = (id: string, update: Partial<LiveProposal>, publish = true) => {
    const item = get().items[id]
    if (!item) return
    const next = { ...item, ...update }
    set(state => ({ items: { ...state.items, [id]: next } }))
    if (publish) publishers.get(id)?.(snapshot(next))
  }
  return {
    items: {},
    install: (identity, messageId, projectKey, proposals, publish) => {
      if (useCreationStore.getState().workspace?.project.identity !== identity)
        return
      for (const proposal of proposals) {
        publishers.set(proposal.id, publish)
        const item: LiveProposal = {
          id: proposal.id,
          messageId,
          identity,
          source: { path: proposal.path, version: proposal.version },
          before: proposal.sourceText,
          recommended: proposal.text,
          candidate: { revision: 1, text: proposal.text },
          preview: 'none',
          pendingRefresh: false,
          appliedDiff: null,
          requests: proposal.parameters,
          binding: proposal.binding,
          buffer: new TextBuffer(proposal.text, proposal.path),
          applying: false,
          bindingBusy: false,
          error: null,
          records: [],
          projectKey,
        }
        set(state => ({ items: { ...state.items, [item.id]: item } }))
        publish(snapshot(item))
      }
    },
    editCode: (id, text) => {
      const item = get().items[id]
      if (!item || !owned(item) || text === item.candidate.text) return
      parameterTickets.set(id, (parameterTickets.get(id) ?? 0) + 1)
      void useParameterPreviewStore.getState().end()
      item.buffer.sync(text)
      patch(id, {
        candidate: { revision: item.candidate.revision + 1, text },
        preview: 'none',
        binding: null,
        error: null,
      })
      void get().rebind(id)
    },
    rebind: async id => {
      const item = get().items[id]
      if (!item || !owned(item)) return false
      const generation = epoch
      const current = () =>
        generation === epoch &&
        owned(item) &&
        get().items[id]?.candidate === item.candidate &&
        get().items[id]?.source === item.source
      if (!item.requests.length) {
        patch(
          id,
          {
            binding: {
              parameters: [],
              partial: item.candidate.text !== item.before,
              contractVersion: null,
            },
          },
          false
        )
        return true
      }
      patch(id, { bindingBusy: true }, false)
      try {
        const result = await commands.bindCreationParameters(
          item.identity,
          item.source.path,
          item.source.version,
          item.candidate.text,
          item.requests
        )
        if (!current()) return false
        patch(
          id,
          {
            binding: result.status === 'ok' ? result.data : null,
            bindingBusy: false,
          },
          false
        )
        return result.status === 'ok'
      } catch {
        if (current()) patch(id, { binding: null, bindingBusy: false }, false)
        return false
      }
    },
    setParameter: async (id, parameterId, value) => {
      const item = get().items[id]
      if (!item || !owned(item) || item.applying || item.bindingBusy) return
      const parameter = item.binding?.parameters.find(
        parameter =>
          parameter.request.spec.id === parameterId && parameter.value !== null
      )
      if (!parameter) return
      const { spec } = parameter.request
      if (!parameterValueValid(spec, value)) return
      const lines = item.candidate.text.split(/(?<=\n)/)
      const matches = lines.flatMap((line, index) => {
        const body = line.replace(/[\r\n]+$/, '')
        return body.startsWith(spec.prefix) && body.endsWith(spec.suffix)
          ? [index]
          : []
      })
      if (matches.length !== 1) return
      const index = matches[0]
      if (index === undefined) return
      const line = lines[index]
      if (line === undefined) return
      const body = line.replace(/[\r\n]+$/, '')
      lines[index] =
        `${spec.prefix}${JSON.stringify(value)}${spec.suffix}${line.slice(body.length)}`
      const text = lines.join('')
      const ticket = (parameterTickets.get(id) ?? 0) + 1
      parameterTickets.set(id, ticket)
      item.buffer.sync(text)
      const candidate = { revision: item.candidate.revision + 1, text }
      patch(id, {
        candidate,
        binding: item.binding
          ? {
              ...item.binding,
              parameters: item.binding.parameters.map(p =>
                p.request.spec.id === parameterId ? { ...p, value } : p
              ),
            }
          : null,
        error: null,
      })
      // Validate before publishing a control edit; hard bounds are local facts.
      const generation = epoch
      try {
        const result = await commands.bindCreationParameters(
          item.identity,
          item.source.path,
          item.source.version,
          text,
          item.requests
        )
        if (
          generation !== epoch ||
          parameterTickets.get(id) !== ticket ||
          get().items[id]?.candidate !== candidate ||
          !owned(item)
        )
          return
        if (
          result.status !== 'ok' ||
          result.data.parameters.find(p => p.request.spec.id === parameterId)
            ?.value == null
        ) {
          patch(id, { binding: null })
          return
        }
        patch(id, { binding: result.data }, false)
        if (spec.preview === 'live') await get().preview(id)
      } catch {
        /* Preserve the current buffer on invalid or late controls. */
      }
    },
    preview: async id => {
      if (!(await get().rebind(id))) return
      const item = get().items[id]
      if (!item?.binding || !owned(item) || item.applying) return
      await useParameterPreviewStore.getState().preview(
        {
          identity: item.identity,
          proposalId: id,
          revision: item.candidate.revision,
          path: item.source.path,
          version: item.source.version,
        },
        item.binding
      )
    },
    apply: async id => {
      const item = get().items[id]
      if (
        !item ||
        !owned(item) ||
        item.applying ||
        item.candidate.text === item.before
      )
        return
      const generation = epoch
      const current = () =>
        epoch === generation &&
        owned(item) &&
        get().items[id]?.source === item.source
      patch(id, { applying: true, error: null })
      try {
        await useParameterPreviewStore.getState().end()
        if (!current() || get().items[id]?.candidate !== item.candidate) return
        const files = useCreationFilesStore.getState()
        if (!files.drafts[item.source.path])
          await files.read(item.identity, item.source.path)
        if (!current() || get().items[id]?.candidate !== item.candidate) return
        const draft = useCreationFilesStore.getState().drafts[item.source.path]
        if (
          !draft ||
          isDraftDirty(draft) ||
          draft.diskVersion !== item.source.version ||
          draft.diskText !== item.before
        ) {
          patch(id, { error: { code: 'versionConflict', detail: '' } })
          return
        }
        const success = await useCreationFilesStore
          .getState()
          .saveReviewed(
            item.source.path,
            item.before,
            item.candidate.text,
            item.source.version,
            item.identity,
            'proposal'
          )
        if (!current()) return
        const change = useCreationFilesStore.getState().lastChange
        if (!success || !change) {
          patch(id, {
            error: useCreationFilesStore.getState().changeError ?? {
              code: 'versionConflict',
              detail: '',
            },
          })
          return
        }
        const requests = (item.binding?.parameters ?? []).flatMap(p =>
          p.value !== null ? [{ ...p.request, current: p.value }] : []
        )
        patch(id, {
          source: { path: item.source.path, version: change.afterVersion },
          before: change.afterText,
          requests,
          binding: null,
          preview: 'none',
          pendingRefresh: true,
          appliedDiff: { before: change.beforeText, after: change.afterText },
          records: [
            ...(get().items[id]?.records ?? []),
            structuredClone(change),
          ],
        })
        void get().rebind(id)
      } catch (cause) {
        if (current()) patch(id, { error: creationTransportError(cause) })
      } finally {
        if (epoch === generation && owned(item) && get().items[id])
          patch(id, { applying: false })
      }
    },
    reload: async id => {
      const item = get().items[id]
      if (!item || !owned(item) || item.applying) return
      const generation = epoch
      const current = () =>
        generation === epoch &&
        owned(item) &&
        get().items[id]?.candidate === item.candidate
      try {
        await useParameterPreviewStore.getState().end()
        if (!current()) return
        const result = await commands.readCreationFile(
          item.identity,
          item.source.path
        )
        if (!current()) return
        if (result.status === 'error') {
          patch(id, { error: result.error })
          return
        }
        if (result.data.kind !== 'text') return
        item.buffer.sync(result.data.text)
        patch(id, {
          source: { path: item.source.path, version: result.data.version },
          before: result.data.text,
          candidate: {
            revision: item.candidate.revision + 1,
            text: result.data.text,
          },
          requests: [],
          binding: null,
          preview: 'none',
          error: null,
        })
      } catch (cause) {
        if (current()) patch(id, { error: creationTransportError(cause) })
      }
    },
    clear: () => {
      epoch++
      publishers.clear()
      parameterTickets.clear()
      set({ items: {} })
      void useParameterPreviewStore.getState().end()
    },
  }
})

useCreationStore.subscribe((state, previous) => {
  if (
    state.workspace?.project.identity !==
      previous.workspace?.project.identity ||
    state.active !== previous.active
  )
    useAssistantProposalStore.getState().clear()
})
useCreationFilesStore.subscribe((state, previous) => {
  for (const item of Object.values(
    useAssistantProposalStore.getState().items
  )) {
    if (
      state.fileRevisions[item.source.path] !==
        previous.fileRevisions[item.source.path] ||
      state.fileRevisions['pnds.preview.json'] !==
        previous.fileRevisions['pnds.preview.json']
    )
      void useAssistantProposalStore.getState().rebind(item.id)
  }
})

useCreationFilesStore.subscribe(state => {
  if (
    state.pending.refresh ||
    state.pending.restart ||
    useSessionStore.getState().sessionStatus !== 'ready'
  )
    return
  const items = useAssistantProposalStore.getState().items
  const changed = Object.values(items).filter(item => item.pendingRefresh)
  if (!changed.length) return
  const next = { ...items }
  for (const item of changed) {
    const updated = { ...item, pendingRefresh: false }
    next[item.id] = updated
    publishers.get(item.id)?.(snapshot(updated))
  }
  useAssistantProposalStore.setState({ items: next })
})
