import { create } from 'zustand'
import i18n from '@/i18n/config'
import {
  commands,
  type CreationWorkspace,
  type SynthdefCompileReport,
} from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
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
  pendingNoticeShown: boolean
  run: () => Promise<void>
}

export function hasCompileSource(workspace: CreationWorkspace | null): boolean {
  return !!workspace?.files.some(file =>
    /^supercollider\/source\/[^/]+\.scd$/.test(file.path)
  )
}

export function compileUnavailableReason(
  workspace: CreationWorkspace | null,
  draftPaths: string,
  busy: boolean,
  runtimeBusy: boolean
): string | null {
  if (!workspace || workspace.project.source !== 'folder')
    return i18n.t('creation.source.readOnlyFolder')
  if (!hasCompileSource(workspace))
    return i18n.t('creation.compile.sourceMissing')
  if (busy) return i18n.t('creation.compile.busy')
  if (draftPaths)
    return i18n.t('creation.compile.unsaved', { paths: draftPaths })
  return runtimeBusy ? i18n.t('creation.compile.runtimeBusy') : null
}

export function selectCompileUnavailableReason(): string | null {
  const session = useSessionStore.getState()
  return compileUnavailableReason(
    useCreationStore.getState().workspace,
    selectCompileDraftPaths(useCreationFilesStore.getState()),
    useCreationCompileStore.getState().busy,
    session.commandPending ||
      ['starting', 'stopping'].includes(session.sessionStatus)
  )
}

let workspaceGeneration = 0
export const useCreationCompileStore = create<CreationCompileState>(
  (set, get) => ({
    busy: false,
    report: null,
    error: null,
    pendingNoticeShown: false,
    run: async () => {
      const workspace = useCreationStore.getState().workspace
      if (
        !workspace ||
        workspace.project.source !== 'folder' ||
        get().busy ||
        selectCompileUnavailableReason()
      )
        return
      const { identity, root } = workspace.project
      const generation = workspaceGeneration
      const owns = () =>
        workspaceGeneration === generation &&
        useCreationStore.getState().workspace?.project.identity === identity
      const toastId = `creation-compile:${identity}`
      set({ busy: true, report: null, error: null })
      notifications.flow.dismiss(`creation-compile-pending:${identity}`)
      notifications.flow.step(toastId, i18n.t('creation.compile.busy'))
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
        const reason = compileUnavailableReason(
          useCreationStore.getState().workspace,
          selectCompileDraftPaths(useCreationFilesStore.getState()),
          false,
          useSessionStore.getState().commandPending ||
            ['starting', 'stopping'].includes(
              useSessionStore.getState().sessionStatus
            )
        )
        if (reason) {
          set({ error: reason })
          notifications.flow.fail(
            toastId,
            i18n.t('creation.compile.failed'),
            reason
          )
          return
        }
        const result = await commands.compileCreationSynthdefs(identity)
        if (!owns()) return
        if (result.status === 'error') throw result.error
        set({ report: result.data })
        if (!result.data.error)
          useCreationFilesStore.getState().complete(update, 'compile')
        let synchronized = true
        if (result.data.produced.length) {
          try {
            synchronized = await useCreationFilesStore.getState().poll()
          } catch {
            synchronized = false
          }
        }
        if (!owns()) return
        if (result.data.error)
          notifications.flow.fail(
            toastId,
            i18n.t('creation.compile.failed'),
            result.data.error
          )
        else if (!synchronized)
          notifications.flow.warn(
            toastId,
            i18n.t('creation.compile.succeeded'),
            i18n.t('creation.compile.refreshPending')
          )
        else
          notifications.flow.succeed(
            toastId,
            i18n.t('creation.compile.succeeded'),
            useCreationFilesStore.getState().pending.compile > 0
              ? i18n.t('creation.compile.newerChanges')
              : useCreationFilesStore.getState().pending.restart > 0
                ? i18n.t('creation.compile.restart')
                : i18n.t('creation.compile.verified')
          )
      } catch (error) {
        if (owns()) {
          const failure = creationTransportError(error)
          const detail = `${i18n.t(`creation.error.${failure.code}`)} ${failure.detail}`
          set({ error: detail })
          notifications.flow.fail(
            toastId,
            i18n.t('creation.compile.failed'),
            detail
          )
        }
      } finally {
        set({ busy: false })
        if (!owns()) notifications.flow.dismiss(toastId)
      }
    },
  })
)

let identity: string | null = null
useCreationStore.subscribe(state => {
  const next = state.workspace?.project.identity ?? null
  if (next !== identity) {
    workspaceGeneration += 1
    if (identity) {
      notifications.flow.dismiss(`creation-compile-pending:${identity}`)
      notifications.flow.dismiss(`creation-compile:${identity}`)
    }
    identity = next
    // Busy is a global process lease; the result belongs only to its workspace.
    useCreationCompileStore.setState({
      report: null,
      error: null,
      pendingNoticeShown: false,
    })
  }
  if (!state.active && next)
    notifications.flow.dismiss(`creation-compile-pending:${next}`)
})

useCreationFilesStore.subscribe(state => {
  if (
    !state.pending.compile &&
    useCreationCompileStore.getState().pendingNoticeShown
  )
    useCreationCompileStore.setState({ pendingNoticeShown: false })
})
