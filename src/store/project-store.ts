import { create } from 'zustand'
import type { Manifest, ProjectFolder } from '@/lib/tauri-bindings'
import { masterWithUngroupedOrder, sameMemberSet } from '@/lib/drag-reorder'
import { upsertDisplayName } from '@/lib/display-names'
import { updatePreferences } from '@/lib/preferences'

export interface CurrentProject {
  path: string
  manifest: Manifest
}

export type PreflightStatus = 'idle' | 'checking' | 'ready' | 'error'

/**
 * v1.1.2 T7 (spec issue #11): reserved id of the default Utilities folder
 * seeded from the bundled example projects. Its membership can be edited,
 * but it is pinned to the bottom of the folder area (v1.2.0) and never
 * renamed or deleted.
 */
export const UTILITIES_FOLDER_ID = 'utilities'

/**
 * v1.2.1 (issue #26): hard sidebar capacity caps — hardcoded constants,
 * not preferences. Over-limit legacy data loads untouched (defensive: no
 * destructive migration on performance machines); the caps only refuse
 * further additions.
 */
export const FOLDER_LIMIT = 3
export const PROJECT_LIMIT_PER_DIRECTORY = 30

/** True for folders the sidebar must keep as-is (no rename, no delete). */
export function isProtectedFolder(id: string): boolean {
  return id === UTILITIES_FOLDER_ID
}

/**
 * v1.2.1 (issue #26): the folder area is at its cap (Utilities counts) —
 * the sidebar's FOLDERS "+" derives its disabled state from this, never
 * from its own count.
 */
