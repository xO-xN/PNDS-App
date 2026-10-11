import { create } from 'zustand'
import { open } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import {
  commands,
  type CreationError,
  type CreationWorkspace,
} from '@/lib/tauri-bindings'
import { updatePreferences } from '@/lib/preferences'
import { logger } from '@/lib/logger'
import { useSessionStore } from './session-store'
import { useProjectStore } from './project-store'

interface CreationRequest {
  readonly path: string
}
interface CreationState {
  active: boolean
  epoch: number
  workspace: CreationWorkspace | null
  recentPaths: string[]
  opening: boolean
  request: CreationRequest | null
  error: CreationError | null
  enter: () => void
  leave: () => void
  restoreRecent: (paths: string[]) => void
  open: (path: string) => Promise<boolean>
  pick: () => Promise<boolean>
}

// Keep backend capability replacements in invocation order, including when
// the user leaves and re-enters while an IPC call is still pending.
let openQueue: Promise<unknown> = Promise.resolve()

async function releaseIdentity(identity: string): Promise<void> {
  try {
    const result = await commands.closeCreationProject(identity)
    if (result.status === 'error')
      logger.warn('Failed to release creation identity', {
        error: result.error,
      })
  } catch (error) {
    logger.warn('Failed to release creation identity', { error })
  }
}

export function creationTransportError(error: unknown): CreationError {
  return {
    code: 'io',
    detail: error instanceof Error ? error.message : String(error),
  }
}

export const useCreationStore = create<CreationState>((set, get) => ({
  active: false,
  epoch: 0,
  workspace: null,
  recentPaths: [],
  opening: false,
  request: null,
  error: null,
  enter: () => {
    if (useSessionStore.getState().sessionStatus === 'idle')
      set(state => ({ active: true, epoch: state.epoch + 1, error: null }))
  },
  leave: () => {
    const identity = get().workspace?.project.identity
    set(state => ({
      active: false,
      epoch: state.epoch + 1,
      workspace: null,
      request: null,
      opening: false,
      error: null,
    }))
    useProjectStore.getState().clearProject()
    if (identity) void releaseIdentity(identity)
  },
  restoreRecent: paths =>
    set(state => ({
      recentPaths: [...new Set([...state.recentPaths, ...paths])].slice(0, 20),
    })),
  open: async path => {
    if (!get().active || get().opening) return false
    const request: CreationRequest = { path }
    set({ request, opening: true, error: null })
    const owns = () => get().active && get().request === request
    const run = async () => {
      if (!owns()) return false
      try {
        const result = await commands.openCreationProject(path)
        if (!owns()) {
          if (result.status === 'ok')
            await releaseIdentity(result.data.project.identity)
          return false
        }
        if (result.status === 'error') {
          set({ error: result.error })
          return false
        }
        const workspace = result.data
        const recentPaths =
          workspace.project.source === 'folder'
            ? [
                workspace.project.root,
                ...get().recentPaths.filter(
                  path => path !== workspace.project.root
                ),
              ].slice(0, 20)
            : get().recentPaths
        set({ workspace, recentPaths, error: null })
        if (workspace.project.source === 'folder')
          void updatePreferences({ recentCreationProjects: recentPaths })
        return true
      } catch (error) {
        if (owns()) set({ error: creationTransportError(error) })
        return false
      } finally {
        if (owns()) set({ opening: false, request: null })
      }
    }
    const task = openQueue.then(run, run)
    openQueue = task
    return task
  },
  pick: async () => {
    if (!get().active || get().opening) return false
    const epoch = get().epoch
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: i18n.t('creation.openFolder'),
      })
      return typeof selected === 'string' &&
        get().active &&
        get().epoch === epoch
        ? get().open(selected)
        : false
    } catch (error) {
      if (get().active && get().epoch === epoch)
        set({ error: creationTransportError(error) })
      return false
    }
  },
}))
