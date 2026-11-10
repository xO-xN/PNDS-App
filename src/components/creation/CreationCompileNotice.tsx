import { useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import i18n from '@/i18n/config'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import {
  hasCompileSource,
  selectCompileUnavailableReason,
  useCreationCompileStore,
} from '@/store/creation-compile-store'
import { useCreationCompileAvailability } from '@/hooks/use-creation-compile-availability'

function CompileAction({ identity }: { identity: string }) {
  const { t } = useTranslation()
  const reasonId = useId()
  const reason = useCreationCompileAvailability()
  const hasSource = useCreationStore(state => hasCompileSource(state.workspace))
  if (!hasSource) return null
  return (
    <>
      <button
        type="button"
        data-button="true"
        data-action="true"
        className="pnds-focus-ring disabled:opacity-50"
        disabled={!!reason}
        aria-describedby={reason ? reasonId : undefined}
        title={reason ?? t('creation.compile.scope')}
        onClick={() => {
          if (
            !useCreationStore.getState().active ||
            useCreationStore.getState().workspace?.project.identity !==
              identity ||
            selectCompileUnavailableReason()
          )
            return
          void useCreationCompileStore.getState().run()
        }}
      >
        {t('creation.compile.consoleAction')}
      </button>
      {reason && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
    </>
  )
}

/** A saved source change is a pending task, not an operation in progress. */
export function CreationCompileNotice() {
  const workspace = useCreationStore(state => state.workspace)
  const pending = useCreationFilesStore(state => state.pending.compile > 0)
  const noticeShown = useCreationCompileStore(state => state.pendingNoticeShown)
  const active = useCreationStore(state => state.active)
  const identity = workspace?.project.identity
  const editable = workspace?.project.source === 'folder'
  useEffect(() => {
    if (!identity || !active || !editable || !pending) return
    if (useCreationCompileStore.getState().pendingNoticeShown) return
    useCreationCompileStore.setState({ pendingNoticeShown: true })
    // The active compilation already presents its progress and any newer edits.
    if (useCreationCompileStore.getState().busy) return
    const id = `creation-compile-pending:${identity}`
    toast.info(i18n.t('creation.pendingCompile'), {
      id,
      duration: 8000,
      action: <CompileAction identity={identity} />,
    })
  }, [identity, active, editable, pending, noticeShown])
  useEffect(() => {
    if (identity && !pending)
      toast.dismiss(`creation-compile-pending:${identity}`)
  }, [identity, pending])
  return null
}
