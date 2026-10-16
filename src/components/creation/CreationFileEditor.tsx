import { CreationFileChangeControls } from './CreationFileChangeControls'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, MoreHorizontal } from 'lucide-react'
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
  useCreationFilesStore,
} from '@/store/creation-files-store'
import {
  useCreationCompileStore,
  selectCompileDraftPaths,
} from '@/store/creation-compile-store'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationManifestForm } from './CreationManifestForm'
import { CreationReadme } from './CreationReadme'
const CreationCodeEditor = lazy(() => import('./CreationCodeEditor'))
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
  const draft = useCreationFilesStore(state => state.drafts[file.path])
  const compileBusy = useCreationCompileStore(state => state.busy)
  const compileDraftPaths = useCreationFilesStore(selectCompileDraftPaths)
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
  const renameNote = useCreationFilesStore(state => state.renameNote)
  const location = useCreationFilesStore(state =>
    state.location?.identity === identity && state.location.path === file.path
      ? state.location
      : null
  )
  const [manifestChoice, setManifestChoice] = useState<{
    location: typeof location
    view: 'form' | 'text'
  }>({ location: null, view: 'form' })
  const [readmeChoice, setReadmeChoice] = useState<{
    location: typeof location
    view: 'preview' | 'text'
  }>({ location: null, view: 'preview' })
  const manifestView =
    location && manifestChoice.location !== location
      ? 'text'
      : manifestChoice.view
  const readmeView =
    location && readmeChoice.location !== location ? 'text' : readmeChoice.view
  const setManifestView = (view: 'form' | 'text') =>
    setManifestChoice({ location, view })
  const setReadmeView = (view: 'preview' | 'text') =>
    setReadmeChoice({ location, view })
  const workspace = useCreationStore(state => state.workspace)
  const readmeLocale =
    useCreationFilesStore(state => state.readmeLocale) ??
    i18n.resolvedLanguage ??
    'en'
  const [content, setContent] = useState<CreationContent | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<CreationError | null>(null)
  const menuAction = useRef<(() => void) | null>(null)
  const editableText = editable && file.kind === 'text'
  const isManifest = editableText && file.path === 'manifest.json'
  const diskRevision = useCreationFilesStore(
    state => state.fileRevisions[file.path] ?? 0
  )
  useEffect(() => {
    let live = true
    void useCreationFilesStore
      .getState()
      .read(identity, file.path)
      .then(result => {
        if (!live || !result) return
        if (result.status === 'error') {
          setError(result.error)
          return
        }
        setError(null)
        setImageFailed(false)
        setContent(result.data)
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
  const dismissedConflict = useCreationFilesStore(
    state => state.dismissedConflict
  )
  const conflictOpen =
    !!draft?.conflict &&
    (dismissedConflict?.path !== file.path ||
      dismissedConflict.version !== draft.conflict.version)
  const dirty = draft ? isDraftDirty(draft) : false
  const saveCurrent = () => {
    if (!draft || !dirty || draft.saving) return
    void useCreationFilesStore.getState().save(file.path)
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
    const failure = await useCreationFilesStore
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
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={file.path}
    >
      <header className="desktop-file-header space-y-2 border-b border-(--pnds-border) p-3">
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
                <Select
                  value={projectReadmeLocale(file.path) ?? readmeLocale}
                  onValueChange={locale => {
                    useCreationFilesStore.getState().setReadmeLocale(locale)
                    const next = resolveCreationReadme(
                      workspace?.files.map(file => file.path) ?? [],
                      locale
                    )
                    if (next)
                      useCreationFilesStore.getState().setActivePath(next)
                  }}
                >
                  <SelectTrigger
                    aria-label={t('creation.readme.language')}
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="zh-CN">简体中文</SelectItem>
                  </SelectContent>
                </Select>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="creation-icon-button pnds-focus-ring"
                aria-label={t('desktop.fileActions')}
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={event => {
                const action = menuAction.current
                menuAction.current = null
                if (action) {
                  event.preventDefault()
                  action()
                }
              }}
            >
              {editableText && (
                <DropdownMenuItem
                  disabled={dirty || draft?.saving}
                  onSelect={() =>
                    void useCreationFilesStore.getState().reload(file.path)
                  }
                >
                  {t('creation.conflictReload')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => void reveal()}>
                {t('creation.revealFile')}
              </DropdownMenuItem>
              {editable && (
                <DropdownMenuItem
                  disabled={file.path === 'manifest.json'}
                  onSelect={() => {
                    menuAction.current = openRename
                  }}
                >
                  <Pencil aria-hidden="true" />
                  {t('creation.rename')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!editable && <p className="text-xs">{t('creation.readOnly')}</p>}
        {isScd && (
          <p role="status" className="text-xs">
            {compileReason ?? t('creation.compile.scope')}
          </p>
        )}
        {editableText && !unsafeReadme && (
          <CreationFileChangeControls
            key={`${identity}:${file.path}`}
            identity={identity}
            path={file.path}
          />
        )}
        {editableText && dirty && (
          <p className="text-xs">{t('creation.draftHint')}</p>
        )}
      </header>
      <div className="creation-file-content min-h-0 flex-1 overflow-auto p-4">
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
              useCreationFilesStore.getState().dismissError(file.path)
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
        !(location && readmeView === 'text') &&
        (readmeView === 'preview' || unsafeReadme || !editableText) ? (
          <CreationReadme
            text={text}
            root={workspace?.project.root ?? ''}
            document={draft?.readme}
            editable={editableText}
            onChange={(field, value) =>
              useCreationFilesStore
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
                  useCreationFilesStore.getState().edit(file.path, next)
                }
              />
            ) : (
              <Suspense fallback={<p role="status">{t('creation.loading')}</p>}>
                <CreationCodeEditor
                  identity={identity}
                  path={file.path}
                  draft={
                    isReadme && readmeDocument.kind !== 'document'
                      ? undefined
                      : draft
                  }
                  text={draft.text}
                  location={location}
                  version={draft.diskVersion}
                />
              </Suspense>
            )
          ) : null
        ) : content?.kind === 'text' ? (
          <Suspense fallback={<p role="status">{t('creation.loading')}</p>}>
            <CreationCodeEditor
              identity={identity}
              path={file.path}
              text={text}
              location={location}
              version={content.version}
            />
          </Suspense>
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
          if (!open) useCreationFilesStore.getState().dismissConflict(file.path)
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
                useCreationFilesStore.getState().dismissConflict(file.path)
              }
            >
              {t('creation.cancel')}
            </Button>
            <Button
              variant="outline"
              disabled={draft?.saving}
              onClick={() => useCreationFilesStore.getState().revert(file.path)}
            >
              {t('creation.conflictReload')}
            </Button>
            <Button
              disabled={!draft?.conflict || draft?.saving}
              onClick={() => {
                const version = draft?.conflict?.version
                if (!version) return
                void useCreationFilesStore.getState().save(file.path, version)
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
