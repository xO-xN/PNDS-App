import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import {
  commands,
  type CreationContent,
  type CreationError,
  type CreationFile,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  isDraftDirty,
  beginCreationFileOperation,
  useCreationDraftsStore,
} from '@/store/creation-drafts-store'
import { useCreationChangesStore } from '@/store/creation-changes-store'
import {
  useCreationCompileStore,
  selectCompileDraftPaths,
} from '@/store/creation-compile-store'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationManifestForm } from './CreationManifestForm'
import { CreationReadme } from './CreationReadme'
import {
  inspectEditableReadme,
  isProjectReadme,
  resolveCreationReadme,
  projectReadmeLocale,
} from '@/lib/creation-readme'

/**
 * #154: the reading workspace's file panel. Editable folder projects get a
 * lightweight draft editor (save ⌘S, rename, version-checked writes);
 * read-only sources keep the plain reader. #158: manifest.json edits
 * through a declaration form that shares the same draft and conflict flow.
 */
export function CreationFileEditor({
  identity,
  file,
  editable,
}: {
  identity: string
  file: CreationFile
  editable: boolean
}) {
  const { t, i18n } = useTranslation()
  const draft = useCreationDraftsStore(state => state.drafts[file.path])
  const compileBusy = useCreationCompileStore(state => state.busy)
  const compileDraftPaths = useCreationDraftsStore(selectCompileDraftPaths)
  const runtimeBusy = useSessionStore(
    state =>
      state.commandPending ||
      ['starting', 'stopping'].includes(state.sessionStatus)
  )
  const isScd = editable && file.path.endsWith('.scd')
  const compileReason = compileDraftPaths
    ? t('creation.compile.unsaved', { paths: compileDraftPaths })
    : runtimeBusy
      ? t('creation.compile.runtimeBusy')
      : null
  const renameNote = useCreationDraftsStore(state => state.renameNote)
  const [manifestView, setManifestView] = useState<'form' | 'text'>('form')
  const [readmeView, setReadmeView] = useState<'preview' | 'text'>('preview')
  const workspace = useCreationStore(state => state.workspace)
  const readmeLocale =
    useCreationDraftsStore(state => state.readmeLocale) ??
    i18n.resolvedLanguage ??
    'en'
  const [content, setContent] = useState<CreationContent | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [start, setStart] = useState(0)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<CreationError | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const match = useRef<HTMLElement>(null)
  const editableText = editable && file.kind === 'text'
  const isManifest = editableText && file.path === 'manifest.json'
  const diskRevision = useCreationChangesStore(
    state => state.fileRevisions[file.path] ?? 0
  )
  useEffect(() => {
    if (editableText && file.path in useCreationDraftsStore.getState().drafts)
      return
    let live = true
    const ownsOperation = beginCreationFileOperation(file.path)
    void commands
      .readCreationFile(identity, file.path)
      .then(result => {
        if (!live || !ownsOperation()) return
        // A late read may only seed drafts while this workspace is shown.
        if (
          editableText &&
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        if (result.status === 'error') {
          setError(result.error)
          return
        }
        setError(null)
        setImageFailed(false)
        if (editableText) {
          if (result.data.kind === 'text')
            useCreationDraftsStore
              .getState()
              .loaded(file.path, result.data.text, result.data.version)
          else setContent(result.data)
        } else setContent(result.data)
      })
      .catch(transport => {
        if (live && ownsOperation()) setError(creationTransportError(transport))
      })
    return () => {
      live = false
    }
  }, [identity, file.path, editableText, diskRevision])
  const text = editableText
    ? (draft?.text ?? '')
    : content?.kind === 'text'
      ? content.text
      : ''
  const isReadme = file.kind === 'text' && isProjectReadme(file.path)
  const readmeDocument = draft?.readme ?? inspectEditableReadme(text)
  const unsafeReadme = isReadme && readmeDocument.kind === 'unsafe'
  const index = query
    ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase(), start)
    : -1
  useEffect(() => {
    if (!editableText) match.current?.scrollIntoView({ block: 'center' })
  }, [index, query, editableText])
  const reveal = async () => {
    try {
      const result = await commands.revealCreationPath(identity, file.path)
      if (result.status === 'error') setError(result.error)
    } catch (transport) {
      setError(creationTransportError(transport))
    }
  }
  // The choice opens on arrival and after every refused overwrite — the
  // store re-arms it whenever the conflict version moves past the one the
  // user explicitly dismissed (⌘S included).
  const dismissedConflict = useCreationDraftsStore(
    state => state.dismissedConflict
  )
  const conflictOpen =
    !!draft?.conflict &&
    (dismissedConflict?.path !== file.path ||
      dismissedConflict.version !== draft.conflict.version)
  const dirty = draft ? isDraftDirty(draft) : false
  const saveCurrent = () => {
    if (!draft || !dirty || draft.saving) return
    void useCreationDraftsStore.getState().save(file.path)
  }
  const openRename = () => {
    setRenameValue(file.path)
    setRenameError(null)
    setRenameOpen(true)
  }
  const submitRename = async () => {
    const next = renameValue.trim()
    if (!next || next === file.path) {
      setRenameOpen(false)
      return
    }
    setRenameBusy(true)
    setRenameError(null)
    const failure = await useCreationDraftsStore
      .getState()
      .rename(file.path, next)
    setRenameBusy(false)
    if (failure) setRenameError(failure)
    else setRenameOpen(false)
  }
  const statusLabel = draft
    ? draft.saving
      ? t('creation.saving')
      : draft.conflict || draft.diskChanged
        ? t('creation.diskChanged')
        : dirty
          ? t('creation.unsaved')
          : t('creation.saved')
    : t('creation.saved')
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={file.path}>
      <header className="space-y-3 border-b border-(--pnds-text)/15 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="break-all font-medium">{file.path}</h2>
          {dirty && (
            <span
              aria-label={t('creation.unsaved')}
              title={t('creation.unsaved')}
              className="creation-dirty-dot"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isReadme && (
            <>
              <label className="flex items-center gap-2 text-sm">
                {t('creation.readme.language')}
                <select
                  className="pnds-focus-ring rounded border bg-(--pnds-card) p-1"
                  value={projectReadmeLocale(file.path) ?? readmeLocale}
                  onChange={event => {
                    useCreationDraftsStore
                      .getState()
                      .setReadmeLocale(event.target.value)
                    const next = resolveCreationReadme(
                      workspace?.files.map(file => file.path) ?? [],
                      event.target.value
                    )
                    if (next)
                      useCreationDraftsStore.getState().setActivePath(next)
                  }}
                >
                  <option value="en">English</option>
                  <option value="zh-CN">简体中文</option>
                </select>
              </label>
              <p className="text-xs">
                {t('creation.readme.resolvedFile', { path: file.path })}
              </p>
              {editableText && !unsafeReadme && (
                <div
                  role="group"
                  aria-label={t('creation.readme.view')}
                  className="flex gap-1"
                >
                  <Button
                    size="sm"
                    variant={readmeView === 'preview' ? 'default' : 'outline'}
                    onClick={() => setReadmeView('preview')}
                  >
                    {t('creation.readme.viewPreview')}
                  </Button>
                  {readmeDocument.kind === 'document' && (
                    <Button
                      size="sm"
                      variant={readmeView === 'text' ? 'default' : 'outline'}
                      onClick={() => setReadmeView('text')}
                    >
                      {t('creation.readme.viewText')}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
          {isManifest && (
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label={t('creation.manifest.viewLabel')}
            >
              <Button
                size="sm"
                variant={manifestView === 'form' ? 'default' : 'outline'}
                onClick={() => setManifestView('form')}
              >
                {t('creation.manifest.viewForm')}
              </Button>
              <Button
                size="sm"
                variant={manifestView === 'text' ? 'default' : 'outline'}
                onClick={() => setManifestView('text')}
              >
                {t('creation.manifest.viewText')}
              </Button>
            </div>
          )}
          <p className="text-sm">
            {t('creation.fileInfo', {
              type: file.path.split('.').pop()?.toUpperCase() ?? file.kind,
              size: file.size,
            })}
          </p>
          {editableText && (
            <>
              <Button
                size="sm"
                disabled={!dirty || draft?.saving || unsafeReadme}
                onClick={saveCurrent}
              >
                {t('creation.save')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={dirty || draft?.saving}
                title={t('creation.reloadHint')}
                onClick={() =>
                  void useCreationDraftsStore.getState().reload(file.path)
                }
              >
                {t('creation.conflictReload')}
              </Button>
            </>
          )}
          {isScd && (
            <Button
              size="sm"
              variant="outline"
              disabled={compileBusy || !!compileReason || !draft}
              title={compileReason ?? t('creation.compile.scope')}
              onClick={() => void useCreationCompileStore.getState().run()}
            >
              {compileBusy
                ? t('creation.compile.busy')
                : t('creation.compile.action')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void reveal()}>
            {t('creation.revealFile')}
          </Button>
          {editable && (
            <Button
              size="sm"
              variant="outline"
              disabled={file.path === 'manifest.json'}
              onClick={openRename}
            >
              <Pencil aria-hidden="true" />
              {t('creation.rename')}
            </Button>
          )}
        </div>
        {!editable && <p className="text-xs">{t('creation.readOnly')}</p>}
        {isScd && (
          <p role="status" className="text-xs">
            {compileReason ?? t('creation.compile.scope')}
          </p>
        )}
        {editableText && dirty && (
          <p className="text-xs">{t('creation.draftHint')}</p>
        )}
        {file.kind === 'text' &&
          (!isManifest || manifestView === 'text') &&
          (!isReadme || (readmeView === 'text' && !unsafeReadme)) && (
            <div className="flex items-center gap-2">
              <Input
                aria-label={t('creation.findText')}
                placeholder={t('creation.findText')}
                value={query}
                onChange={event => {
                  setQuery(event.target.value)
                  setStart(0)
                }}
              />
              <Button
                variant="outline"
                disabled={!query || index < 0}
                onClick={() => {
                  const next = index + query.length
                  setStart(
                    text
                      .toLocaleLowerCase()
                      .indexOf(query.toLocaleLowerCase(), next) < 0
                      ? 0
                      : next
                  )
                  if (editableText) {
                    editorRef.current?.focus()
                    editorRef.current?.setSelectionRange(
                      index,
                      index + query.length
                    )
                  }
                }}
              >
                {t('creation.nextMatch')}
              </Button>
              {query && index < 0 && (
                <span role="status">{t('creation.noMatch')}</span>
              )}
            </div>
          )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {(error || draft?.error) && (
          <CreationErrorNotice
            error={(error ?? draft?.error) as CreationError}
          />
        )}
        {draft?.error && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              useCreationDraftsStore.getState().dismissError(file.path)
            }
          >
            {t('creation.dismissError')}
          </Button>
        )}
        {!content && !draft && !error && (
          <p role="status">{t('creation.loading')}</p>
        )}
        {isReadme &&
        (draft || content?.kind === 'text') &&
        (readmeView === 'preview' || unsafeReadme || !editableText) ? (
          <CreationReadme
            text={text}
            root={workspace?.project.root ?? ''}
            document={draft?.readme}
            editable={editableText}
            onChange={(field, value) =>
              useCreationDraftsStore
                .getState()
                .editReadme(file.path, field, value)
            }
          />
        ) : editableText ? (
          draft ? (
            isManifest && manifestView === 'form' ? (
              <CreationManifestForm
                text={draft.text}
                onChange={next =>
                  useCreationDraftsStore.getState().edit(file.path, next)
                }
              />
            ) : (
              <textarea
                ref={editorRef}
                dir="ltr"
                className="creation-editor-textarea"
                aria-label={file.path}
                value={draft.text}
                spellCheck={false}
                onChange={event =>
                  useCreationDraftsStore
                    .getState()
                    .edit(file.path, event.target.value)
                }
              />
            )
          ) : null
        ) : content?.kind === 'text' ? (
          <pre
            dir="ltr"
            className="select-text whitespace-pre-wrap break-words font-mono text-sm leading-6"
          >
            {index < 0 ? (
              text
            ) : (
              <>
                {text.slice(0, index)}
                <mark
                  ref={match}
                  className="bg-(--pnds-accent) text-(--pnds-accent-foreground)"
                >
                  {text.slice(index, index + query.length)}
                </mark>
                {text.slice(index + query.length)}
              </>
            )}
          </pre>
        ) : content?.kind === 'image' && !imageFailed ? (
          <img
            className="mx-auto max-h-full max-w-full object-contain"
            src={content.url}
            alt={file.path}
            onError={() => setImageFailed(true)}
          />
        ) : imageFailed ? (
          <p role="status">{t('creation.imageFailed')}</p>
        ) : content?.kind === 'binary' ? (
          <p>{t('creation.binaryHint')}</p>
        ) : null}
      </div>
      <footer className="creation-editor-status">
        <span
          data-state={draft?.conflict ? 'conflict' : dirty ? 'dirty' : 'clean'}
        >
          {statusLabel}
        </span>
        <span>UTF-8</span>
        {renameNote === file.path && (
          <span role="status" className="creation-rename-note">
            {t('creation.renamed')} {t('creation.renameHint')}
          </span>
        )}
      </footer>
      <Dialog
        open={conflictOpen}
        onOpenChange={open => {
          if (!open)
            useCreationDraftsStore.getState().dismissConflict(file.path)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('creation.conflictTitle')}</DialogTitle>
            <DialogDescription>
              {t('creation.conflictBody', { path: file.path })}
            </DialogDescription>
          </DialogHeader>
          {draft?.conflict && (
            <pre
              dir="ltr"
              aria-label={t('creation.conflictPreview')}
              className="creation-conflict-preview"
            >
              {draft.conflict.text}
            </pre>
          )}
          <p className="text-xs">{t('creation.conflictReloadNote')}</p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                useCreationDraftsStore.getState().dismissConflict(file.path)
              }
            >
              {t('creation.cancel')}
            </Button>
            <Button
              variant="outline"
              disabled={draft?.saving}
              onClick={() =>
                useCreationDraftsStore.getState().revert(file.path)
              }
            >
              {t('creation.conflictReload')}
            </Button>
            <Button
              disabled={!draft?.conflict || draft?.saving}
              onClick={() => {
                const version = draft?.conflict?.version
                if (!version) return
                void useCreationDraftsStore.getState().save(file.path, version)
              }}
            >
              {t('creation.conflictOverwrite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('creation.renameTitle')}</DialogTitle>
            <DialogDescription>{t('creation.renameHint')}</DialogDescription>
          </DialogHeader>
          <Input
            aria-label={t('creation.renamePathLabel')}
            value={renameValue}
            spellCheck={false}
            onChange={event => setRenameValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !renameBusy) void submitRename()
            }}
          />
          {renameError && <CreationErrorNotice error={renameError} />}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={renameBusy}
              onClick={() => setRenameOpen(false)}
            >
              {t('creation.cancel')}
            </Button>
            <Button
              disabled={renameBusy || !renameValue.trim()}
              onClick={() => void submitRename()}
            >
              {t('creation.rename')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
