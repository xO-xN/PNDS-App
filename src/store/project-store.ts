import { create } from 'zustand'
import type { Manifest, ProjectFolder } from '@/lib/tauri-bindings'
import { masterWithUngroupedOrder, sameMemberSet } from '@/lib/drag-reorder'
import { upsertDisplayName } from '@/lib/display-names'

export interface CurrentProject {
  path: string
  manifest: Manifest
}

export type PreflightStatus = 'idle' | 'checking' | 'ready' | 'error'

/**
 * v1.1.2 T7 (spec issue #11): reserved id of the default Utilities folder
 * seeded from the bundled example projects. It can be reordered and its
 * membership edited, but never renamed or deleted.
 */
export const UTILITIES_FOLDER_ID = 'utilities'

/** True for folders the sidebar must keep as-is (no rename, no delete). */
export function isProtectedFolder(id: string): boolean {
  return id === UTILITIES_FOLDER_ID
}

/**
 * v1.1.2 T6: what ⌘R is currently renaming (spec issue #10) — the selected
 * project card, or the drilled-in folder when nothing is selected.
 */
export type RenameTarget =
  | { kind: 'project'; path: string }
  | { kind: 'folder'; id: string }

interface ProjectState {
  /** Project that passed preflight and is ready to start (starting is task-2). */
  currentProject: CurrentProject | null
  /**
   * The project history master list (persisted as Recent Projects). The
   * v1.2.0 trust gate was removed (spec issue #15): opening a path adds it
   * here directly, with no confirmation step.
   */
  recentProjectPaths: string[]
  /**
   * v1.1.2: one-level performance folders (set lists). Membership only —
   * `recentProjectPaths` stays the master list, so deleting a folder merely
   * returns its projects to the ungrouped section (spec issue #4).
   */
  projectFolders: ProjectFolder[]
  /** Path whose preflight is in flight (drives the entry highlight). */
  pendingPreflightPath: string | null
  /**
   * Path awaiting §8.3 switch confirmation while a session runs. Lives in
   * the store (not the Sidebar) so the keyboard layer can request the same
   * dialog (spec issue #4: 单一选中语义源).
   */
  pendingSwitchPath: string | null
  /**
   * v1.1.2 T7: the plain-Esc close-project confirmation is open. Cmd+Esc
   * and the Close button close directly; a lone Esc must confirm first.
   * In the store for the same reason as `pendingSwitchPath`.
   */
  confirmCloseProjectOpen: boolean
  /**
   * v1.1.2 T3: the folder the sidebar is drilled into, null at the top
   * level. Session-memory view state — never persisted (spec issue #4).
   */
  activeFolderId: string | null
  /**
   * v1.1.2 T6: user-chosen display name per project path (spec issue #10).
   * Absent entry = derived path-basename name. Persisted in preferences.
   */
  projectDisplayNames: Record<string, string>
  /** Card currently in inline rename; drives the sidebar's edit state. */
  renameTarget: RenameTarget | null
  preflightStatus: PreflightStatus
  preflightError: string | null
  addRecentProject: (path: string) => void
  removeRecentProject: (path: string) => void
  /** Empties the history; folder memberships go with it (folders stay). */
  clearRecentProjects: () => void
  setPendingPreflight: (path: string | null) => void
  requestSwitch: (path: string) => void
  clearSwitchRequest: () => void
  setConfirmCloseProjectOpen: (open: boolean) => void
  /** Drills the sidebar into a folder, or back to the top level (null). */
  setActiveFolderId: (id: string | null) => void
  /** Restores display-name overrides from persisted preferences. */
  setProjectDisplayNames: (names: Record<string, string>) => void
  /**
   * Sets one override. An empty name removes the entry — the card falls
   * back to the path-basename name (spec issue #10: 空串回退).
   */
  setProjectDisplayName: (path: string, name: string) => void
  setRenameTarget: (target: RenameTarget | null) => void
  setProjectFolders: (folders: ProjectFolder[]) => void
  /** Creates a folder and returns its id (caller drives inline naming). */
  createFolder: (name: string) => string
  renameFolder: (id: string, name: string) => void
  /** Deletes the grouping; member projects return to ungrouped. */
  deleteFolder: (id: string) => void
  /** Moves a path into a folder (appended last), out of any other folder. */
  moveProjectToFolder: (folderId: string, path: string) => void
  /** Returns a path to the ungrouped section. */
  removeProjectFromFolder: (folderId: string, path: string) => void
  /**
   * v1.1.2 T4: applies a drag-reorder of the visible list (computed by the
   * drag-reorder pure helpers). Inside a folder it replaces that folder's
   * member order; at the top level the master list is remapped so folder
   * members keep their slots. A set that is not the current visible list is
   * ignored.
   */
  applyVisibleReorder: (newVisiblePaths: string[]) => void
  /**
   * v1.1.2 T5: applies a drag-reorder of the folder cards (their ids in the
   * new order). An id set that is not the current folder set is ignored.
   */
  applyFolderReorder: (orderedFolderIds: string[]) => void
  startPreflight: () => void
  preflightSucceeded: (path: string, manifest: Manifest) => void
  preflightFailed: (message: string) => void
  clearProject: () => void
}

