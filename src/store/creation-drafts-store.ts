import { create } from 'zustand'
import i18n from '@/i18n/config'
import { commands, type CreationError } from '@/lib/tauri-bindings'
import type { CreationParticipant } from '@/lib/creation-lifecycle'
import { creationTransportError, useCreationStore } from './creation-store'

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
  revert: (path: string) => void
  dismissConflict: (path: string) => void
  rename: (path: string, nextPath: string) => Promise<CreationError | null>
  dismissError: (path: string) => void
  clear: () => void
}

export function isDraftDirty(draft: CreationDraft): boolean {
  return draft.conflict !== null || draft.text !== draft.diskText
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
      if (!identity || !draft || draft.saving) return
      // A conflicted save without an explicit overwrite never writes: it
      // (re)opens the reload-or-overwrite choice instead — ⌘S included.
      if (draft.conflict && !overwriteVersion) {
        set({ dismissedConflict: null })
        return
      }
      const expected = overwriteVersion ?? draft.diskVersion
      set(state => patch(state, path, { saving: true, error: null }))
      const stillRelevant = () =>
        ownsWorkspace(identity) && path in get().drafts
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
            error: null,
          }),
          renameNote: state.renameNote === path ? null : state.renameNote,
        }))
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
    reload: async path => {
      const identity = useCreationStore.getState().workspace?.project.identity
      const draft = get().drafts[path]
      if (!identity || !draft || isDraftDirty(draft) || draft.saving) return
      try {
        const fresh = await commands.readCreationFile(identity, path)
        const stillRelevant = () =>
          ownsWorkspace(identity) && path in get().drafts
        if (!stillRelevant()) return
        if (fresh.status === 'error') {
          set(state => patch(state, path, { error: fresh.error }))
          return
        }
        const disk = fresh.data
        if (disk.kind !== 'text') {
          set(state =>
            patch(state, path, {
              error: creationTransportError(i18n.t('creation.noLongerText')),
            })
          )
          return
        }
        set(state =>
          patch(state, path, {
            text: disk.text,
            diskText: disk.text,
            diskVersion: disk.version,
            error: null,
          })
        )
      } catch (error) {
        if (ownsWorkspace(identity) && path in get().drafts)
          set(state =>
            patch(state, path, { error: creationTransportError(error) })
          )
      }
    },
    revert: path =>
      set(state => {
        const draft = state.drafts[path]
        if (!draft || !draft.conflict) return {}
        const { text, version } = draft.conflict
        return patch(state, path, {
          text,
          diskText: text,
          diskVersion: version,
          conflict: null,
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
      if (!identity) return null
      try {
        const result = await commands.renameCreationFile(
          identity,
          path,
          nextPath
        )
        if (!ownsWorkspace(identity)) return null
        if (result.status === 'error') return result.error
        const canonical = result.data
        set(state => {
          const { [path]: moved, ...remaining } = state.drafts
          const drafts = moved
            ? { ...remaining, [canonical]: moved }
            : state.drafts
          return { drafts, activePath: canonical, renameNote: canonical }
        })
        const listed = await commands.listCreationFiles(identity)
        if (!ownsWorkspace(identity)) return null
        if (listed.status === 'ok') {
          const current = useCreationStore.getState().workspace
          if (current?.project.identity === identity)
            useCreationStore.setState({
              workspace: { project: current.project, files: listed.data },
            })
        }
        return null
      } catch (error) {
        if (ownsWorkspace(identity)) return creationTransportError(error)
        return null
      }
    },
    dismissError: path => set(state => patch(state, path, { error: null })),
    clear: () =>
      set({
        drafts: {},
        activePath: null,
        renameNote: null,
        dismissedConflict: null,
      }),
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
