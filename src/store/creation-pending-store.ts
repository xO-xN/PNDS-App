import { create } from 'zustand'
import { message } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import {
  commands,
  type CreationMaterial,
  type MaterialError,
} from '@/lib/tauri-bindings'
import type { TextBuffer } from '@/lib/text-buffer'
import type { CreationParticipant } from '@/lib/creation-lifecycle'
import {
  captureCreationDrafts,
  saveCreationDrafts,
} from '@/lib/creation-lifecycle'
import { useCreationStore } from './creation-store'
import { useCreationReadingStore } from './creation-reading-store'

export interface PendingDraft {
  id: string
  name: string
  text: string
  saved: CreationMaterial | null
  savedText: string
  editor?: TextBuffer
  editorRevision: number
  saving: boolean
  error: MaterialError | null
  conflict: { document: CreationMaterial; text: string } | null
}

export function pendingDraftDirty(draft: PendingDraft | undefined) {
  if (!draft) return false
  return draft.saved
    ? draft.text !== draft.savedText ||
        draft.name !== draft.saved.name ||
        !!draft.conflict
    : !!(draft.name || draft.text)
}

interface PendingState {
  identity: string | null
  documents: CreationMaterial[]
  drafts: Record<string, PendingDraft>
  activeId: string | null
  loading: boolean
  error: MaterialError | null
  reset: (identity: string | null) => void
  refresh: () => Promise<boolean>
  create: () => string | null
  open: (id: string, version?: string) => Promise<boolean>
  edit: (id: string, text: string) => void
  attachEditor: (id: string, editor: TextBuffer) => void
  rename: (id: string, name: string) => Promise<boolean>
  save: (id: string, overwriteVersion?: string) => Promise<boolean>
  adoptExternal: (id: string) => void
  remove: (id: string) => Promise<boolean>
  reveal: (id: string) => Promise<boolean>
  close: () => void
  saveAll: () => Promise<boolean>
}

let epoch = 0
let listing: Promise<boolean> | null = null
let listingOwner: object | null = null
let mutationRevision = 0
const operations = new Map<string, number>()
function owner(identity: string | null, captured = epoch): identity is string {
  return (
    !!identity &&
    captured === epoch &&
    useCreationStore.getState().workspace?.project.identity === identity
  )
}
function patch(id: string, update: Partial<PendingDraft>) {
  useCreationPendingStore.setState(state => {
    const draft = state.drafts[id]
    return draft
      ? { drafts: { ...state.drafts, [id]: { ...draft, ...update } } }
      : {}
  })
}
function draftFrom(document: CreationMaterial, text: string): PendingDraft {
  return {
    id: document.id,
    name: document.name,
    text,
    saved: document,
    savedText: text,
    editorRevision: 0,
    saving: false,
    error: null,
    conflict: null,
  }
}

