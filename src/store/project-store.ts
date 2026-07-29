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
  preflightStatus: PreflightStatus
  preflightError: string | null
  isTrusted: (path: string) => boolean
  trustProject: (path: string) => void
  startPreflight: () => void
  preflightSucceeded: (path: string, manifest: Manifest) => void
  preflightFailed: (message: string) => void
  clearProject: () => void
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  currentProject: null,
  trustedPaths: [],
  preflightStatus: 'idle',
  preflightError: null,

  isTrusted: path => get().trustedPaths.includes(path),

  trustProject: path =>
    set(state => ({
      trustedPaths: state.trustedPaths.includes(path)
        ? state.trustedPaths
        : [...state.trustedPaths, path],
    })),

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
