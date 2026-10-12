import { create } from 'zustand'
import i18n from '@/i18n/config'
import {
  commands,
  type CreationError,
  type HandoffDocument,
  type HandoffTask,
} from '@/lib/tauri-bindings'
import { isProjectReadme, projectReadmeLocale } from '@/lib/creation-readme'
import type { CreationParticipant } from '@/lib/creation-lifecycle'
import { creationTransportError, useCreationStore } from './creation-store'
import { isDraftDirty, useCreationDraftsStore } from './creation-drafts-store'
import { useCreationChangesStore } from './creation-changes-store'

export const HANDOFF_PATH = 'docs/creator-handoff.md'
interface PendingTask {
  task: HandoffTask
  readme: boolean
}
interface HandoffState {
  pending: PendingTask[]
  activeId: string | null
  document: HandoffDocument | null
  busy: boolean
  conflict: boolean
  error: CreationError | null
  recorded: boolean
  offerReadmeSync: (path: string, version: string, locale: string) => void
  open: (id?: string) => Promise<void>
  edit: (update: Partial<HandoffTask>) => void
  cancel: () => void
  record: () => Promise<void>
  clear: () => void
}
let epoch = 0
const owns = (identity: string, captured: number) =>
  captured === epoch &&
  useCreationStore.getState().workspace?.project.identity === identity
const emptyTask = (): HandoffTask => ({
  id: crypto.randomUUID(),
  intent: '',
  files: [],
  acceptance: '',
  status: 'pending',
})
const hasWork = ({ task }: PendingTask) =>
  !!(task.intent || task.files.length || task.acceptance)

export const useCreationHandoffStore = create<HandoffState>((set, get) => ({
  pending: [],
  activeId: null,
  document: null,
  busy: false,
  conflict: false,
  error: null,
  recorded: false,
  offerReadmeSync: (path, version, locale) => {
    if (!isProjectReadme(path)) return
    const paths =
      useCreationStore.getState().workspace?.files.map(file => file.path) ?? []
    const source = projectReadmeLocale(path) ?? locale
    const target =
      source === 'zh-CN'
        ? paths.includes('README.en.md')
          ? 'README.en.md'
          : path !== 'README.md' && paths.includes('README.md')
            ? 'README.md'
            : 'README.en.md'
        : 'README.zh-CN.md'
    const task = {
      ...emptyTask(),
      intent: i18n.t('creation.handoff.syncIntent', { source: path, target }),
      files: [path, target],
      acceptance: i18n.t('creation.handoff.syncAcceptance', {
        source: path,
        target,
        version,
      }),
    }
    set(state => ({
      pending: [...state.pending, { task, readme: true }],
      recorded: false,
    }))
  },
  open: async id => {
    if (get().busy) return
    const identity = useCreationStore.getState().workspace?.project.identity
    if (!identity) return
    const task = id
      ? get().pending.find(item => item.task.id === id)
      : get().pending.find(item => !item.readme)
    const next = task ?? { task: emptyTask(), readme: false }
    const captured = ++epoch
    set(state => ({
      activeId: next.task.id,
      pending: task ? state.pending : [...state.pending, next],
      document: null,
      busy: true,
      conflict: false,
      error: null,
    }))
    try {
      const result = await commands.readCreationHandoff(identity)
      if (!owns(identity, captured)) return
      set(
        result.status === 'ok'
          ? { document: result.data, busy: false }
          : { error: result.error, busy: false }
      )
    } catch (error) {
      if (owns(identity, captured))
        set({ error: creationTransportError(error), busy: false })
    }
  },
  edit: update => {
    if (get().busy) return
    set(state => ({
      pending: state.pending.map(item =>
        item.task.id === state.activeId
          ? { ...item, task: { ...item.task, ...update, id: item.task.id } }
          : item
      ),
    }))
  },
  cancel: () => {
    if (!get().busy) {
      epoch++
      set({ activeId: null, document: null, conflict: false, error: null })
    }
  },
  record: async () => {
    const state = get()
    const workspace = useCreationStore.getState().workspace
    const item = state.pending.find(item => item.task.id === state.activeId)
    if (!workspace || !item || state.busy || !state.document) return
    const draft = useCreationDraftsStore.getState().drafts[HANDOFF_PATH]
    if (draft && (isDraftDirty(draft) || draft.saving || draft.renaming)) {
      set({
        error: {
          code: 'versionConflict',
          detail: i18n.t('creation.handoff.saveDraftFirst'),
        },
      })
      return
    }
    const identity = workspace.project.identity
    const captured = ++epoch
    set({ busy: true, error: null })
    try {
      const result = await commands.appendCreationHandoff(
        identity,
        item.task,
        state.document.version
      )
      if (!owns(identity, captured)) return
      if (result.status === 'error') {
        if (result.error.code === 'versionConflict') {
          const fresh = await commands.readCreationHandoff(identity)
          if (!owns(identity, captured)) return
          set(
            fresh.status === 'ok'
              ? { document: fresh.data, conflict: true, busy: false }
              : { document: null, error: fresh.error, busy: false }
          )
        } else set({ error: result.error, busy: false })
        return
      }
      set(current => ({
        pending: current.pending.filter(
          other => other.task.id !== item.task.id
        ),
        activeId: null,
        busy: false,
        document: null,
        conflict: false,
        recorded: true,
      }))
      // Poll through the existing public workflow so tree and clean open drafts adopt the saved document.
      await useCreationChangesStore.getState().poll()
    } catch (error) {
      if (owns(identity, captured))
        set({ error: creationTransportError(error), busy: false })
    }
  },
  clear: () => {
    epoch++
    set({
      pending: [],
      activeId: null,
      document: null,
      busy: false,
      conflict: false,
      error: null,
      recorded: false,
    })
  },
}))

export const creationHandoffParticipant: CreationParticipant = {
  hasUnsavedChanges: () =>
    useCreationHandoffStore.getState().pending.some(hasWork),
  unsavedCount: () =>
    useCreationHandoffStore.getState().pending.filter(hasWork).length,
  confirmDiscard: async () => true,
}
let identity: string | null = null
useCreationStore.subscribe(state => {
  const next = state.workspace?.project.identity ?? null
  if (next !== identity) {
    identity = next
    useCreationHandoffStore.getState().clear()
  }
})