export const useCreationPendingStore = create<PendingState>((set, get) => ({
  identity: null,
  documents: [],
  drafts: {},
  activeId: null,
  loading: false,
  error: null,
  reset: identity => {
    epoch++
    operations.clear()
    listing = null
    listingOwner = null
    mutationRevision++
    set({
      identity,
      documents: [],
      drafts: {},
      activeId: null,
      loading: false,
      error: null,
    })
  },
  refresh: () => {
    if (listing) return listing
    const identity = get().identity
    const captured = epoch
    if (!owner(identity, captured)) return Promise.resolve(false)
    const requestOwner = {}
    const revision = mutationRevision
    listingOwner = requestOwner
    const promise = (async () => {
      set({ loading: true })
      try {
        const result = await commands.listCreationMaterials(identity)
        if (!owner(identity, captured) || revision !== mutationRevision)
          return false
        if (result.status === 'error') {
          set({ error: result.error })
          return false
        }
        set({ documents: result.data, error: null })
        for (const [id, draft] of Object.entries(get().drafts)) {
          if (!draft.saved || draft.saving) continue
          const current = result.data.find(document => document.id === id)
          if (!current) {
            if (pendingDraftDirty(draft)) patch(id, { error: 'missing' })
            else
              set(state => ({
                drafts: Object.fromEntries(
                  Object.entries(state.drafts).filter(([key]) => key !== id)
                ),
                activeId: state.activeId === id ? null : state.activeId,
              }))
            continue
          }
          if (
            current.version === draft.saved.version &&
            current.name === draft.saved.name
          )
            continue
          const read = await commands.readCreationPendingDocument(
            identity,
            id,
            current.version
          )
          if (!owner(identity, captured) || revision !== mutationRevision)
            return false
          const latest = get().drafts[id]
          if (!latest || latest.saving) continue
          if (read.status === 'error') {
            patch(id, { error: read.error })
            continue
          }
          if (pendingDraftDirty(latest))
            patch(id, { conflict: read.data, error: 'versionConflict' })
          else
            patch(id, {
              name: read.data.document.name,
              text: read.data.text,
              saved: read.data.document,
              savedText: read.data.text,
              conflict: null,
              error: null,
              editorRevision: latest.editorRevision + 1,
            })
        }
        return true
      } catch {
        if (owner(identity, captured)) set({ error: 'storage' })
        return false
      } finally {
        if (owner(identity, captured)) set({ loading: false })
        if (listingOwner === requestOwner) {
          listing = null
          listingOwner = null
        }
      }
    })()
    listing = promise
    return promise
  },
  create: () => {
    if (!owner(get().identity)) return null
    if (
      get().documents.length +
        Object.values(get().drafts).filter(draft => !draft.saved).length >=
      64
    ) {
      set({ error: 'limitExceeded' })
      return null
    }
    const id = crypto.randomUUID().replaceAll('-', '')
    set(state => ({
      activeId: id,
      drafts: {
        ...state.drafts,
        [id]: {
          id,
          name: '',
          text: '',
          saved: null,
          savedText: '',
          editorRevision: 0,
          saving: false,
          error: null,
          conflict: null,
        },
      },
    }))
    useCreationReadingStore.getState().showPending()
    return id
  },
  open: async (id, version) => {
    const identity = get().identity
    const captured = epoch
    if (!owner(identity, captured)) return false
    set({ activeId: id })
    useCreationReadingStore.getState().showPending()
    const existing = get().drafts[id]
    if (existing) {
      if (version && existing.saved?.version !== version) {
        patch(id, { error: 'versionConflict' })
        return false
      }
      return true
    }
    const document = get().documents.find(item => item.id === id)
    if (!document || (version && document.version !== version)) {
      set({ error: document ? 'versionConflict' : 'missing' })
      return false
    }
    const operation = (operations.get(id) ?? 0) + 1
    operations.set(id, operation)
    try {
      const result = await commands.readCreationPendingDocument(
        identity,
        id,
        document.version
      )
      if (!owner(identity, captured) || operations.get(id) !== operation)
        return false
      if (result.status === 'error') {
        set({ error: result.error })
        return false
      }
      set(state => ({
        drafts: {
          ...state.drafts,
          [id]: draftFrom(result.data.document, result.data.text),
        },
        error: null,
      }))
      return true
    } catch {
      if (owner(identity, captured)) set({ error: 'storage' })
      return false
    }
  },
  edit: (id, text) => patch(id, { text, error: null }),
  attachEditor: (id, editor) => patch(id, { editor }),
  rename: async (id, name) => {
    const draft = get().drafts[id]
    const identity = get().identity
    const captured = epoch
    if (!draft || draft.saving || !owner(identity, captured)) return false
    if (!draft.saved) {
      patch(id, { name, error: null })
      return true
    }
    patch(id, { saving: true, error: null })
    try {
      const result = await commands.renameCreationPendingDocument(
        identity,
        id,
        draft.saved.version,
        name
      )
      if (!owner(identity, captured)) return false
      if (result.status === 'error') {
        patch(id, { error: result.error })
        return false
      }
      mutationRevision++
      patch(id, { name: result.data.name, saved: result.data })
      set(state => ({
        documents: state.documents.map(item =>
          item.id === id ? result.data : item
        ),
      }))
      return true
    } catch {
      if (owner(identity, captured)) patch(id, { error: 'storage' })
      return false
    } finally {
      if (owner(identity, captured)) patch(id, { saving: false })
    }
  },
  save: async (id, overwriteVersion) => {
    const draft = get().drafts[id]
    const identity = get().identity
    const captured = epoch
    if (!draft || draft.saving || !owner(identity, captured)) return false
    if (draft.conflict && !overwriteVersion) return false
    patch(id, { saving: true, error: null })
    try {
      const result = await commands.saveCreationPendingDocument(identity, {
        id,
        name: draft.name,
        text: draft.text,
        version: overwriteVersion ?? draft.saved?.version ?? null,
      })
      if (!owner(identity, captured)) return false
      if (result.status === 'error') {
        patch(id, { saving: false, error: result.error })
        if (result.error === 'versionConflict') await get().refresh()
        return false
      }
      mutationRevision++
      patch(id, {
        saved: result.data,
        savedText: draft.text,
        conflict: null,
        error: null,
      })
      set(state => ({
        documents: [
          ...state.documents.filter(item => item.id !== id),
          result.data,
        ],
      }))
      return true
    } catch {
      if (owner(identity, captured)) patch(id, { error: 'storage' })
      return false
    } finally {
      if (owner(identity, captured)) patch(id, { saving: false })
    }
  },
  adoptExternal: id => {
    const draft = get().drafts[id]
    if (!draft?.conflict || draft.saving) return
    const { document, text } = draft.conflict
    patch(id, {
      name: document.name,
      text,
      saved: document,
      savedText: text,
      conflict: null,
      error: null,
      editorRevision: draft.editorRevision + 1,
    })
  },
  remove: async id => {
    const identity = get().identity
    const captured = epoch
    const draft = get().drafts[id]
    const document =
      draft?.saved ?? get().documents.find(item => item.id === id)
    if (!owner(identity, captured) || draft?.saving) return false
    if (draft) patch(id, { saving: true })
    try {
      if (document) {
        const result = await commands.deleteCreationPendingDocument(
          identity,
          id,
          document.version
        )
        if (!owner(identity, captured)) return false
        if (result.status === 'error') {
          if (draft) patch(id, { error: result.error })
          else set({ error: result.error })
          return false
        }
      }
      mutationRevision++
      operations.set(id, (operations.get(id) ?? 0) + 1)
      const wasActive = get().activeId === id
      set(state => ({
        documents: state.documents.filter(item => item.id !== id),
        drafts: Object.fromEntries(
          Object.entries(state.drafts).filter(([key]) => key !== id)
        ),
        activeId: state.activeId === id ? null : state.activeId,
      }))
      if (wasActive && useCreationReadingStore.getState().view === 'pending')
        useCreationReadingStore.getState().showDiscussion()
      return true
    } catch {
      if (owner(identity, captured)) set({ error: 'storage' })
      return false
    } finally {
      if (owner(identity, captured)) patch(id, { saving: false })
    }
  },
  reveal: async id => {
    const identity = get().identity
    const captured = epoch
    const document =
      get().drafts[id]?.saved ?? get().documents.find(item => item.id === id)
    if (!document || !owner(identity, captured)) return false
    try {
      const result = await commands.revealCreationPendingDocument(
        identity,
        id,
        document.version
      )
      if (!owner(identity, captured)) return false
      if (result.status === 'error') {
        patch(id, { error: result.error })
        return false
      }
      return true
    } catch {
      if (owner(identity, captured)) patch(id, { error: 'storage' })
      return false
    }
  },
  close: () => {
    set({ activeId: null })
    useCreationReadingStore.getState().showDiscussion()
  },
  saveAll: async () => {
    const identity = get().identity
    const captured = epoch
    for (const [id, draft] of Object.entries(get().drafts)) {
      if (!pendingDraftDirty(draft)) continue
      if (!owner(identity, captured) || !(await get().save(id))) return false
    }
    return owner(identity, captured) && selectPendingUnsavedCount(get()) === 0
  },
}))

