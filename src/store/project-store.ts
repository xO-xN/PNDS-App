import { create } from 'zustand'
import type { Manifest } from '@/lib/tauri-bindings'

export interface CurrentProject {
  path: string
  manifest: Manifest
}

export type PreflightStatus = 'idle' | 'checking' | 'ready' | 'error'

interface ProjectState {
  /** Project that passed preflight and is ready to start (starting is task-2). */
  currentProject: CurrentProject | null
  /**
   * Paths the user has explicitly trusted this session (§4). Persistence
   * across launches is task-6 (Recent Projects).
   */
  trustedPaths: string[]
  /** Path awaiting trust confirmation (drives the trust dialog). */
  pendingTrustPath: string | null
  preflightStatus: PreflightStatus
  preflightError: string | null
  isTrusted: (path: string) => boolean
  trustProject: (path: string) => void
  removeTrusted: (path: string) => void
  moveTrusted: (fromPath: string, toPath: string) => void
  requestTrust: (path: string | null) => void
  startPreflight: () => void
  preflightSucceeded: (path: string, manifest: Manifest) => void
  preflightFailed: (message: string) => void
  clearProject: () => void
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  currentProject: null,
  trustedPaths: [],
  pendingTrustPath: null,
  preflightStatus: 'idle',
  preflightError: null,

  isTrusted: path => get().trustedPaths.includes(path),

  trustProject: path =>
    set(state => ({
      trustedPaths: state.trustedPaths.includes(path)
        ? state.trustedPaths
        : [...state.trustedPaths, path],
    })),

  removeTrusted: path =>
    set(state => ({
      trustedPaths: state.trustedPaths.filter(p => p !== path),
      currentProject:
        state.currentProject?.path === path ? null : state.currentProject,
      ...(state.currentProject?.path === path
        ? { preflightStatus: 'idle' as const, preflightError: null }
        : {}),
    })),

  moveTrusted: (fromPath, toPath) =>
    set(state => {
      const paths = [...state.trustedPaths]
      const from = paths.indexOf(fromPath)
      const to = paths.indexOf(toPath)
      if (from === -1 || to === -1 || from === to) return {}
      const [moved] = paths.splice(from, 1)
      if (moved === undefined) return {}
      paths.splice(to, 0, moved)
      return { trustedPaths: paths }
    }),

  requestTrust: path => set({ pendingTrustPath: path }),

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
