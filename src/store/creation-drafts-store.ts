import { create } from 'zustand'
import i18n from '@/i18n/config'
import { commands, type CreationError } from '@/lib/tauri-bindings'
import type { CreationParticipant } from '@/lib/creation-lifecycle'
import { creationTransportError, useCreationStore } from './creation-store'
import { useCreationChangesStore } from './creation-changes-store'

/**
 * #154: per-file editing drafts for the creation workspace. Drafts live at
 * the store level so switching files (and later the console tab) never
 * drops them; each record remembers the exact disk version it was read
 * from so saves can detect external modification at write time.
 */
export interface CreationDraft {
  text: string
  /** Disk content of `diskVersion` — the base the draft diverges from. */
  diskText: string
  diskVersion: string
  /** Newest disk content fetched after a refused save; binding an explicit
   * overwrite to this version makes a further disk change re-confirm. */
  conflict: { text: string; version: string } | null
  saving: boolean
  renaming: boolean
  diskChanged: boolean
  error: CreationError | null
}

interface CreationDraftsState {
  drafts: Record<string, CreationDraft>
  activePath: string | null
  /** Canonical path of the last rename, so the editor can show the
   * external-agent reference hint until that file is edited or saved. */
  renameNote: string | null
  /** The conflict the user explicitly dismissed; the choice dialog is
   * derived open for any other or newer conflict. */
  dismissedConflict: { path: string; version: string } | null
  setActivePath: (path: string | null) => void
  loaded: (path: string, text: string, version: string) => void
  edit: (path: string, text: string) => void
  save: (path: string, overwriteVersion?: string) => Promise<void>
  /** Re-reads a clean draft from disk, adopting external changes that have
   * nothing unsaved to conflict with. */
  reload: (path: string) => Promise<void>
  observeDisk: (path: string) => Promise<boolean>
  revert: (path: string) => void
  dismissConflict: (path: string) => void
  rename: (path: string, nextPath: string) => Promise<CreationError | null>
  dismissError: (path: string) => void
  clear: () => void
}

export function isDraftDirty(draft: CreationDraft): boolean {
  return (
    draft.diskChanged ||
    draft.conflict !== null ||
    draft.text !== draft.diskText
  )
}

function patch(
  state: CreationDraftsState,
  path: string,
  update: Partial<CreationDraft>
): Partial<CreationDraftsState> {
  const draft = state.drafts[path]
  if (!draft) return {}
  return { drafts: { ...state.drafts, [path]: { ...draft, ...update } } }
}

/** Late async results may only touch drafts of the workspace still shown. */
function ownsWorkspace(identity: string): boolean {
  return useCreationStore.getState().workspace?.project.identity === identity
}

let operationEpoch = 0
const operations = new Map<string, number>()
/** Read/write ownership within the same workspace; editing stays independent. */
export function beginCreationFileOperation(path: string): () => boolean {
  const identity = useCreationStore.getState().workspace?.project.identity
  const epoch = operationEpoch
  const generation = (operations.get(path) ?? 0) + 1
  operations.set(path, generation)
  return () =>
    !!identity &&
    ownsWorkspace(identity) &&
    epoch === operationEpoch &&
    operations.get(path) === generation
}