export function selectPendingUnsavedCount(state: {
  drafts: Record<string, PendingDraft>
}) {
  return Object.values(state.drafts).filter(pendingDraftDirty).length
}

export const pendingDraftsParticipant: CreationParticipant = {
  hasUnsavedChanges: () =>
    selectPendingUnsavedCount(useCreationPendingStore.getState()) > 0,
  unsavedCount: () =>
    selectPendingUnsavedCount(useCreationPendingStore.getState()),
  draftsSnapshot: () => useCreationPendingStore.getState().drafts,
  save: () => useCreationPendingStore.getState().saveAll(),
  confirmDiscard: async () => true,
  confirmDrafts: async count => {
    const identity = useCreationPendingStore.getState().identity
    const unchanged = captureCreationDrafts()
    try {
      const choice = await message(
        i18n.t('creation.pending.leaveMessage', { count }),
        {
          title: i18n.t('creation.pending.leaveTitle'),
          kind: 'warning',
          buttons: {
            yes: i18n.t('creation.pending.saveContinue'),
            no: i18n.t('creation.pending.discard'),
            cancel: i18n.t('close.cancel'),
          },
        }
      )
      if (!owner(identity)) return false
      if (choice === i18n.t('creation.pending.discard')) return unchanged()
      if (choice === i18n.t('creation.pending.saveContinue'))
        return saveCreationDrafts()
      return false
    } catch {
      return false
    }
  },
}

/** A saved read must be repeated after a dirty source is explicitly saved. */
export async function preparePendingIntegration(
  identity: string,
  id: string,
  version: string
) {
  const state = useCreationPendingStore.getState()
  if (state.identity !== identity || !owner(identity)) return false
  const draft = state.drafts[id]
  if (draft && pendingDraftDirty(draft)) {
    const choice = await message(
      i18n.t('creation.pending.saveBeforeIntegration'),
      {
        title: i18n.t('creation.pending.title'),
        kind: 'warning',
        buttons: {
          ok: i18n.t('creation.pending.saveContinue'),
          cancel: i18n.t('close.cancel'),
        },
      }
    )
    if (
      choice !== i18n.t('creation.pending.saveContinue') ||
      !owner(identity) ||
      !(await state.save(id))
    )
      return false
    return (
      useCreationPendingStore.getState().drafts[id]?.saved?.version === version
    )
  }
  return !draft || draft.saved?.version === version
}

useCreationStore.subscribe(state => {
  const identity = state.workspace?.project.identity ?? null
  if (identity !== useCreationPendingStore.getState().identity)
    useCreationPendingStore.getState().reset(identity)
})

useCreationReadingStore.subscribe(state => {
  if (state.view === 'file' || state.view === 'handoff')
    useCreationPendingStore.setState({ activeId: null })
})