export function folderLimitReached(folders: ProjectFolder[]): boolean {
  return folders.length >= FOLDER_LIMIT
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
  /**
   * v1.2.0 (issue #16): manifest-declared name per project path, learned on
   * every successful preflight and restored from preferences. The listings
   * show it (user overrides still win) so a bundle install reads as its
   * manifest name, not its `<id>-<version>` directory.
   */
  manifestProjectNames: Record<string, string>
  /** Card currently in inline rename; drives the sidebar's edit state. */
  renameTarget: RenameTarget | null
  preflightStatus: PreflightStatus
  preflightError: string | null
  /**
   * v1.2.1 (issue #26): adds a history entry, refused (false) when the
   * landing directory is at `PROJECT_LIMIT_PER_DIRECTORY` — the drilled-in
   * folder on an import, the ungrouped top level otherwise. Reopening a
   * known path is never refused. Refusals leave the state and the
   * persisted index untouched; the caller surfaces the reason.
   */
  addRecentProject: (path: string) => boolean
  removeRecentProject: (path: string) => void
  /** Empties the history; folder memberships go with it (folders stay). */
  clearRecentProjects: () => void
  setPendingPreflight: (path: string | null) => void
  requestSwitch: (path: string) => void
  clearSwitchRequest: () => void
  setConfirmCloseProjectOpen: (open: boolean) => void
  /** Drills the sidebar into a folder, or back to the top level (null). */
  setActiveFolderId: (id: string | null) => void
  /** Restores display-name overrides from persisted preferences (launch). */
  setProjectDisplayNames: (names: Record<string, string>) => void
  /** Restores the learned manifest names from persisted preferences (launch). */
  setManifestProjectNames: (names: Record<string, string>) => void
  /**
   * Merges learned manifest names (truthy entries only) and persists when
   * the map changed — the Utilities seeding learns every tool's name up
   * front (issue #18).
   */
  upsertManifestProjectNames: (names: Record<string, string>) => void
  /**
   * Sets one override and persists it. An empty name removes the entry —
   * the card falls back to the path-basename name (spec issue #10: 空串回退).
   */
  setProjectDisplayName: (path: string, name: string) => void
  setRenameTarget: (target: RenameTarget | null) => void
  /**
   * Bulk restore from persisted preferences at launch — the one index
   * mutation that must NOT write back. Every structural action below
   * persists the index as part of its commit; this is their
   * non-persisting counterpart for boot.
   */
  restoreProjectIndex: (paths: string[], folders: ProjectFolder[]) => void
  /**
   * Bulk folder replace that persists like any structural commit — the
   * Utilities seeding flow (issue #18) seeds and bottom-pins through it.
   * Launch restore goes through `restoreProjectIndex` instead.
   */
  setProjectFolders: (folders: ProjectFolder[]) => void
  /**
   * v1.2.1 (issue #26): creates a folder and returns its id (caller drives
   * inline naming), or null when the folder area is at `FOLDER_LIMIT`
   * (Utilities counts). A refusal changes nothing.
   */
  createFolder: (name: string) => string | null
  renameFolder: (id: string, name: string) => void
  /** Deletes the grouping; member projects return to ungrouped. */
  deleteFolder: (id: string) => void
  /**
   * Moves a path into a folder (appended last), out of any other folder.
   * v1.2.1 (issue #26): joining a folder already holding
   * `PROJECT_LIMIT_PER_DIRECTORY` members is refused (false) — unless the
   * path is already a member (a no-op re-file). Removals and folder
   * deletions that leave a directory over-limit are tolerated: only
   * additions are capped.
   */
  moveProjectToFolder: (folderId: string, path: string) => boolean
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

/** Content equality for the small persisted slices — guards and repeat
 * commits produce new references with unchanged contents, and those must
 * not write. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Structural actions persist the app-side project index as part of their
 * commit — history and folder membership always save together (v1.1.2),
 * so no caller can forget the save. No-op guards (protected folders,
 * ignored drag sets) settle as "unchanged" and write nothing.
 */
function persistIndexIfChanged(
  before: Pick<ProjectState, 'recentProjectPaths' | 'projectFolders'>,
  after: Pick<ProjectState, 'recentProjectPaths' | 'projectFolders'>
): void {
  if (sameJson(before, after)) return
  void updatePreferences({
    recentProjects: after.recentProjectPaths,
    projectFolders: after.projectFolders,
  })
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  currentProject: null,
  recentProjectPaths: [],
  projectFolders: [],
  pendingPreflightPath: null,
  pendingSwitchPath: null,
  confirmCloseProjectOpen: false,
  activeFolderId: null,
  projectDisplayNames: {},
  manifestProjectNames: {},
  renameTarget: null,
  preflightStatus: 'idle',
  preflightError: null,

  addRecentProject: path => {
    const before = get()
    if (!before.recentProjectPaths.includes(path)) {
      // v1.2.1 (issue #26): the cap counts the landing directory — the
      // drilled-in folder an import joins, the ungrouped top level
      // otherwise. The check runs before any state change, so a refusal
      // neither mutates nor persists.
      const landing =
        before.activeFolderId === null
          ? null
          : (before.projectFolders.find(
              folder => folder.id === before.activeFolderId
            ) ?? null)
      const count = landing
        ? landing.projectPaths.length
        : ungroupedProjectPaths(
            before.recentProjectPaths,
            before.projectFolders
          ).length
      if (count >= PROJECT_LIMIT_PER_DIRECTORY) return false
    }
    set(state => ({
      recentProjectPaths: state.recentProjectPaths.includes(path)
        ? state.recentProjectPaths
        : [...state.recentProjectPaths, path],
    }))
    persistIndexIfChanged(before, get())
    return true
  },

  removeRecentProject: path => {
    const before = get()
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
    }))
    persistIndexIfChanged(before, get())
  },

  clearRecentProjects: () => {
    const before = get()
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
    }))
    persistIndexIfChanged(before, get())
  },

  setPendingPreflight: path => set({ pendingPreflightPath: path }),

  requestSwitch: path => set({ pendingSwitchPath: path }),

  clearSwitchRequest: () => set({ pendingSwitchPath: null }),

  setConfirmCloseProjectOpen: confirmCloseProjectOpen =>
    set({ confirmCloseProjectOpen }),

  setActiveFolderId: id => set({ activeFolderId: id }),

  setProjectDisplayNames: names => set({ projectDisplayNames: names }),

  setManifestProjectNames: names => set({ manifestProjectNames: names }),

  upsertManifestProjectNames: names => {
    const before = get()
    set(state => {
      const merged = { ...state.manifestProjectNames }
      for (const [path, name] of Object.entries(names)) {
        if (name) merged[path] = name
      }
      return { manifestProjectNames: merged }
    })
    const after = get()
    if (sameJson(before.manifestProjectNames, after.manifestProjectNames)) {
      return
    }
    void updatePreferences({
      projectManifestNames: after.manifestProjectNames,
    })
  },

  setProjectDisplayName: (path, name) => {
    const before = get()
    set(state => ({
      projectDisplayNames: upsertDisplayName(
        state.projectDisplayNames,
        path,
        name
      ),
    }))
    const after = get()
    if (sameJson(before.projectDisplayNames, after.projectDisplayNames)) {
      return
    }
    void updatePreferences({ projectDisplayNames: after.projectDisplayNames })
  },

  setRenameTarget: target => set({ renameTarget: target }),

  restoreProjectIndex: (paths, folders) =>
    set({ recentProjectPaths: paths, projectFolders: folders }),

  setProjectFolders: folders => {
    const before = get()
    set({ projectFolders: folders })
    persistIndexIfChanged(before, get())
  },

  createFolder: name => {
    const before = get()
    // v1.2.1 (issue #26): the folder cap (Utilities counts) refuses the
    // creation outright — the sidebar's "+" is disabled at the same
    // threshold via `folderLimitReached`.
    if (folderLimitReached(before.projectFolders)) return null
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`
    set(state => ({
      // New folders open at the TOP of the folder area (v1.2.0: they used
      // to append below the bottom-pinned Utilities folder).
      projectFolders: [{ id, name, projectPaths: [] }, ...state.projectFolders],
    }))
    persistIndexIfChanged(before, get())
    return id
  },

  renameFolder: (id, name) => {
    const before = get()
    set(state => ({
      // Protected folders keep their name (v1.1.2 T7) — the guard makes
      // every entry point (inline commit, ⌘R, Edit menu) a silent no-op.
      projectFolders: isProtectedFolder(id)
        ? state.projectFolders
        : state.projectFolders.map(folder =>
            folder.id === id ? { ...folder, name } : folder
          ),
    }))
    persistIndexIfChanged(before, get())
  },

  deleteFolder: id => {
    const before = get()
    set(state => ({
      // Protected folders are never deleted; membership edits are the
      // only structural lever on them (v1.1.2 T7).
      projectFolders: isProtectedFolder(id)
        ? state.projectFolders
        : state.projectFolders.filter(folder => folder.id !== id),
      // Deleting the folder the sidebar is drilled into exits to the top.
      activeFolderId: state.activeFolderId === id ? null : state.activeFolderId,
    }))
    persistIndexIfChanged(before, get())
  },

  moveProjectToFolder: (folderId, path) => {
    const before = get()
    const target = before.projectFolders.find(folder => folder.id === folderId)
    // v1.2.1 (issue #26): a join that would push the target past the
    // per-directory cap is refused before any state change. A path already
    // inside the target is a no-op re-file, never a refusal.
    if (
      target &&
      !target.projectPaths.includes(path) &&
      target.projectPaths.length >= PROJECT_LIMIT_PER_DIRECTORY
    ) {
      return false
    }
    set(state => {
      const folders = withoutFolderMember(state.projectFolders, path).map(
        folder =>
          folder.id === folderId && !folder.projectPaths.includes(path)
            ? { ...folder, projectPaths: [...folder.projectPaths, path] }
            : folder
      )
      return { projectFolders: folders }
    })
    persistIndexIfChanged(before, get())
    return true
  },

  removeProjectFromFolder: (folderId, path) => {
    const before = get()
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
    }))
    persistIndexIfChanged(before, get())
  },

  applyVisibleReorder: newVisiblePaths => {
    const before = get()
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
    })
    persistIndexIfChanged(before, get())
  },

  applyFolderReorder: orderedFolderIds => {
    const before = get()
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
      // The Utilities folder is pinned to the bottom of the folder area
      // (v1.2.0): a drag may compute any order — including below it —
      // the commit always settles it last, so a bottom drop lands just
      // above it.
      const pinned = reordered.filter(folder => isProtectedFolder(folder.id))
      const ordered = pinned.length
        ? [
            ...reordered.filter(folder => !isProtectedFolder(folder.id)),
            ...pinned,
          ]
        : reordered
      return { projectFolders: ordered }
    })
    persistIndexIfChanged(before, get())
  },

  startPreflight: () =>
    set({ preflightStatus: 'checking', preflightError: null }),

  preflightSucceeded: (path, manifest) => {
    const before = get()
    set(state => ({
      currentProject: { path, manifest },
      preflightStatus: 'ready',
      preflightError: null,
      // v1.2.0 (issue #16): learn the manifest-declared name so every
      // listing shows it, not just the selected project. Persisted when
      // the learn actually changed something (a reopen of a known name
      // saves nothing).
      manifestProjectNames: upsertDisplayName(
        state.manifestProjectNames,
        path,
        manifest.name
      ),
    }))
    const after = get()
    if (sameJson(before.manifestProjectNames, after.manifestProjectNames)) {
      return
    }
    void updatePreferences({
      projectManifestNames: after.manifestProjectNames,
    })
  },

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
