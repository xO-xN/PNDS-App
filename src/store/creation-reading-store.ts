import { create } from 'zustand'
import type { ReactNode } from 'react'
import type { GitComparison } from '@/lib/tauri-bindings'

export interface CreationReadingExtension {
  id: string
  title: string
  /** Trusted application UI supplied by a consumer, never model HTML. */
  content: ReactNode
}

interface CreationReadingState {
  owner: string | null
  view:
    | 'discussion'
    | 'file'
    | 'handoff'
    | 'extension'
    | 'git'
    | 'pending'
    | 'mergeChecks'
    | 'terminal'
  terminalVisited: boolean
  /** Monotonic explicit visit intent, including across workspace remounts. */
  terminalFocusRevision: number
  showTerminal: () => void
  gitIntent: 'history' | 'status'
  gitIntentRevision: number
  gitVisited: boolean
  gitRevision: number
  gitComparison: GitComparison | null
  gitComparisonPhase: 'idle' | 'loading' | 'ready' | 'error'
  gitComparisonMode: 'parent' | 'saved'
  setGitComparisonMode: (mode: 'parent' | 'saved') => void
  gitComparisonWorking: boolean
  setGitComparisonWorking: (working: boolean) => void
  gitPath: string | null
  setGitComparison: (
    comparison: GitComparison | null,
    phase?: 'loading' | 'error'
  ) => void
  selectGitPath: (path: string) => void
  gitChanged: () => void
  handoffVisited: boolean
  gitTarget: { commit: string; branch: string } | null
  switchBranch: (commit: string, branch: string) => void
  showGit: (intent?: 'history' | 'status') => void
  returnMessageId: string | null
  extension: CreationReadingExtension | null
  syncWorkspace: (identity: string | null) => void
  showDiscussion: (messageId?: string) => void
  showFile: (messageId?: string) => void
  showPending: () => void
  showMergeChecks: () => void
  showHandoff: (messageId?: string) => void
  showExtension: (
    extension: CreationReadingExtension,
    messageId: string
  ) => void
}

export const useCreationReadingStore = create<CreationReadingState>(
  (set, get) => ({
    owner: null,
    view: 'discussion',
    terminalVisited: false,
    terminalFocusRevision: 0,
    showTerminal: () =>
      set(state => ({
        view: 'terminal',
        terminalVisited: true,
        terminalFocusRevision: state.terminalFocusRevision + 1,
      })),
    gitIntent: 'history',
    gitIntentRevision: 0,
    gitVisited: false,
    gitRevision: 0,
    gitComparison: null,
    gitComparisonPhase: 'idle',
    gitComparisonMode: 'parent',
    setGitComparisonMode: gitComparisonMode => set({ gitComparisonMode }),
    gitComparisonWorking: false,
    setGitComparisonWorking: gitComparisonWorking =>
      set({ gitComparisonWorking }),
    gitPath: null,
    setGitComparison: (gitComparison, phase) =>
      set(state => ({
        gitComparison,
        gitComparisonPhase: gitComparison ? 'ready' : (phase ?? 'loading'),
        gitPath: !gitComparison
          ? state.gitPath
          : gitComparison.files.some(
                file =>
                  file.path === state.gitPath && file.status !== 'unchanged'
              )
            ? state.gitPath
            : (gitComparison.files.find(file => file.status !== 'unchanged')
                ?.path ?? null),
      })),
    selectGitPath: gitPath =>
      set(state =>
        state.gitComparison?.files.some(
          file => file.path === gitPath && file.status !== 'unchanged'
        )
          ? { gitPath }
          : {}
      ),
    gitChanged: () => set(state => ({ gitRevision: state.gitRevision + 1 })),
    handoffVisited: false,
    gitTarget: null,
    switchBranch: (commit, branch) =>
      set(state => ({
        view: 'git',
        gitVisited: true,
        gitIntent: 'history',
        gitIntentRevision: state.gitIntentRevision + 1,
        gitTarget: { commit, branch },
      })),
    returnMessageId: null,
    extension: null,
    syncWorkspace: owner => {
      if (owner !== get().owner)
        set({
          owner,
          view: 'discussion',
          terminalVisited: false,
          returnMessageId: null,
          extension: null,
          gitIntent: 'history',
          gitIntentRevision: 0,
          gitVisited: false,
          gitRevision: 0,
          gitComparison: null,
          gitComparisonPhase: 'idle',
          gitComparisonMode: 'parent',
          gitComparisonWorking: false,
          gitPath: null,
          handoffVisited: false,
          gitTarget: null,
        })
    },
    showGit: (gitIntent = 'history') =>
      set(state => ({
        view: 'git',
        gitIntent,
        gitIntentRevision: state.gitIntentRevision + 1,
        gitVisited: true,
        gitTarget: null,
      })),
    showDiscussion: messageId =>
      set(state => ({
        view: 'discussion',
        returnMessageId: messageId ?? state.returnMessageId,
      })),
    showFile: messageId =>
      set(state => ({
        view: 'file',
        returnMessageId: messageId ?? state.returnMessageId,
      })),
    showPending: () => set({ view: 'pending' }),
    showMergeChecks: () => set({ view: 'mergeChecks' }),
    showHandoff: messageId =>
      set(state => ({
        view: 'handoff',
        handoffVisited: true,
        returnMessageId: messageId ?? state.returnMessageId,
      })),
    showExtension: (extension, messageId) =>
      set({ view: 'extension', extension, returnMessageId: messageId }),
  })
)
