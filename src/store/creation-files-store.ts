import { create } from 'zustand'
import type { TextBuffer } from '@/lib/text-buffer'
import i18n from '@/i18n/config'
import {
  commands,
  type CreationContent,
  type CreationError,
  type CreationFile,
  type CreationFileChange,
  type Result,
} from '@/lib/tauri-bindings'
import type { CreationParticipant } from '@/lib/creation-lifecycle'
import { creationTransportError, useCreationStore } from './creation-store'
import { useSessionStore } from './session-store'
import { useCreationHandoffStore } from './creation-handoff-store'
import {
  editReadmeCover,
  inspectEditableReadme,
  isProjectReadme,
  type CoverField,
  type EditableReadme,
} from '@/lib/creation-readme'

/**
 * Project files own reads, drafts, watcher acknowledgements and directory
 * commits together. The editor never manages operation generations or seeds
 * drafts itself. Runtime prompts still describe saved disk facts only.
 */
export interface CreationDraft {
  text: string
  /** Session-only editing state, shared across file/layout remounts. */
  editor?: TextBuffer
  editorRevision?: number
  /** Source spans belong to this same draft, retaining safe editing boundaries during incomplete keystrokes. */
  readme?: EditableReadme
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

type UpdateKind = 'refresh' | 'restart' | 'compile'
export interface CreationUpdateToken {
  identity: string
  revision: number
}
interface CreationFilesState {
  lastChange: CreationFileChange | null
  changeError: CreationError | null
  changeBusy: boolean
  saveReviewed: (
    path: string,
    before: string,
    after: string,
    version: string,
    identity: string
  ) => Promise<boolean>
  undoChange: (identity: string, changeId: string) => Promise<void>
  revision: number
  diskRevision: number
  fileRevisions: Record<string, number>
  pending: Record<UpdateKind, number>
  error: CreationError | null
  poll: () => Promise<boolean>
  changed: (paths: string[]) => void
  capture: (root: string) => Promise<CreationUpdateToken | null>
  complete: (token: CreationUpdateToken | null, kind: UpdateKind) => void
  drafts: Record<string, CreationDraft>
  activePath: string | null
  location: { identity: string; path: string; line: number } | null
  attachEditor: (path: string, editor: TextBuffer) => void
  locate: (identity: string, path: string, line: number) => boolean
  readmeLocale: string | null
  /** Canonical path of the last rename, so the editor can show the
   * external-agent reference hint until that file is edited or saved. */
  renameNote: string | null
  /** The conflict the user explicitly dismissed; the choice dialog is
   * derived open for any other or newer conflict. */
  dismissedConflict: { path: string; version: string } | null
  setActivePath: (path: string | null) => void
  setReadmeLocale: (locale: string) => void
  /** Opens a current draft or saved preview. Text versions are the disk baseline; stale reads return null. */
  read: (
    identity: string,
    path: string
  ) => Promise<Result<CreationContent, CreationError> | null>
  edit: (path: string, text: string) => void
  editReadme: (path: string, field: CoverField, value: string) => void
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
  return (
    draft.diskChanged ||
    draft.conflict !== null ||
    draft.text !== draft.diskText
  )
}

function patch(
  state: CreationFilesState,
  path: string,
  update: Partial<CreationDraft>
): Partial<CreationFilesState> {
  const draft = state.drafts[path]
  if (!draft) return {}
  const reset =
    update.text !== undefined &&
    update.diskVersion !== undefined &&
    update.diskVersion !== draft.diskVersion
  return {
    drafts: {
      ...state.drafts,
      [path]: {
        ...draft,
        ...update,
        ...(reset ? { editorRevision: (draft.editorRevision ?? 0) + 1 } : {}),
      },
    },
  }
}

/** Late async results may only touch drafts of the workspace still shown. */
function ownsWorkspace(identity: string): boolean {
  return useCreationStore.getState().workspace?.project.identity === identity
}

const initialChanges = () => ({
  revision: 0,
  diskRevision: 0,
  fileRevisions: {},
  pending: { refresh: 0, restart: 0, compile: 0 },
  error: null,
})
let polling: {
  identity: string
  epoch: number
  promise: Promise<boolean>
} | null = null

export function isCreationWorkspacePath(path: string | null): boolean {
  const { workspace, runtimeProject } = useCreationStore.getState()
  return (
    !!workspace &&
    !!path &&
    (path === workspace.project.root ||
      (runtimeProject?.root === workspace.project.root &&
        runtimeProject.path === path))
  )
}

let operationEpoch = 0
const operations = new Map<string, number>()
/** Read/write ownership within the same workspace; editing stays independent. */
function beginCreationFileOperation(path: string): () => boolean {
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

/** All file actions share workspace ownership and commit the directory through this seam. */
function commitFileList(
  files: CreationFile[],
  owns: () => boolean,
  revision: number
): boolean {
  const workspace = useCreationStore.getState().workspace
  if (
    !owns() ||
    !workspace ||
    useCreationFilesStore.getState().revision !== revision
  )
    return false
  useCreationStore.setState({
    workspace: { project: workspace.project, files },
  })
  return true
}

export const useCreationFilesStore = create<CreationFilesState>((set, get) => {
  const observeDisk = async (path: string): Promise<boolean> => {
    const identity = useCreationStore.getState().workspace?.project.identity
    if (!identity) return false
    if (!get().drafts[path]) return true
    if (get().drafts[path]?.saving || get().drafts[path]?.renaming) return false
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
                  readme: isProjectReadme(path)
                    ? inspectEditableReadme(disk.text)
                    : undefined,
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
  }
  return {
    ...initialChanges(),
    lastChange: null,
    changeError: null,
    changeBusy: false,
    saveReviewed: async (path, before, after, version, expectedIdentity) => {
      const workspace = useCreationStore.getState().workspace
      const draft = get().drafts[path]
      if (
        !workspace ||
        workspace.project.identity !== expectedIdentity ||
        workspace.project.source !== 'folder' ||
        !draft ||
        get().changeBusy ||
        draft.saving ||
        draft.renaming ||
        draft.conflict ||
        draft.diskChanged ||
        draft.text !== after ||
        draft.diskText !== before ||
        draft.diskVersion !== version ||
        before === after
      )
        return false
      const identity = workspace.project.identity
      const owns = beginCreationFileOperation(path)
      set(state => ({
        ...patch(state, path, { saving: true }),
        changeBusy: true,
        changeError: null,
      }))
      try {
        const result = await commands.saveCreationFileChange(
          identity,
          path,
          after,
          version
        )
        if (!owns()) return false
        if (result.status === 'error') {
          set({ changeError: result.error })
          return false
        }
        const change = result.data
        set(state => ({
          ...patch(state, path, {
            diskText: change.afterText,
            diskVersion: change.afterVersion,
            conflict: null,
            diskChanged: false,
            error: null,
          }),
          lastChange: change,
        }))
        get().changed([path])
        useCreationHandoffStore
          .getState()
          .offerReadmeSync(
            path,
            change.afterVersion,
            get().readmeLocale ?? i18n.resolvedLanguage ?? 'en'
          )
        return true
      } catch (error) {
        if (owns()) set({ changeError: creationTransportError(error) })
        return false
      } finally {
        if (owns())
          set(state => ({
            ...patch(state, path, { saving: false }),
            changeBusy: false,
          }))
      }
    },
    undoChange: async (identity, changeId) => {
      const workspace = useCreationStore.getState().workspace
      const change = get().lastChange
      if (
        !workspace ||
        workspace.project.identity !== identity ||
        workspace.project.source !== 'folder' ||
        !change ||
        change.id !== changeId ||
        get().changeBusy
      )
        return
      const draft = get().drafts[change.path]
      if (
        !draft ||
        isDraftDirty(draft) ||
        draft.saving ||
        draft.renaming ||
        draft.diskVersion !== change.afterVersion
      ) {
        set({
          changeError: {
            code: 'versionConflict',
            detail: i18n.t('creation.change.draftConflict'),
          },
        })
        return
      }
      const owns = beginCreationFileOperation(change.path)
      set(state => ({
        ...patch(state, change.path, { saving: true }),
        changeBusy: true,
        changeError: null,
      }))
      try {
        const result = await commands.undoCreationFileChange(
          workspace.project.identity,
          change.id
        )
        if (!owns()) return
        if (result.status === 'error') {
          set({ changeError: result.error })
          return
        }
        if (result.data.kind !== 'text') return
        const disk = result.data
        set(state => ({
          ...patch(state, change.path, {
            ...(state.drafts[change.path]?.text === draft.text
              ? {
                  text: disk.text,
                  readme: isProjectReadme(change.path)
                    ? inspectEditableReadme(disk.text)
                    : undefined,
                }
              : {}),
            diskText: disk.text,
            diskVersion: disk.version,
            conflict: null,
            diskChanged: false,
            error: null,
          }),
          lastChange: null,
        }))
        get().changed([change.path])
      } catch (error) {
        if (owns()) set({ changeError: creationTransportError(error) })
      } finally {
        if (owns())
          set(state => ({
            ...patch(state, change.path, { saving: false }),
            changeBusy: false,
          }))
      }
    },
    changed: paths => {
      if (!paths.length) return
      const workspace = useCreationStore.getState().workspace
      if (!workspace) return
      const session = useSessionStore.getState()
      const running =
        ['starting', 'ready'].includes(session.sessionStatus) &&
        isCreationWorkspacePath(session.sessionProjectPath)
      set(state => {
        const revision = state.revision + 1
        const fileRevisions = { ...state.fileRevisions }
        const pending = { ...state.pending }
        for (const path of paths) {
          fileRevisions[path] = revision
          if (path.endsWith('.scd')) pending.compile = revision
          if (
            !running ||
            /^(README(?:\.(?:en|zh-CN))?\.md|AGENTS\.md|docs\/)/i.test(path)
          )
            continue
          const audio =
            /^(audio|supercollider)\//.test(path) ||
            /\.(scd|scsyndef)$/.test(path)
          const page =
            !audio &&
            (/^(public|performer|monitor)\//.test(path) ||
              /\.(html|css)$/.test(path))
          pending[page ? 'refresh' : 'restart'] = revision
        }
        return { revision, fileRevisions, pending }
      })
    },
    poll: () => {
      const workspace = useCreationStore.getState().workspace
      if (!workspace) return Promise.resolve(false)
      const identity = workspace.project.identity
      if (polling?.identity === identity) return polling.promise
      const epoch = operationEpoch
      const owns = () => epoch === operationEpoch && ownsWorkspace(identity)
      const promise = (async () => {
        try {
          const revision = get().revision
          const result = await commands.pollCreationChanges(
            identity,
            get().diskRevision
          )
          if (!owns()) return false
          if (result.status === 'error') {
            set({ error: result.error })
            return false
          }
          const change = result.data
          const listed =
            get().revision === revision &&
            (!change.changed.length ||
              commitFileList(change.files, owns, revision))
          get().changed(change.changed)
          set({ error: null })
          const synchronized = await Promise.all(
            change.changed.map(path => observeDisk(path))
          )
          if (!owns()) return false
          // Retry the batch after an in-flight save settles; otherwise an
          // external write racing that save could disappear from the watcher.
          const complete = listed && synchronized.every(Boolean)
          if (complete) set({ diskRevision: change.revision })
          return complete
        } catch (error) {
          if (owns()) set({ error: creationTransportError(error) })
          return false
        } finally {
          if (polling?.identity === identity && polling.epoch === epoch)
            polling = null
        }
      })()
      polling = { identity, epoch, promise }
      return promise
    },
    capture: async root => {
      const workspace = useCreationStore.getState().workspace
      if (!workspace || !isCreationWorkspacePath(root)) return null
      const identity = workspace.project.identity
      if (
        !(await get().poll()) ||
        useCreationStore.getState().workspace?.project.identity !== identity
      )
        return null
      return { identity, revision: get().revision }
    },
    complete: (token, kind) => {
      if (
        !token ||
        useCreationStore.getState().workspace?.project.identity !==
          token.identity
      )
        return
      set(state => {
        const pending = { ...state.pending }
        for (const update of kind === 'restart'
          ? (['restart', 'refresh'] as const)
          : [kind]) {
          if (pending[update] <= token.revision) pending[update] = 0
        }
        // Compilation changes disk artifacts; the running synths still need
        // an explicit restart. Source edits during compilation remain pending.
        const session = useSessionStore.getState()
        if (
          kind === 'compile' &&
          ['starting', 'ready'].includes(session.sessionStatus) &&
          isCreationWorkspacePath(session.sessionProjectPath)
        )
          pending.restart = state.revision + 1
        return {
          pending,
          revision: kind === 'compile' ? state.revision + 1 : state.revision,
        }
      })
    },
    drafts: {},
    activePath: null,
    location: null,
    attachEditor: (path, editor) =>
      set(state => patch(state, path, { editor })),
    locate: (identity, path, line) => {
      const workspace = useCreationStore.getState().workspace
      if (
        workspace?.project.identity !== identity ||
        !Number.isInteger(line) ||
        line < 1 ||
        !workspace.files.some(
          file => file.path === path && file.kind === 'text'
        )
      )
        return false
      set({
        activePath: path,
        location: { identity, path, line },
        renameNote: null,
      })
      return true
    },
    readmeLocale: null,
    renameNote: null,
    dismissedConflict: null,
    setActivePath: path =>
      set({ activePath: path, location: null, renameNote: null }),
    setReadmeLocale: readmeLocale => set({ readmeLocale }),
    read: async (identity, path) => {
      const workspace = useCreationStore.getState().workspace
      if (workspace?.project.identity !== identity) return null
      const editable = workspace.project.source === 'folder'
      const draft = get().drafts[path]
      if (editable && draft)
        return {
          status: 'ok',
          data: { kind: 'text', text: draft.text, version: draft.diskVersion },
        }
      const ownsOperation = beginCreationFileOperation(path)
      try {
        // A watcher change while the reply is in flight requires a fresh read,
        // even when there was no draft for the watcher to synchronize yet.
        while (ownsOperation()) {
          const revision = get().fileRevisions[path] ?? 0
          const result = await commands.readCreationFile(identity, path)
          if (!ownsOperation()) return null
          if ((get().fileRevisions[path] ?? 0) !== revision) continue
          if (
            editable &&
            result.status === 'ok' &&
            result.data.kind === 'text'
          ) {
            const { text, version } = result.data
            set(state => ({
              drafts: {
                ...state.drafts,
                [path]: {
                  text,
                  readme: isProjectReadme(path)
                    ? inspectEditableReadme(text)
                    : undefined,
                  diskText: text,
                  diskVersion: version,
                  conflict: null,
                  saving: false,
                  renaming: false,
                  diskChanged: false,
                  error: null,
                },
              },
            }))
          }
          return result
        }
      } catch (error) {
        if (ownsOperation())
          return { status: 'error', error: creationTransportError(error) }
      }
      return null
    },
    edit: (path, text) =>
      set(state => ({
        ...patch(state, path, {
          text,
          error: null,
          readme:
            state.drafts[path]?.readme?.kind === 'document'
              ? state.drafts[path]?.readme
              : isProjectReadme(path)
                ? inspectEditableReadme(text)
                : undefined,
        }),
        renameNote: state.renameNote === path ? null : state.renameNote,
      })),
    editReadme: (path, field, value) =>
      set(state => {
        const draft = state.drafts[path]
        if (!draft) return {}
        const document = draft.readme ?? inspectEditableReadme(draft.text)
        if (document.kind !== 'cover') return {}
        const edited = editReadmeCover(draft.text, document, field, value)
        return patch(state, path, {
          text: edited.text,
          readme: edited.document,
          error: null,
        })
      }),
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
      const locale = get().readmeLocale ?? i18n.resolvedLanguage ?? 'en'
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
          lastChange: null,
        }))
        get().changed([path])
        useCreationHandoffStore
          .getState()
          .offerReadmeSync(path, result.data, locale)
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
      const draft = get().drafts[path]
      if (!draft || isDraftDirty(draft) || draft.saving) return
      await observeDisk(path)
    },
    revert: path =>
      set(state => {
        const draft = state.drafts[path]
        if (!draft || !draft.conflict || draft.saving) return {}
        beginCreationFileOperation(path)
        const { text, version } = draft.conflict
        return patch(state, path, {
          text,
          readme: isProjectReadme(path)
            ? inspectEditableReadme(text)
            : undefined,
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
              lastChange: null,
            }
          const drafts = moved
            ? { ...remaining, [canonical]: { ...moved, renaming: false } }
            : state.drafts
          return {
            drafts,
            activePath: canonical,
            renameNote: canonical,
            lastChange: null,
          }
        })
        get().changed([path, canonical])
        const revision = get().revision
        const listed = await commands.listCreationFiles(identity)
        if (!ownsOperation()) return null
        if (listed.status === 'ok')
          commitFileList(listed.data, ownsOperation, revision)
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
      polling = null
      set({
        ...initialChanges(),
        lastChange: null,
        changeError: null,
        changeBusy: false,
        drafts: {},
        activePath: null,
        location: null,
        readmeLocale: null,
        renameNote: null,
        dismissedConflict: null,
      })
    },
  }
})

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
    selectUnsavedCount(useCreationFilesStore.getState()) > 0,
  unsavedCount: () => selectUnsavedCount(useCreationFilesStore.getState()),
  // The mode button's own two-click confirm is the whole approval there;
  // switching projects asks explicitly via confirmDiscardCreationDrafts.
  confirmDiscard: async () => true,
}

let fileWorkspaceIdentity: string | null = null
useCreationStore.subscribe(state => {
  const identity = state.workspace?.project.identity ?? null
  if (identity !== fileWorkspaceIdentity) {
    fileWorkspaceIdentity = identity
    useCreationFilesStore.getState().clear()
  }
})
