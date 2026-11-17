import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  commands,
  type CreationError,
  type GitRestorePreview,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  selectDirtyPathKey,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { useAssistantStore } from '@/store/assistant-store'
import { CreationErrorNotice } from './CreationErrorNotice'
import {
  blockCreationTerminalOpen,
  confirmCreationTerminalLeave,
  endCreationTerminalForLeave,
} from '@/lib/creation-terminal-leave'

export function CreationGitRestore({
  identity,
  commit,
  onBusyChange,
  onRestored,
}: {
  identity: string
  commit: string
  onBusyChange?: (busy: boolean) => void
  onRestored: () => void
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<GitRestorePreview | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const live = useRef(true)
  const pending = useRef(false)
  const dirty = useCreationFilesStore(selectDirtyPathKey)
  const running = useSessionStore(
    state =>
      ['starting', 'ready', 'stopping'].includes(state.sessionStatus) ||
      state.commandPending
  )
  const assistantBusy = useAssistantStore(state => state.phase !== 'idle')
  const editable = useCreationStore(
    state => state.workspace?.project.source === 'folder'
  )
  const revision = useCreationFilesStore(state => state.revision)
  const [previewRevision, setPreviewRevision] = useState(revision)
  const blocked = Boolean(dirty || running || assistantBusy || !editable)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const owns = () =>
    live.current &&
    useCreationStore.getState().workspace?.project.identity === identity
  const run = async (confirm: boolean) => {
    if (
      pending.current ||
      (!saved && (blocked || (confirm && revision !== previewRevision)))
    )
      return
    pending.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError(null)
    let releaseTerminal: (() => void) | undefined
    try {
      if (saved) {
        const synchronized = await useCreationFilesStore
          .getState()
          .synchronizeSaved(identity)
        if (!owns()) return
        if (synchronized) {
          setSaved(false)
          onRestored()
        } else setError(useCreationFilesStore.getState().error)
      } else if (confirm && preview) {
        releaseTerminal = blockCreationTerminalOpen()
        const project = useCreationStore.getState().workspace?.project
        const runId = useSessionStore.getState().runId
        const current = () => {
          const session = useSessionStore.getState()
          return (
            owns() &&
            useCreationStore.getState().workspace?.project === project &&
            useCreationFilesStore.getState().revision === previewRevision &&
            !selectDirtyPathKey(useCreationFilesStore.getState()) &&
            session.runId === runId &&
            !session.commandPending &&
            !['starting', 'ready', 'stopping'].includes(
              session.sessionStatus
            ) &&
            useAssistantStore.getState().phase === 'idle'
          )
        }
        if (!(await confirmCreationTerminalLeave(identity)) || !current())
          return
        await endCreationTerminalForLeave(identity)
        if (!current()) return
        const result = await commands.confirmCreationGitRestore(
          identity,
          preview.token
        )
        if (!owns()) return
        if (result.status === 'error') {
          setError(result.error)
          setPreview(null)
        } else {
          setSaved(true)
          setPreview(null)
          const synchronized = await useCreationFilesStore
            .getState()
            .synchronizeSaved(identity)
          if (!owns()) return
          if (synchronized) {
            setSaved(false)
            onRestored()
          } else setError(useCreationFilesStore.getState().error)
        }
      } else {
        const captured = useCreationFilesStore.getState().revision
        const result = await commands.previewCreationGitRestore(
          identity,
          commit
        )
        if (!owns()) return
        if (result.status === 'error') setError(result.error)
        else {
          setPreview(result.data)
          setPreviewRevision(captured)
        }
      }
    } catch (cause) {
      if (owns()) setError(creationTransportError(cause))
    } finally {
      pending.current = false
      onBusyChange?.(false)
      if (owns()) setBusy(false)
      releaseTerminal?.()
    }
  }
  return (
    <section
      className="grid gap-2 rounded border border-border p-2"
      aria-label={t('creation.history.restore')}
    >
      <p className="text-xs">{t('creation.history.restoreHint')}</p>
      {saved && <p className="text-xs">{t('creation.files.syncPending')}</p>}
      {blocked && !saved && (
        <p className="text-xs">{t('creation.history.restoreBlocked')}</p>
      )}
      {preview && (
        <>
          <p className="text-xs">{t('creation.history.restoreReview')}</p>
          <ul className="max-h-32 overflow-auto font-mono text-xs">
            {preview.paths.map(path => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          {revision !== previewRevision && (
            <p role="alert">{t('creation.git.stale')}</p>
          )}
        </>
      )}
      {error && (
        <CreationErrorNotice
          error={error}
          validationMessage={t('creation.history.restoreFailed')}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={
            busy ||
            (!saved &&
              (blocked || (preview !== null && revision !== previewRevision)))
          }
          onClick={() => void run(preview !== null)}
        >
          {t(
            saved
              ? 'creation.files.retrySync'
              : preview
                ? 'creation.history.restoreConfirm'
                : 'creation.history.restore'
          )}
        </Button>
        {preview && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setPreview(null)}
          >
            {t('creation.cancel')}
          </Button>
        )}
      </div>
    </section>
  )
}
