import { create } from 'zustand'
import i18n from '@/i18n/config'
import { commands, type SynthdefCompileReport } from '@/lib/tauri-bindings'
import { useCreationStore, creationTransportError } from './creation-store'
import { isDraftDirty, useCreationFilesStore } from './creation-files-store'
import { useCreationTestStore } from './creation-test-store'
import { useSessionStore } from './session-store'

export function selectCompileDraftPaths(
  state: ReturnType<typeof useCreationFilesStore.getState>
): string {
  return Object.entries(state.drafts)
    .filter(
      ([path, draft]) =>
        (path === 'manifest.json' || path.endsWith('.scd')) &&
        (isDraftDirty(draft) || draft.saving || draft.renaming)
    )
    .map(([path]) => path)
    .sort()
    .join(', ')
}

interface CreationCompileState {
  busy: boolean
  report: SynthdefCompileReport | null
  error: string | null
  run: () => Promise<void>
}

function blocked(): boolean {
  const session = useSessionStore.getState()
  return (
    !!selectCompileDraftPaths(useCreationFilesStore.getState()) ||
    session.commandPending ||
    ['starting', 'stopping'].includes(session.sessionStatus)
  )
}

export const useCreationCompileStore = create<CreationCompileState>(
  (set, get) => ({
    busy: false,
    report: null,
    error: null,
    run: async () => {
      const workspace = useCreationStore.getState().workspace
      if (
        !workspace ||
        workspace.project.source !== 'folder' ||
        get().busy ||
        blocked()
      )
        return
      const { identity, root } = workspace.project
      const owns = () =>
        useCreationStore.getState().workspace?.project.identity === identity
      set({ busy: true, report: null, error: null })
      useCreationTestStore.getState().setTab('console')
      try {
        const update = await useCreationFilesStore.getState().capture(root)
        if (!owns()) return
        if (!update)
          throw (
            useCreationFilesStore.getState().error ??
            new Error(i18n.t('creation.compile.syncFailed'))
          )
        // The watcher and any keystrokes while it was awaited must settle before dispatch.
        if (blocked()) {
          set({
            error: selectCompileDraftPaths(useCreationFilesStore.getState())
              ? i18n.t('creation.compile.unsaved', {
                  paths: selectCompileDraftPaths(
                    useCreationFilesStore.getState()
                  ),
                })
              : i18n.t('creation.compile.runtimeBusy'),
          })
          return
        }
        const result = await commands.compileCreationSynthdefs(identity)
        if (!owns()) return
        if (result.status === 'error') throw result.error
        set({ report: result.data })
        if (!result.data.error)
          useCreationFilesStore.getState().complete(update, 'compile')
        if (result.data.produced.length)
          await useCreationFilesStore.getState().poll()
      } catch (error) {
        if (owns()) {
          const failure = creationTransportError(error)
          set({
            error: `${i18n.t(`creation.error.${failure.code}`)} ${failure.detail}`,
          })
        }
      } finally {
        set({ busy: false })
      }
    },
  })
)

let identity: string | null = null
useCreationStore.subscribe(state => {
  const next = state.workspace?.project.identity ?? null
  if (next !== identity) {
    identity = next
    // Busy is a global process lease; the result belongs only to its workspace.
    useCreationCompileStore.setState({ report: null, error: null })
  }
})
