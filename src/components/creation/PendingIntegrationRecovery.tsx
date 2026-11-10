import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { commands, type PendingIntegrationReceipt } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import {
  pendingDraftDirty,
  useCreationPendingStore,
} from '@/store/creation-pending-store'
import { useAssistantStore } from '@/store/assistant-store'

/** The native receipt is independent of conversation and retired task journals. */
export function PendingIntegrationRecovery({
  identity,
  disabled,
}: {
  identity: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const phase = useAssistantStore(state => state.phase)
  const waiting = useAssistantStore(state => !!state.resourceApproval)
  const documents = useCreationPendingStore(state => state.documents)
  const documentVersions = documents
    .map(document => `${document.id}:${document.version}`)
    .join(',')
  const [loaded, setLoaded] = useState<{
    identity: string
    receipt: PendingIntegrationReceipt | null
  } | null>(null)
  const [feedback, setFeedback] = useState<{
    identity: string
    key: string
    error: boolean
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const receipt = loaded?.identity === identity ? loaded.receipt : null
  const currentFeedback = feedback?.identity === identity ? feedback : null
  const blocked = disabled || phase !== 'idle' || waiting || busy === identity
  const owns = () =>
    useCreationStore.getState().workspace?.project.identity === identity
  useEffect(() => {
    if (phase !== 'idle') return
    let current = true
    void commands
      .getCreationPendingIntegration(identity)
      .then(result => {
        if (
          !current ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        if (result.status === 'ok')
          setLoaded({ identity, receipt: result.data })
        else setFeedback({ identity, key: 'loadError', error: true })
      })
      .catch(() => {
        if (
          current &&
          useCreationStore.getState().workspace?.project.identity === identity
        )
          setFeedback({ identity, key: 'loadError', error: true })
      })
    return () => {
      current = false
    }
  }, [identity, phase, documentVersions, revision])

  async function restore(originalsOnly: boolean) {
    if (!receipt || blocked || !owns()) return
    const files = useCreationFilesStore.getState()
    if (
      !originalsOnly &&
      receipt.targets.some(target =>
        Object.entries(files.drafts).some(
          ([path, draft]) =>
            (path === target.path || path.startsWith(`${target.path}/`)) &&
            isDraftDirty(draft)
        )
      )
    ) {
      setFeedback({ identity, key: 'draftConflict', error: true })
      return
    }
    const pending = useCreationPendingStore.getState()
    if (
      receipt.sources.some(
        source =>
          pending.drafts[source.id] &&
          pendingDraftDirty(pending.drafts[source.id])
      )
    ) {
      setFeedback({ identity, key: 'draftConflict', error: true })
      return
    }
    setBusy(identity)
    setFeedback(null)
    try {
      const result = await commands.restoreCreationPendingIntegration(
        identity,
        originalsOnly
      )
      if (!owns()) return
      if (result.status === 'error') {
        setFeedback({
          identity,
          key:
            result.error.code === 'versionConflict'
              ? 'newerConflict'
              : 'restoreError',
          error: true,
        })
        return
      }
      setLoaded({ identity, receipt: result.data })
      const projectSynced =
        originalsOnly || (await files.synchronizeSaved(identity))
      if (!owns()) return
      const pendingSynced = await pending.refresh()
      if (!owns()) return
      setFeedback({
        identity,
        key: projectSynced && pendingSynced ? 'restored' : 'syncPending',
        error: !(projectSynced && pendingSynced),
      })
    } catch {
      if (owns()) setFeedback({ identity, key: 'restoreError', error: true })
    } finally {
      if (owns()) setBusy(null)
    }
  }
  if (!receipt && !currentFeedback) return null
  return (
    <div className="creation-pending-recovery space-y-2 text-xs">
      {receipt && (
        <>
          <p className="font-medium">{t('creation.pending.recovery.title')}</p>
          <p className="text-muted-foreground">
            {t(
              `creation.pending.recovery.${receipt.verification === 'passed' ? 'verified' : 'unverified'}`
            )}
          </p>
          <details>
            <summary>{t('creation.pending.recovery.affected')}</summary>
            <ul>
              {receipt.sources.map(source => (
                <li key={source.id}>{source.name}</li>
              ))}
            </ul>
            <ul>
              {receipt.targets.map(target => (
                <li key={target.path}>
                  <bdi>{target.path}</bdi>
                </li>
              ))}
            </ul>
          </details>
          {!receipt.restored && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={blocked}
                onClick={() => void restore(false)}
              >
                {t('creation.pending.recovery.undo')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={blocked}
                onClick={() => void restore(true)}
              >
                {t('creation.pending.recovery.originals')}
              </Button>
            </div>
          )}
        </>
      )}
      {currentFeedback && (
        <p
          role={currentFeedback.error ? 'alert' : 'status'}
          className={
            currentFeedback.error ? 'text-destructive' : 'text-muted-foreground'
          }
        >
          {t(`creation.pending.recovery.${currentFeedback.key}`)}
        </p>
      )}
      {currentFeedback?.error && (
        <Button
          size="sm"
          variant="ghost"
          disabled={blocked}
          onClick={() => {
            setFeedback(null)
            setRevision(value => value + 1)
          }}
        >
          {t('creation.pending.recovery.retry')}
        </Button>
      )}
    </div>
  )
}