/** Drops `path` from every folder's membership list. Empty folders stay. */
function withoutFolderMember(
  folders: ProjectFolder[],
  path: string
): ProjectFolder[] {
  return folders.map(folder =>
    folder.projectPaths.includes(path)
      ? { ...folder, projectPaths: folder.projectPaths.filter(p => p !== path) }
      : folder
  )
}

/**
 * Projects visible at the sidebar's top level: history entries that are not
 * in any folder, in master-list order. Folders render below them and never
 * take a number badge (spec issue #4: 两段式布局).
 */
export function ungroupedProjectPaths(
  recentProjectPaths: string[],
  folders: ProjectFolder[]
): string[] {
  const grouped = new Set(folders.flatMap(folder => folder.projectPaths))
  return recentProjectPaths.filter(path => !grouped.has(path))
}

/**
 * v1.1.2 T3: projects visible in the current view (spec issue #4: 可见列
 * 表与序号派生). The top level shows the ungrouped segment (folder cards
 * never take a number); a folder view shows that folder's members in their
 * set order. Badges and Cmd+1..9 both consume this single derivation, so
 * they can never disagree.
 */
export function visibleProjectPaths(
  recentProjectPaths: string[],
  folders: ProjectFolder[],
  activeFolderId: string | null
): string[] {
  if (activeFolderId !== null) {
    const folder = folders.find(folder => folder.id === activeFolderId)
    return folder ? folder.projectPaths : []
  }
  return ungroupedProjectPaths(recentProjectPaths, folders)
}

