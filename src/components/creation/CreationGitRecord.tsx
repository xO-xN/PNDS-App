import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  commands,
  type CreationGitDiff,
  type CreationError,
  type GitRecordPreview,
  type GitRecordReceipt,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useAssistantProposalStore } from '@/store/assistant-proposal-store'
import { useParameterPreviewStore } from '@/store/parameter-preview-store'
import { CreationErrorNotice } from './CreationErrorNotice'

export function CreationGitRecord({
  identity,
  onRecorded,
  onBack,
  onBusyChange,
}: {
  identity: string
  onRecorded: () => void
  onBack: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const [diffPath, setDiffPath] = useState<{
    path: string
    layer: 'unstaged' | 'untracked'
  } | null>(null)
  const [preview, setPreview] = useState<GitRecordPreview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<GitRecordReceipt | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const [refresh, setRefresh] = useState(0)
  const owner = useRef({ live: true, writing: false })
  const revision = useCreationFilesStore(state => state.revision)
  const [diskRevision, setDiskRevision] = useState(revision)
  const proposals = useAssistantProposalStore(
    state =>
      Object.values(state.items).filter(
        item =>
          item.identity === identity && item.candidate.text !== item.before
      ).length
  )
  const temporary = useParameterPreviewStore(
    state =>
      state.owner?.identity === identity &&
      state.status !== 'idle' &&
      state.status !== 'ended'
  )
  const root = useCreationStore(state => state.workspace?.project.root)
  const owns = () =>
    owner.current.live &&
    useCreationStore.getState().workspace?.project.identity === identity
  useEffect(() => {
    const currentOwner = owner.current
    currentOwner.live = true
    let cancelled = false
    const captured = useCreationFilesStore.getState().revision
    void commands
      .previewCreationGitRecord(identity)
      .then(result => {
        if (
          cancelled ||
          !currentOwner.live ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        if (result.status === 'error') setError(result.error)
        else {
          setPreview(result.data)
          setSelected(
            result.data.files
              .filter(file => file.defaultSelected)
              .map(file => file.path)
          )
          setName(result.data.name)
          setEmail(
            result.data.email === 'creator@pnds.local' ? '' : result.data.email
          )
          setMessage(
            previous =>
              previous || (result.data.initial ? 'Initial project' : '')
          )
          setDiskRevision(captured)
        }
      })
      .catch(cause => {
        if (!cancelled && currentOwner.live)
          setError(creationTransportError(cause))
      })
    return () => {
      cancelled = true
      currentOwner.live = false
    }
  }, [identity, refresh])
  const reload = () => {
    setDiffPath(null)
    setPreview(null)
    setReview(false)
    setError(null)
    setRefresh(value => value + 1)
  }
  const record = async () => {
    if (
      !preview ||
      owner.current.writing ||
      !owns() ||
      revision !== diskRevision
    )
      return
    owner.current.writing = true
    onBusyChange?.(true)
    setBusy(true)
    setError(null)
    try {
      const result = await commands.confirmCreationGitRecord(
        identity,
        preview.token,
        { paths: selected, name, email, message }
      )
      if (!owns()) return
      if (result.status === 'error') {
        setError(result.error)
        setPreview(null)
        setReview(false)
      } else {
        setReceipt(result.data)
        onRecorded()
      }
    } catch (cause) {
      if (owns()) setError(creationTransportError(cause))
    } finally {
      owner.current.writing = false
      onBusyChange?.(false)
      if (owns()) setBusy(false)
    }
  }
  if (receipt)
    return (
      <section className="grid gap-3 text-sm" role="status">
        <p>{t('creation.version.success')}</p>
        <code className="break-all">{receipt.commit}</code>
        <p className="whitespace-pre-wrap">{receipt.message}</p>
        <ul>
          {receipt.paths.map(path => (
            <li key={path} className="break-all font-mono">
              {path}
            </li>
          ))}
        </ul>
        {receipt.warning && <p role="alert">{receipt.warning}</p>}
        <p>{t('creation.version.resultScope')}</p>
        <Button variant="outline" onClick={onBack}>
          {t('creation.version.back')}
        </Button>
      </section>
    )
  return (
    <section
      aria-label={t(
        preview?.initial
          ? 'creation.version.initial'
          : 'creation.version.record'
      )}
      className="grid gap-3 text-sm"
      aria-busy={(!preview && !error) || busy}
    >
      <p className="break-all font-mono">{root}</p>
      <p className="text-xs">{t('creation.version.policy')}</p>
      <p className="text-xs">
        {t('creation.version.pending', {
          count: proposals,
          preview: t(
            temporary
              ? 'creation.version.previewActive'
              : 'creation.version.previewInactive'
          ),
        })}
      </p>
      {error && <CreationErrorNotice error={error} />}
      {!preview && !error && <p role="status">{t('creation.git.loading')}</p>}
      {preview && (
        <>
          <p className="break-all font-mono">
            {preview.branch ?? t('creation.git.detached')} ·{' '}
            {preview.head ?? t('creation.git.unborn')}
          </p>
          {revision !== diskRevision && (
            <p role="alert">{t('creation.git.stale')}</p>
          )}
          <fieldset disabled={busy || review} className="grid gap-3">
            <label className="grid gap-1">
              <span>{t('creation.version.name')}</span>
              <Input
                required
                value={name}
                maxLength={128}
                onChange={event => setName(event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span>{t('creation.version.email')}</span>
              <Input
                type="email"
                value={email}
                maxLength={254}
                onChange={event => setEmail(event.target.value)}
              />
            </label>
            <p className="text-xs">{t('creation.version.placeholder')}</p>
            <label className="grid gap-1">
              <span>{t('creation.version.message')}</span>
              <textarea
                className="creation-editor-textarea pnds-focus-ring min-h-20"
                value={message}
                maxLength={4096}
                onChange={event => setMessage(event.target.value)}
              />
            </label>
            <ul className="grid gap-2">
              {preview.files.map(file => (
                <li
                  key={file.path}
                  className="rounded border border-border p-2"
                >
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="pnds-focus-ring mt-1"
                      checked={selected.includes(file.path)}
                      disabled={
                        file.staged ||
                        (file.exclusion !== null &&
                          file.exclusion !== 'largeMedia')
                      }
                      onChange={event =>
                        setSelected(paths =>
                          event.target.checked
                            ? [...paths, file.path]
                            : paths.filter(path => path !== file.path)
                        )
                      }
                    />
                    <span className="min-w-0 break-all">
                      <span className="font-mono">{file.path}</span> ·{' '}
                      {t(`creation.version.status.${file.status}`)} ·{' '}
                      {(file.size / 1024 / 1024).toFixed(2)} MiB
                      {file.exclusion && (
                        <small className="block">
                          {t(`creation.version.exclusion.${file.exclusion}`)}
                        </small>
                      )}
                      {file.staged && (
                        <small className="block">
                          {t('creation.version.staged')}
                        </small>
                      )}
                    </span>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={file.staged}
                    aria-label={`${file.path} — ${t('creation.version.viewDiff')}`}
                    onClick={() =>
                      setDiffPath({
                        path: file.path,
                        layer:
                          file.status === 'added' ? 'untracked' : 'unstaged',
                      })
                    }
                  >
                    {t('creation.version.viewDiff')}
                  </Button>
                </li>
              ))}
            </ul>
          </fieldset>
          {diffPath && (
            <SavedGitDifference
              key={`${preview.token}:${diffPath.path}`}
              identity={identity}
              path={diffPath.path}
              layer={diffPath.layer}
            />
          )}
          {preview.files.length === 0 && <p>{t('creation.git.clean')}</p>}
          <p>
            {t('creation.version.growth', {
              size: (
                preview.files
                  .filter(file => selected.includes(file.path))
                  .reduce((total, file) => total + file.size, 0) /
                1024 /
                1024
              ).toFixed(2),
            })}
          </p>
          {review && (
            <div role="status" className="rounded border border-border p-3">
              <p>{t('creation.version.confirmHint')}</p>
              <p className="whitespace-pre-wrap">{message}</p>
              <p>
                {name} &lt;{email || 'creator@pnds.local'}&gt;
              </p>
              <ul>
                {selected.map(path => (
                  <li key={path} className="break-all font-mono">
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {review ? (
              <>
                <Button
                  disabled={busy || revision !== diskRevision}
                  onClick={() => void record()}
                >
                  {t('creation.version.confirm')}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => setReview(false)}
                >
                  {t('creation.version.edit')}
                </Button>
              </>
            ) : (
              <Button
                disabled={
                  !selected.length ||
                  !name.trim() ||
                  !message.trim() ||
                  revision !== diskRevision
                }
                onClick={() => setReview(true)}
              >
                {t('creation.version.review')}
              </Button>
            )}
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={reload}>
          {t('creation.git.refresh')}
        </Button>
        <Button variant="outline" disabled={busy} onClick={onBack}>
          {t('creation.version.back')}
        </Button>
      </div>
    </section>
  )
}

function SavedGitDifference({
  identity,
  path,
  layer,
}: {
  identity: string
  path: string
  layer: 'unstaged' | 'untracked'
}) {
  const { t } = useTranslation()
  const [result, setResult] = useState<CreationGitDiff | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  useEffect(() => {
    let cancelled = false
    void commands
      .readCreationGitDiff(identity, path, layer)
      .then(value => {
        if (
          cancelled ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        if (value.status === 'ok') setResult(value.data)
        else setError(value.error)
      })
      .catch(cause => {
        if (!cancelled) setError(creationTransportError(cause))
      })
    return () => {
      cancelled = true
    }
  }, [identity, path, layer])
  return (
    <section className="grid gap-2">
      <h3 className="break-all font-mono">{path}</h3>
      {error && <CreationErrorNotice error={error} />}
      <pre
        tabIndex={0}
        aria-label={t('creation.version.viewDiff')}
        className="pnds-focus-ring max-h-56 overflow-auto rounded border border-border p-3 text-xs"
      >
        {result?.text ??
          t(
            result
              ? `creation.git.diffState.${result.state}`
              : 'creation.git.loadingDiff'
          )}
      </pre>
    </section>
  )
}