export const useCreationDraftsStore = create<CreationDraftsState>(
  (set, get) => ({
    drafts: {},
    activePath: null,
    renameNote: null,
    dismissedConflict: null,
    setActivePath: path => set({ activePath: path, renameNote: null }),
    loaded: (path, text, version) =>
      set(state =>
        path in state.drafts
          ? {}
          : {
              drafts: {
                ...state.drafts,
                [path]: {
                  text,
                  diskText: text,
                  diskVersion: version,
                  conflict: null,
                  saving: false,
                  renaming: false,
                  diskChanged: false,
                  error: null,
                },
              },
            }
      ),
    edit: (path, text) =>
      set(state => ({
        ...patch(state, path, { text, error: null }),
        renameNote: state.renameNote === path ? null : state.renameNote,
      })),
    save: async (path, overwriteVersion) => {
      const identity = useCreationStore.getState().workspace?.project.identity
      const draft = get().drafts[path]
      if (!identity || !draft || draft.saving || draft.renaming) return
      // A conflicted save without an explicit overwrite never writes: it
      // (re)opens the reload-or-overwrite choice instead — ⌘S included.
      if (draft.conflict && !overwriteVersion) {
        set({ dismissedConflict: null })
        return
      }
      const expected = overwriteVersion ?? draft.diskVersion
      const ownsOperation = beginCreationFileOperation(path)
      set(state => patch(state, path, { saving: true, error: null }))
      const stillRelevant = () => ownsOperation() && path in get().drafts
      try {
        const result = await commands.saveCreationFile(
          identity,
          path,
          draft.text,
          expected
        )
        if (!stillRelevant()) return
        if (result.status === 'error') {
          if (result.error.code === 'versionConflict') {
            // Fetch the newest disk content: the conflict panel displays it
            // and an overwrite confirm binds to exactly this version.
            const fresh = await commands.readCreationFile(identity, path)
            if (!stillRelevant()) return
            const freshText =
              fresh.status === 'ok' && fresh.data.kind === 'text'
                ? fresh.data
                : null
            if (freshText) {
              set(state =>
                patch(state, path, {
                  saving: false,
                  conflict: {
                    text: freshText.text,
                    version: freshText.version,
                  },
                  diskChanged: true,
                })
              )
            } else {
              set(state =>
                patch(state, path, {
                  saving: false,
                  error:
                    fresh.status === 'error'
                      ? fresh.error
                      : creationTransportError(i18n.t('creation.noLongerText')),
                })
              )
            }
          } else {
            set(state =>
              patch(state, path, { saving: false, error: result.error })
            )
          }
          return
        }
        set(state => ({
          ...patch(state, path, {
            saving: false,
            diskText: draft.text,
            diskVersion: result.data,
            conflict: null,
            diskChanged: false,
            error: null,
          }),
          renameNote: state.renameNote === path ? null : state.renameNote,
        }))
        useCreationChangesStore.getState().changed([path])
      } catch (error) {
        if (stillRelevant())
          set(state =>
            patch(state, path, {
              saving: false,
              error: creationTransportError(error),
            })
          )
      }
    },
    observeDisk: async path => {
      const identity = useCreationStore.getState().workspace?.project.identity
      if (!identity) return false
      if (!get().drafts[path]) return true
      if (get().drafts[path]?.saving || get().drafts[path]?.renaming)
        return false
      const ownsOperation = beginCreationFileOperation(path)
      try {
        const result = await commands.readCreationFile(identity, path)
        if (!ownsOperation()) return false
        const draft = get().drafts[path]
        if (!draft) return true
        if (draft.saving || draft.renaming) return false
        if (result.status === 'error') {
          set(state =>
            patch(state, path, { error: result.error, diskChanged: true })
          )
        } else if (result.data.kind === 'text') {
          const disk = result.data
          set(state =>
            patch(
              state,
              path,
              isDraftDirty(draft)
                ? {
                    conflict:
                      disk.version === draft.diskVersion
                        ? null
                        : { text: disk.text, version: disk.version },
                    diskChanged: disk.version !== draft.diskVersion,
                    error: null,
                  }
                : {
                    text: disk.text,
                    diskText: disk.text,
                    diskVersion: disk.version,
                    diskChanged: false,
                    error: null,
                  }
            )
          )
        } else {
          set(state =>
            patch(state, path, {
              error: creationTransportError(i18n.t('creation.noLongerText')),
              diskChanged: true,
            })
          )
        }
        return true
      } catch (error) {
        if (ownsOperation())
          set(state =>
            patch(state, path, { error: creationTransportError(error) })
          )
        return ownsOperation()
      }
    },
    reload: async path => {
      const draft = get().drafts[path]
      if (!draft || isDraftDirty(draft) || draft.saving) return
      await get().observeDisk(path)
    },
    revert: path =>
      set(state => {
        const draft = state.drafts[path]
        if (!draft || !draft.conflict || draft.saving) return {}
        beginCreationFileOperation(path)
        const { text, version } = draft.conflict
        return patch(state, path, {
          text,
          diskText: text,
          diskVersion: version,
          conflict: null,
          diskChanged: false,
          error: null,
        })
      }),
    dismissConflict: path =>
      set(state => {
        const conflict = state.drafts[path]?.conflict
        return {
          dismissedConflict: conflict
            ? { path, version: conflict.version }
            : state.dismissedConflict,
        }
      }),
    rename: async (path, nextPath) => {
      const workspace = useCreationStore.getState().workspace
      const identity = workspace?.project.identity
      if (
        !identity ||
        get().drafts[path]?.saving ||
        get().drafts[path]?.renaming
      )
        return null
      if (nextPath !== path && get().drafts[nextPath])
        return { code: 'targetExists', detail: nextPath }
      const ownsOperation = beginCreationFileOperation(path)
      set(state => patch(state, path, { renaming: true }))
      try {
        const result = await commands.renameCreationFile(
          identity,
          path,
          nextPath,
          Object.keys(get().drafts).filter(other => other !== path)
        )
        if (!ownsOperation()) return null
        if (result.status === 'error') {
          set(state => patch(state, path, { renaming: false }))
          return result.error
        }
        const canonical = result.data
        const destinationDraft = canonical !== path && get().drafts[canonical]
        if (!destinationDraft) beginCreationFileOperation(canonical)
        set(state => {
          const { [path]: moved, ...remaining } = state.drafts
          // The backend guards drafts known at dispatch. A newly opened
          // destination can still arrive while the command is returning:
          // retain both texts, with the moved source recoverable at its old
          // (now missing) path, rather than overwrite the destination draft.
          if (destinationDraft && moved)
            return {
              drafts: {
                ...state.drafts,
                [path]: {
                  ...moved,
                  renaming: false,
                  diskChanged: true,
                  error: { code: 'missing', detail: path },
                },
              },
              activePath: canonical,
              renameNote: canonical,
            }
          const drafts = moved
            ? { ...remaining, [canonical]: { ...moved, renaming: false } }
            : state.drafts
          return { drafts, activePath: canonical, renameNote: canonical }
        })
        useCreationChangesStore.getState().changed([path, canonical])
        const revision = useCreationChangesStore.getState().revision
        const listed = await commands.listCreationFiles(identity)
        if (!ownsOperation()) return null
        if (
          listed.status === 'ok' &&
          useCreationChangesStore.getState().revision === revision
        ) {
          const current = useCreationStore.getState().workspace
          if (current?.project.identity === identity)
            useCreationStore.setState({
              workspace: { project: current.project, files: listed.data },
            })
        }
        return null
      } catch (error) {
        if (ownsOperation()) {
          set(state => patch(state, path, { renaming: false }))
          return creationTransportError(error)
        }
        return null
      }
    },
    dismissError: path => set(state => patch(state, path, { error: null })),
    clear: () => {
      operationEpoch += 1
      operations.clear()
      set({
        drafts: {},
        activePath: null,
        renameNote: null,
        dismissedConflict: null,
      })
    },
  })
)