export const useProjectStore = create<ProjectState>()(set => ({
  currentProject: null,
  recentProjectPaths: [],
  projectFolders: [],
  pendingPreflightPath: null,
  pendingSwitchPath: null,
  confirmCloseProjectOpen: false,
  activeFolderId: null,
  projectDisplayNames: {},
  renameTarget: null,
  preflightStatus: 'idle',
  preflightError: null,

  addRecentProject: path =>
    set(state => ({
      recentProjectPaths: state.recentProjectPaths.includes(path)
        ? state.recentProjectPaths
        : [...state.recentProjectPaths, path],
    })),

  removeRecentProject: path =>
    set(state => ({
      recentProjectPaths: state.recentProjectPaths.filter(p => p !== path),
      // Removing the app-side index also drops folder membership — the
      // on-disk project is untouched (spec issue #4: 删除语义).
      projectFolders: withoutFolderMember(state.projectFolders, path),
      currentProject:
        state.currentProject?.path === path ? null : state.currentProject,
      ...(state.currentProject?.path === path
        ? { preflightStatus: 'idle' as const, preflightError: null }
        : {}),
    })),

  clearRecentProjects: () =>
    set(state => ({
      recentProjectPaths: [],
      // Members are gone with the list; the folders themselves (and the
      // protected Utilities folder) stay as empty shells.
      projectFolders: state.projectFolders.map(folder => ({
        ...folder,
        projectPaths: [],
      })),
      currentProject:
        state.currentProject !== null ? null : state.currentProject,
      ...(state.currentProject !== null
        ? { preflightStatus: 'idle' as const, preflightError: null }
        : {}),
    })),

  setPendingPreflight: path => set({ pendingPreflightPath: path }),

  requestSwitch: path => set({ pendingSwitchPath: path }),

  clearSwitchRequest: () => set({ pendingSwitchPath: null }),

  setConfirmCloseProjectOpen: confirmCloseProjectOpen =>
    set({ confirmCloseProjectOpen }),

  setActiveFolderId: id => set({ activeFolderId: id }),

  setProjectDisplayNames: names => set({ projectDisplayNames: names }),

  setProjectDisplayName: (path, name) =>
    set(state => ({
      projectDisplayNames: upsertDisplayName(
        state.projectDisplayNames,
        path,
        name
      ),
    })),

  setRenameTarget: target => set({ renameTarget: target }),

  setProjectFolders: folders => set({ projectFolders: folders }),

  createFolder: name => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`
    set(state => ({
      projectFolders: [...state.projectFolders, { id, name, projectPaths: [] }],
    }))
    return id
  },

  renameFolder: (id, name) =>
    set(state => ({
      // Protected folders keep their name (v1.1.2 T7) — the guard makes
      // every entry point (inline commit, ⌘R, Edit menu) a silent no-op.
      projectFolders: isProtectedFolder(id)
        ? state.projectFolders
        : state.projectFolders.map(folder =>
            folder.id === id ? { ...folder, name } : folder
          ),
    })),

  deleteFolder: id =>
    set(state => ({
      // Protected folders are never deleted; membership edits are the
      // only structural lever on them (v1.1.2 T7).
      projectFolders: isProtectedFolder(id)
        ? state.projectFolders
        : state.projectFolders.filter(folder => folder.id !== id),
      // Deleting the folder the sidebar is drilled into exits to the top.
      activeFolderId: state.activeFolderId === id ? null : state.activeFolderId,
    })),

  moveProjectToFolder: (folderId, path) =>
    set(state => {
      const folders = withoutFolderMember(state.projectFolders, path).map(
        folder =>
          folder.id === folderId && !folder.projectPaths.includes(path)
            ? { ...folder, projectPaths: [...folder.projectPaths, path] }
            : folder
      )
      return { projectFolders: folders }
    }),

  removeProjectFromFolder: (folderId, path) =>
    set(state => ({
      projectFolders: withoutFolderMember(state.projectFolders, path).map(
        folder =>
          folder.id === folderId
            ? {
                ...folder,
                projectPaths: folder.projectPaths.filter(p => p !== path),
              }
            : folder
      ),
    })),

  applyVisibleReorder: newVisiblePaths =>
    set(state => {
      if (state.activeFolderId !== null) {
        return {
          projectFolders: state.projectFolders.map(folder =>
            folder.id === state.activeFolderId &&
            sameMemberSet(folder.projectPaths, newVisiblePaths)
              ? { ...folder, projectPaths: newVisiblePaths }
              : folder
          ),
        }
      }
      return {
        recentProjectPaths: masterWithUngroupedOrder(
          state.recentProjectPaths,
          state.projectFolders,
          newVisiblePaths
        ),
      }
    }),

  applyFolderReorder: orderedFolderIds =>
    set(state => {
      if (
        !sameMemberSet(
          state.projectFolders.map(folder => folder.id),
          orderedFolderIds
        )
      ) {
        return {}
      }
      const byId = new Map(
        state.projectFolders.map(folder => [folder.id, folder] as const)
      )
      const reordered = orderedFolderIds
        .map(id => byId.get(id))
        .filter((folder): folder is ProjectFolder => folder !== undefined)
      return { projectFolders: reordered }
    }),

  startPreflight: () =>
    set({ preflightStatus: 'checking', preflightError: null }),

  preflightSucceeded: (path, manifest) =>
    set({
      currentProject: { path, manifest },
      preflightStatus: 'ready',
      preflightError: null,
    }),

  preflightFailed: message =>
    set({
      preflightStatus: 'error',
      preflightError: message,
      currentProject: null,
    }),

  clearProject: () =>
    set({
      currentProject: null,
      preflightStatus: 'idle',
      preflightError: null,
    }),
}))
