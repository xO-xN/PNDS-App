import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  commands,
  type CreationError,
  type GitHistory,
  type GitHistoryFile,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  isDraftDirty,
  useCreationFilesStore,
  type CreationDraft,
} from '@/store/creation-files-store'
import { openCreationFileAtLine } from '@/lib/creation-editor-navigation'
import { TextDifference } from './CreationFileChangeControls'
import { CreationErrorNotice } from './CreationErrorNotice'

export function CreationGitHistory({
  identity,
  onBack,
  onLoaded,
}: {
  identity: string
  onBack: () => void
  onLoaded: () => void
}) {
  const { t, i18n } = useTranslation()
  const [history, setHistory] = useState<GitHistory | null>(null)
  const [commit, setCommit] = useState<string | null>(null)
  const [file, setFile] = useState<GitHistoryFile | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileReading, setFileReading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    source: GitHistoryFile
    draft: CreationDraft | undefined
  } | null>(null)
  const sequence = useRef({ value: 0 })
  const writing = useRef(false)
  const draft = useCreationFilesStore(state =>
    file ? state.drafts[file.path] : undefined
  )
  const owns = (request: number) =>
    sequence.current.value === request &&
    useCreationStore.getState().workspace?.project.identity === identity
  useEffect(() => {
    const owner = sequence.current
    const request = ++owner.value
    let cancelled = false
    void commands
      .getCreationGitHistory(identity)
      .then(result => {
        if (
          cancelled ||
          sequence.current.value !== request ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        if (result.status === 'ok') setHistory(result.data)
        else setError(result.error)
      })
      .catch(cause => {
        if (!cancelled && sequence.current.value === request)
          setError(creationTransportError(cause))
      })
    return () => {
      cancelled = true
      owner.value++
    }
  }, [identity, refresh])
  const showFile = async (selected: string, path: string) => {
    const request = ++sequence.current.value
    setFile(null)
    setConfirmation(null)
    setError(null)
    setLoaded(false)
    setFileReading(true)
    try {
      const result = await commands.readCreationGitHistoryFile(
        identity,
        selected,
        path
      )
      if (!owns(request)) return
      if (result.status === 'ok') setFile(result.data)
      else setError(result.error)
    } catch (cause) {
      if (owns(request)) setError(creationTransportError(cause))
    } finally {
      if (owns(request)) setFileReading(false)
    }
  }
  const load = async () => {
    if (!confirmation || writing.current) return
    const request = sequence.current.value
    writing.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await useCreationFilesStore
        .getState()
        .loadHistory(identity, confirmation.source, confirmation.draft, () =>
          owns(request)
        )
      if (!owns(request)) return
      if (result) setError(result)
      else {
        setLoaded(true)
        setConfirmation(null)
      }
    } finally {
      writing.current = false
      if (owns(request)) setBusy(false)
    }
  }
  const reload = () => {
    sequence.current.value++
    setHistory(null)
    setCommit(null)
    setFile(null)
    setConfirmation(null)
    setError(null)
    setLoaded(false)
    setRefresh(value => value + 1)
  }
  return (
    <section
      className="grid gap-3 text-sm"
      aria-label={t('creation.history.action')}
      aria-busy={(!history && !error) || fileReading || busy}
    >
      <p className="text-xs">{t('creation.history.limit')}</p>
      {history?.limited && (
        <p role="status" className="text-xs">
          {t('creation.history.more')}
        </p>
      )}
      {error && <CreationErrorNotice error={error} />}
      {!history && !error && <p role="status">{t('creation.git.loading')}</p>}
      {history?.commits.length === 0 && (
        <p role="status">{t('creation.history.empty')}</p>
      )}
      <ul className="grid gap-2">
        {history?.commits.map(item => (
          <li key={item.id} className="rounded border border-border p-3">
            <Button
              className="h-auto max-w-full whitespace-pre-wrap text-start break-words"
              variant="outline"
              aria-pressed={commit === item.id}
              aria-label={`${item.message} — ${item.id}`}
              disabled={busy}
              onClick={() => {
                sequence.current.value++
                setCommit(item.id)
                setFile(null)
                setConfirmation(null)
                setLoaded(false)
                setFileReading(false)
              }}
            >
              {item.message}
            </Button>
            <p className="mt-2 break-all font-mono text-xs">{item.id}</p>
            <p className="text-xs">
              {item.author} &lt;{item.email}&gt; ·{' '}
              {new Date(item.timestamp * 1000).toLocaleString(
                i18n.resolvedLanguage
              )}
            </p>
            {commit === item.id && (
              <ul className="mt-2 grid gap-2">
                {item.files.map(path => (
                  <li key={path}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto max-w-full whitespace-normal text-start break-all"
                      disabled={busy}
                      aria-label={`${path} — ${t('creation.history.view')}`}
                      onClick={() => void showFile(item.id, path)}
                    >
                      {path}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {fileReading && <p role="status">{t('creation.git.loadingDiff')}</p>}
      {file && (
        <section className="grid gap-3 rounded border border-border p-3">
          <h3 className="break-all font-mono">
            {file.path} · {file.commit}
          </h3>
          <p className="text-xs">
            {t('creation.history.size', { size: file.historicalSize })}
          </p>
          {file.reason && (
            <p role="status">{t(`creation.history.reason.${file.reason}`)}</p>
          )}
          {file.historicalText !== null && (
            <details open>
              <summary>{t('creation.history.selected')}</summary>
              <pre
                tabIndex={0}
                className="pnds-focus-ring mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-3 text-xs"
              >
                {file.historicalText}
              </pre>
            </details>
          )}
          {file.savedText !== null && (
            <details>
              <summary>{t('creation.history.saved')}</summary>
              <pre
                tabIndex={0}
                className="pnds-focus-ring mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words p-3 text-xs"
              >
                {file.savedText}
              </pre>
            </details>
          )}
          {file.historicalText !== null && file.savedText !== null && (
            <div>
              <h4>{t('creation.history.compareSaved')}</h4>
              <TextDifference
                before={file.historicalText}
                after={file.savedText}
              />
            </div>
          )}
          {draft && (
            <details>
              <summary>{t('creation.history.draft')}</summary>
              <TextDifference
                before={file.savedText ?? ''}
                after={draft.text}
              />
            </details>
          )}
          {file.loadable && !loaded && !confirmation && (
            <Button
              disabled={busy}
              onClick={() =>
                setConfirmation({
                  source: file,
                  draft: useCreationFilesStore.getState().drafts[file.path],
                })
              }
            >
              {t('creation.history.review')}
            </Button>
          )}
          {confirmation && (
            <div className="grid gap-2 rounded border border-border p-3">
              <p>{t('creation.history.scope')}</p>
              <p className="break-all font-mono">
                {confirmation.source.path} · {confirmation.source.commit}
              </p>
              {confirmation.draft && isDraftDirty(confirmation.draft) && (
                <>
                  <p>{t('creation.history.replaceHint')}</p>
                  <TextDifference
                    before={confirmation.draft.text}
                    after={confirmation.source.historicalText ?? ''}
                  />
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void load()}>
                  {t(
                    confirmation.draft && isDraftDirty(confirmation.draft)
                      ? 'creation.history.replace'
                      : 'creation.history.confirm'
                  )}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => setConfirmation(null)}
                >
                  {t('creation.history.keep')}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => setConfirmation(null)}
                >
                  {t('creation.history.cancel')}
                </Button>
              </div>
            </div>
          )}
          {loaded && (
            <div role="status" className="grid gap-2">
              <p>{t('creation.history.loaded')}</p>
              <Button
                onClick={() => {
                  if (openCreationFileAtLine(identity, file.path, 1)) onLoaded()
                  else
                    setError({
                      code: 'missing',
                      detail: t('creation.history.changed'),
                    })
                }}
              >
                {t('creation.history.open')}
              </Button>
            </div>
          )}
        </section>
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