export function selectUnsavedCount(state: {
  drafts: Record<string, CreationDraft>
}): number {
  return Object.values(state.drafts).filter(isDraftDirty).length
}

/** Stable string key of the dirty-path set, so the file tree only
 * re-renders when dirty membership changes — not on every keystroke. */
export function selectDirtyPathKey(state: {
  drafts: Record<string, CreationDraft>
}): string {
  return Object.entries(state.drafts)
    .filter(([, draft]) => isDraftDirty(draft))
    .map(([path]) => path)
    .sort()
    .join('\n')
}

export function selectDiskConflictPathKey(state: {
  drafts: Record<string, CreationDraft>
}): string {
  return Object.entries(state.drafts)
    .filter(([, draft]) => draft.diskChanged || draft.conflict)
    .map(([path]) => path)
    .sort()
    .join('\n')
}

/**
 * The lifecycle participant feeds the mode button's discard consequence and
 * the switch gate. Drafts clear through the workspace identity subscription
 * below — a switch that fails midway keeps them; only a successful switch
 * wipes old drafts.
 */
export const creationDraftsParticipant: CreationParticipant = {
  hasUnsavedChanges: () =>
    selectUnsavedCount(useCreationDraftsStore.getState()) > 0,
  unsavedCount: () => selectUnsavedCount(useCreationDraftsStore.getState()),
  // The mode button's own two-click confirm is the whole approval there;
  // switching projects asks explicitly via confirmDiscardCreationDrafts.
  confirmDiscard: async () => true,
}

let draftWorkspaceIdentity: string | null = null
useCreationStore.subscribe(state => {
  const identity = state.workspace?.project.identity ?? null
  if (identity !== draftWorkspaceIdentity) {
    draftWorkspaceIdentity = identity
    useCreationDraftsStore.getState().clear()
  }
})
