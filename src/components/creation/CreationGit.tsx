import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  commands,
  type CreationError,
  type CreationGitStatus,
  type CreationGitDiff,
  type GitDiffLayer,
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
import { CreationErrorNotice } from './CreationErrorNotice'

/** A local inspection snapshot. Draft editing and runtime actions remain owned
 * by their existing workflows; this surface only issues the two Git reads. */
export function CreationGit({
  identity,
  onClose,
}: {
  identity: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [refresh, setRefresh] = useState(0)
  const [status, setStatus] = useState<CreationGitStatus | null>(null)
  const [diff, setDiff] = useState<CreationGitDiff | null>(null)
  const [selected, setSelected] = useState<{
    path: string
    layer: GitDiffLayer
  } | null>(null)
  const [reading, setReading] = useState(true)
  const [diffReading, setDiffReading] = useState(false)
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const [externalStale, setExternalStale] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const request = useRef({ sequence: 0 })
  const revision = useCreationFilesStore(state => state.revision)
  const drafts = useCreationFilesStore(selectDirtyPathKey)
    .split('\n')
    .filter(Boolean).length
  const project = useCreationStore(state => state.workspace?.project)
  const runtimeRoot = useCreationStore(state => state.runtimeProject?.root)
  const runtimePath = useCreationStore(state => state.runtimeProject?.path)
  const running = useSessionStore(
    state =>
      state.sessionStatus === 'ready' &&
      (state.sessionProjectPath === project?.root ||
        (runtimeRoot === project?.root &&
          state.sessionProjectPath === runtimePath))
  )
  const stale =
    status !== null && (externalStale || revision !== snapshotRevision)
  const owns = (captured: number) =>
    request.current.sequence === captured &&
    useCreationStore.getState().workspace?.project.identity === identity
  useEffect(() => {
    const captured = ++request.current.sequence
    const owner = request.current
    const diskRevision = useCreationFilesStore.getState().revision
    const current = () =>
      request.current.sequence === captured &&
      useCreationStore.getState().workspace?.project.identity === identity
    void commands
      .getCreationGitStatus(identity)
      .then(result => {
        if (!current()) return
        if (result.status === 'ok') {
          setStatus(result.data)
          setSnapshotRevision(diskRevision)
        } else setError(result.error)
        setReading(false)
      })
      .catch(cause => {
        if (current()) {
          setError(creationTransportError(cause))
          setReading(false)
        }
      })
    return () => {
      owner.sequence++
    }
  }, [identity, refresh])
  useEffect(() => {
    const markStale = () => setExternalStale(true)
    const timer = setTimeout(markStale, 30000)
    window.addEventListener('focus', markStale)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', markStale)
    }
  }, [refresh])
  const reload = () => {
    request.current.sequence++
    setStatus(null)
    setDiff(null)
    setSelected(null)
    setError(null)
    setExternalStale(false)
    setReading(true)
    setDiffReading(false)
    setRefresh(value => value + 1)
  }
  const showDiff = async (path: string, layer: GitDiffLayer) => {
    const captured = ++request.current.sequence
    setSelected({ path, layer })
    setDiff(null)
    setDiffReading(true)
    setError(null)
    try {
      const result = await commands.readCreationGitDiff(identity, path, layer)
      if (!owns(captured)) return
      if (result.status === 'ok') setDiff(result.data)
      else setError(result.error)
    } catch (cause) {
      if (owns(captured)) setError(creationTransportError(cause))
    } finally {
      if (owns(captured)) setDiffReading(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (
            useCreationStore.getState().workspace?.project.identity === identity
          )
            document
              .querySelector<HTMLButtonElement>(
                '[data-creation-topbar] button[aria-haspopup="menu"]'
              )
              ?.focus()
        }}
        showCloseButton={false}
        className="flex max-h-[85vh] flex-col overflow-hidden text-start sm:max-w-3xl"
      >
        <DialogTitle>{t('creation.git.action')}</DialogTitle>
        <DialogDescription>{t('creation.git.scope')}</DialogDescription>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>{t('creation.git.drafts', { count: drafts })}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={reading}
            onClick={reload}
          >
            {t('creation.git.refresh')}
          </Button>
        </div>
        <p className="text-xs">{t('creation.git.diskHint')}</p>
        <p className="text-xs">
          {t(running ? 'creation.git.running' : 'creation.git.notRunning')}
        </p>
        {error && <CreationErrorNotice error={error} />}
        <div role="status" aria-atomic="true" className="text-xs">
          {reading && <p>{t('creation.git.loading')}</p>}
          {stale && <p>{t('creation.git.stale')}</p>}
          {status && status.state !== 'available' && (
            <p>{t(`creation.git.state.${status.state}`)}</p>
          )}
        </div>
        {status?.detail && (
          <p className="max-h-24 overflow-auto text-xs break-all">
            {status.detail}
          </p>
        )}
        {status?.state === 'available' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt>{t('creation.git.branch')}</dt>
              <dd>{status.branch ?? t('creation.git.detached')}</dd>
              <dt>{t('creation.git.head')}</dt>
              <dd className="break-all font-mono">
                {status.head ?? t('creation.git.unborn')}
              </dd>
            </dl>
            {status.changes.length === 0 && (
              <p className="text-sm">{t('creation.git.clean')}</p>
            )}
            <ul className="space-y-2">
              {status.changes.map(change => (
                <li
                  key={change.path}
                  className="rounded border border-(--pnds-border) p-2 text-xs"
                >
                  <p className="mb-2 break-all font-mono">{change.path}</p>
                  <div className="flex flex-wrap gap-2">
                    {(['staged', 'unstaged', 'untracked'] as const)
                      .filter(layer => change[layer])
                      .map(layer => (
                        <Button
                          key={layer}
                          size="sm"
                          variant="outline"
                          disabled={reading || stale}
                          aria-label={`${change.path} — ${t(`creation.git.layer.${layer}`)}`}
                          aria-pressed={
                            selected?.path === change.path &&
                            selected.layer === layer
                          }
                          onClick={() => void showDiff(change.path, layer)}
                        >
                          {t(`creation.git.layer.${layer}`)}
                        </Button>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
            {selected && (
              <section aria-label={t('creation.git.diff')} className="min-h-0">
                <h3 className="mb-2 text-xs font-semibold break-all">
                  {selected.path} · {t(`creation.git.layer.${selected.layer}`)}
                </h3>
                {diffReading && (
                  <p role="status" className="text-xs">
                    {t('creation.git.loadingDiff')}
                  </p>
                )}
                {diff && diff.state !== 'text' && (
                  <p role="status" className="text-xs">
                    {t(`creation.git.diffState.${diff.state}`)}
                  </p>
                )}
                {diff?.detail && (
                  <p className="text-xs break-all">{diff.detail}</p>
                )}
                {diff?.text !== null && diff?.text !== undefined && (
                  <pre
                    tabIndex={0}
                    aria-label={t('creation.git.diff')}
                    className="pnds-focus-ring max-h-72 overflow-auto rounded border border-(--pnds-border) p-3 text-xs"
                  >
                    {diff.text}
                  </pre>
                )}
              </section>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('creation.git.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
