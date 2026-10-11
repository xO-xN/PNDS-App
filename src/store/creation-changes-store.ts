import { create } from 'zustand'
import { commands, type CreationError } from '@/lib/tauri-bindings'
import { creationTransportError, useCreationStore } from './creation-store'
import { useCreationDraftsStore } from './creation-drafts-store'
import { useSessionStore } from './session-store'

type UpdateKind = 'refresh' | 'restart' | 'compile'
export interface CreationUpdateToken {
  identity: string
  revision: number
}
interface CreationChangesState {
  revision: number
  diskRevision: number
  fileRevisions: Record<string, number>
  pending: Record<UpdateKind, number>
  error: CreationError | null
  poll: () => Promise<boolean>
  changed: (paths: string[]) => void
  capture: (root: string) => Promise<CreationUpdateToken | null>
  complete: (token: CreationUpdateToken | null, kind: UpdateKind) => void
}

const empty = () => ({
  revision: 0,
  diskRevision: 0,
  fileRevisions: {},
  pending: { refresh: 0, restart: 0, compile: 0 },
  error: null,
})
let polling: { identity: string; promise: Promise<boolean> } | null = null

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

export const useCreationChangesStore = create<CreationChangesState>(
  (set, get) => ({
    ...empty(),
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
      const owns = () =>
        useCreationStore.getState().workspace?.project.identity === identity
      const promise = (async () => {
        try {
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
          get().changed(change.changed)
          const current = useCreationStore.getState().workspace
          if (!current || !owns()) return false
          if (change.changed.length)
            useCreationStore.setState({
              workspace: { project: current.project, files: change.files },
            })
          set({ error: null })
          const synchronized = await Promise.all(
            change.changed.map(path =>
              useCreationDraftsStore.getState().observeDisk(path)
            )
          )
          if (!owns()) return false
          // Retry the batch after an in-flight save settles; otherwise an
          // external write racing that save could disappear from the watcher.
          const complete = synchronized.every(Boolean)
          if (complete) set({ diskRevision: change.revision })
          return complete
        } catch (error) {
          if (owns()) set({ error: creationTransportError(error) })
          return false
        } finally {
          if (polling?.identity === identity) polling = null
        }
      })()
      polling = { identity, promise }
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
  })
)

let identity: string | null = null
useCreationStore.subscribe(state => {
  const next = state.workspace?.project.identity ?? null
  if (next !== identity) {
    identity = next
    useCreationChangesStore.setState(empty())
  }
})
