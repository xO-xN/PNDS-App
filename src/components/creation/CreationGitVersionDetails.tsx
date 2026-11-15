import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import type {
  CreationError,
  GitVersion,
  GitVersionGraph,
} from '@/lib/tauri-bindings'
import './creation-version-details.css'

interface RenameTarget {
  commit: string
  expected: string
  name: string
}

interface NameEdit {
  commit: string
  expected: string
  original: string
  draft: string
}

function VersionName({
  version,
  editable,
  busy,
  error,
  onRename,
}: {
  version: GitVersion
  editable: boolean
  busy: boolean
  error: CreationError | null
  onRename: (target: RenameTarget) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [edit, setEdit] = useState<NameEdit | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const session = useRef<NameEdit | null>(null)
  const writing = useRef(false)
  const live = useRef(true)
  const input = useRef<HTMLInputElement>(null)
  const pencil = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const errorId = useId()
  const editing = edit !== null
  const title = version.message.split('\n')[0] ?? ''

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])

  const close = (restoreFocus: boolean) => {
    session.current = null
    setEdit(null)
    setFailed(false)
    if (restoreFocus) requestAnimationFrame(() => pencil.current?.focus())
  }
  const submit = async (restoreFocus = false) => {
    const current = session.current
    if (!current || writing.current || busy || !editable) return
    const name = current.draft.trim()
    if (!name || name === current.original) {
      close(restoreFocus)
      return
    }
    writing.current = true
    setSaving(true)
    setFailed(false)
    try {
      const saved = await onRename({
        commit: current.commit,
        expected: current.expected,
        name,
      })
      if (!live.current) return
      if (saved) close(restoreFocus)
      else setFailed(true)
    } catch {
      if (live.current) setFailed(true)
    } finally {
      writing.current = false
      if (live.current) setSaving(false)
    }
  }

  return (
    <div className="creation-version-name">
      <div className="creation-version-name-row">
        {edit ? (
          <input
            ref={input}
            className="creation-version-name-input pnds-focus-ring"
            value={edit.draft}
            maxLength={120}
            readOnly={busy || saving || !editable}
            aria-label={t('creation.versions.versionName')}
            aria-describedby={failed ? errorId : hintId}
            aria-invalid={failed || undefined}
            title={t('creation.versions.inlineRenameHint')}
            onChange={event => {
              const next = { ...edit, draft: event.target.value }
              session.current = next
              setEdit(next)
              setFailed(false)
            }}
            onBlur={() => {
              if (!failed) void submit()
            }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit(true)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                if (!writing.current) close(true)
              }
            }}
          />
        ) : (
          <>
            <strong
              className="creation-version-name-label"
              title={version.message}
            >
              {title}
            </strong>
            {editable && (
              <button
                ref={pencil}
                type="button"
                className="creation-version-rename pnds-focus-ring"
                aria-label={t('creation.versions.rename')}
                title={t('creation.versions.rename')}
                disabled={busy}
                onClick={() => {
                  const next = {
                    commit: version.id,
                    expected: version.message,
                    original: title,
                    draft: title,
                  }
                  session.current = next
                  setEdit(next)
                  setFailed(false)
                }}
              >
                <Pencil aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
      {edit && (
        <span id={hintId} className="sr-only">
          {t('creation.versions.inlineRenameHint')}
        </span>
      )}
      {edit && failed && (
        <p
          id={errorId}
          role="alert"
          tabIndex={0}
          className="creation-version-rename-error pnds-focus-ring"
        >
          {error ? (
            <>
              {t(`creation.error.${error.code}`)} <span>{error.detail}</span>
            </>
          ) : (
            t('creation.versions.feedback.failed')
          )}
        </p>
      )}
    </div>
  )
}

export function CreationGitVersionDetails({
  version,
  graph,
  branch,
  working,
  editable,
  busy,
  error,
  onRename,
  children,
}: {
  version: GitVersion | null
  graph: GitVersionGraph | null
  branch: string | null
  working: boolean
  editable: boolean
  busy: boolean
  error: CreationError | null
  onRename: (target: RenameTarget) => Promise<boolean>
  children: ReactNode
}) {
  const { t } = useTranslation()
  const parents = version?.parents.map(id => {
    const parent = graph?.versions.find(item => item.id === id)
    return parent ? parent.message.split('\n')[0] || id : id
  })
  const facts: [string, string][] = version
    ? [
        [
          'creation.versions.targetRoute',
          branch ?? t('creation.git.historicalPosition'),
        ],
        ['creation.versions.author', version.author || '—'],
        ['creation.versions.identifier', version.id],
        [
          'creation.versions.parent',
          parents?.join(', ') || t('creation.versions.noParent'),
        ],
      ]
    : []
  return (
    <aside
      className="creation-version-details"
      aria-label={t('creation.versions.inspector')}
    >
      {working || !version ? (
        <strong className="creation-version-name-label">
          {t(
            working
              ? 'creation.versions.working'
              : 'creation.versions.noVersions'
          )}
        </strong>
      ) : (
        <VersionName
          key={version.id}
          version={version}
          editable={editable}
          busy={busy}
          error={error}
          onRename={onRename}
        />
      )}
      <div className="creation-version-main-action">{children}</div>
      {!working && version && (
        <dl className="creation-version-metadata">
          {facts.map(([key, value]) => (
            <Fragment key={key}>
              <dt>{t(key)}</dt>
              <dd title={value}>
                {key === 'creation.versions.identifier'
                  ? value.slice(0, 8)
                  : value}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </aside>
  )
}
