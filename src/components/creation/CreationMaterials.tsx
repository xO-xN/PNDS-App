import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FilePlus2,
  FileText,
  ImageIcon,
  Inbox,
  Music2,
  Plus,
  X,
} from 'lucide-react'
import { open as pickFile } from '@tauri-apps/plugin-dialog'
import { useCreationStore } from '@/store/creation-store'
import { timeLabel } from '@/lib/creation-test-audio'
import { useCreationMaterialsStore } from '@/store/creation-materials-store'
import {
  pendingDraftDirty,
  useCreationPendingStore,
} from '@/store/creation-pending-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { commands } from '@/lib/tauri-bindings'
import {
  beginAssistantMaterialDrag,
  cancelAssistantMaterialDrag,
} from '@/lib/assistant-material-drag'
import { toast } from 'sonner'

/** Private pending documents use the file area's main editor, never project paths. */
export function CreationMaterials({
  identity,
  disabled,
}: {
  identity: string
  disabled: boolean
}) {
  const { t, i18n } = useTranslation()
  const documents = useCreationPendingStore(state => state.documents)
  const media = useCreationPendingStore(state => state.media)
  const drafts = useCreationPendingStore(state => state.drafts)
  const removing = useCreationPendingStore(state => state.removing)
  const removalCleanupPending = useCreationPendingStore(
    state => state.removalCleanupPending
  )
  const activeId = useCreationPendingStore(state => state.activeId)
  const reading = useCreationReadingStore(state => state.view)
  const error = useCreationPendingStore(state => state.error)
  const importing = useCreationPendingStore(state => state.importing)
  const importError = useCreationPendingStore(state => state.importError)
  const importFailures = useCreationPendingStore(state => state.importFailures)
  const intent = useCreationMaterialsStore(state => state.request)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null
  )
  const [picking, setPicking] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const actionAfterMenu = useRef<'new' | 'import' | null>(null)
  const alive = useRef(true)
  const owns = () =>
    alive.current &&
    useCreationStore.getState().workspace?.project.identity === identity
  useEffect(() => {
    alive.current = true
    if (useCreationPendingStore.getState().identity !== identity)
      useCreationPendingStore.getState().reset(identity)
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      await useCreationPendingStore.getState().refresh()
      if (live)
        timer = setTimeout(() => {
          void refresh()
        }, 1000)
    }
    void refresh()
    const focus = () => {
      void useCreationPendingStore.getState().refresh()
    }
    window.addEventListener('focus', focus)
    return () => {
      alive.current = false
      live = false
      clearTimeout(timer)
      window.removeEventListener('focus', focus)
    }
  }, [identity])
  useEffect(() => {
    if (intent?.identity !== identity) return
    let live = true
    void useCreationPendingStore
      .getState()
      .refresh()
      .then(() => {
        if (
          !live ||
          !alive.current ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        if (intent.id)
          void useCreationPendingStore
            .getState()
            .open(intent.id, intent.version)
        else addButton.current?.focus()
        useCreationMaterialsStore.getState().close()
      })
    return () => {
      live = false
    }
  }, [intent, identity])
  const editingId = editing?.id
  useEffect(() => {
    if (editingId) nameInput.current?.focus()
  }, [editingId])
  const entries = [
    ...documents.map(document => ({
      id: document.id,
      name: drafts[document.id]?.name ?? document.name,
      kind: 'text' as const,
      savedVersion: document.version,
    })),
    ...Object.values(drafts)
      .filter(draft => !documents.some(document => document.id === draft.id))
      .map(draft => ({
        id: draft.id,
        name: draft.name,
        kind: 'text' as const,
        savedVersion: null,
      })),
    ...media.map(item => ({
      ...item,
      kind: item.mime.startsWith('audio/')
        ? ('audio' as const)
        : ('image' as const),
      savedVersion: item.version,
    })),
  ]
  const finishName = async () => {
    if (!editing || disabled) return
    if (
      await useCreationPendingStore.getState().rename(editing.id, editing.name)
    ) {
      setEditing(null)
      document
        .querySelector<HTMLElement>('[data-pending-editor] .cm-content')
        ?.focus()
    }
  }
  const inboxDisabled = disabled || picking || importing
  const pickDocuments = async () => {
    if (inboxDisabled) return
    setPicking(true)
    try {
      const paths = await pickFile({
        directory: false,
        multiple: true,
        title: t('creation.pending.inbox'),
      })
      if (!owns() || !paths) return
      await useCreationPendingStore
        .getState()
        .importFiles(identity, typeof paths === 'string' ? [paths] : paths)
    } catch {
      if (owns()) useCreationPendingStore.setState({ importError: 'storage' })
    } finally {
      if (owns()) setPicking(false)
    }
  }
  return (
    <section
      className="creation-pending-group"
      aria-label={t('creation.pending.title')}
      data-creation-inbox={identity}
      data-creation-inbox-disabled={inboxDisabled || undefined}
    >
      <div className="creation-tree-heading">
        <strong>{t('creation.pending.title')}</strong>
        <DropdownMenu dir={i18n.dir()}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              ref={addButton}
              type="button"
              className="creation-icon-button creation-add-trigger pnds-focus-ring"
              aria-label={t('creation.pending.add')}
              disabled={disabled}
            >
              <Plus aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="creation-add-menu"
            onCloseAutoFocus={event => {
              const action = actionAfterMenu.current
              actionAfterMenu.current = null
              if (!action || disabled || !owns()) return
              event.preventDefault()
              if (action === 'new') {
                const id = useCreationPendingStore.getState().create()
                if (id) setEditing({ id, name: '' })
                else addButton.current?.focus()
              } else {
                addButton.current?.focus()
                void pickDocuments()
              }
            }}
          >
            <DropdownMenuItem
              disabled={disabled}
              onSelect={() => {
                actionAfterMenu.current = 'new'
              }}
            >
              <FilePlus2 aria-hidden="true" />
              {t('creation.pending.new')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={inboxDisabled}
              onSelect={() => {
                actionAfterMenu.current = 'import'
              }}
            >
              <Inbox aria-hidden="true" />
              {t('creation.pending.import')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="creation-pending-list">
        {(error || importError || importFailures.length > 0) && (
          <div role="alert" className="px-3 text-xs text-(--pnds-danger)">
            {(importError || error) &&
              t(`creation.materials.error.${importError ?? error}`)}
            {importFailures.length > 0 && (
              <ul>
                {importFailures.map(({ name, error }, index) => (
                  <li key={index}>
                    {t('creation.pending.importFailure', {
                      name,
                      reason: t(`creation.materials.error.${error}`),
                    })}
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (importError || importFailures.length > 0)
                  useCreationPendingStore.setState({
                    importError: null,
                    importFailures: [],
                  })
                else void useCreationPendingStore.getState().refresh()
              }}
            >
              {t(
                importError || importFailures.length > 0
                  ? 'creation.pending.dismissError'
                  : 'error.retry'
              )}
            </Button>
          </div>
        )}
        {removalCleanupPending && (
          <div role="status" className="px-3 text-xs text-muted-foreground">
            {t('creation.pending.removeMediaCleanup')}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                useCreationPendingStore.setState({
                  removalCleanupPending: false,
                })
              }
            >
              {t('creation.pending.dismissError')}
            </Button>
          </div>
        )}
        {entries.length === 0 && (
          <div className="creation-pending-empty">
            <Inbox aria-hidden="true" className="size-5" />
            <span>{t('creation.pending.dropFiles')}</span>
          </div>
        )}
        {entries.map(entry => (
          <div
            key={entry.id}
            className="creation-pending-item flex min-w-0 items-center pe-2"
          >
            {editing?.id === entry.id ? (
              <form
                className="min-w-0 flex-1 px-3 py-1"
                onSubmit={event => {
                  event.preventDefault()
                  void finishName()
                }}
              >
                <Input
                  ref={nameInput}
                  aria-label={t('creation.pending.name')}
                  disabled={disabled || drafts[entry.id]?.saving}
                  value={editing.name}
                  onChange={event => {
                    setEditing({ id: entry.id, name: event.target.value })
                    if (!drafts[entry.id]?.saved)
                      void useCreationPendingStore
                        .getState()
                        .rename(entry.id, event.target.value)
                  }}
                  onKeyDown={event => {
                    if (event.nativeEvent.isComposing && event.key === 'Enter')
                      event.preventDefault()
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      const draft =
                        useCreationPendingStore.getState().drafts[entry.id]
                      if (draft && !draft.saved && !draft.name && !draft.text)
                        void useCreationPendingStore.getState().remove(entry.id)
                      setEditing(null)
                      addButton.current?.focus()
                    }
                  }}
                />
                {drafts[entry.id]?.error && (
                  <p role="alert" className="text-xs text-(--pnds-danger)">
                    {t(`creation.materials.error.${drafts[entry.id]?.error}`)}
                  </p>
                )}
              </form>
            ) : (
              <button
                type="button"
                className="creation-pending-row pnds-focus-ring min-w-0 flex-1"
                aria-label={entry.name || t('creation.pending.untitled')}
                aria-pressed={activeId === entry.id && reading === 'pending'}
                disabled={disabled}
                draggable={!disabled && !!entry.savedVersion}
                onDragStart={event => {
                  event.preventDefault()
                  if (disabled || !entry.savedVersion) return
                  const token = beginAssistantMaterialDrag(
                    identity,
                    entry.id,
                    entry.savedVersion
                  )
                  void commands
                    .dragCreationPendingDocument(
                      identity,
                      entry.id,
                      entry.savedVersion,
                      token
                    )
                    .then(result => {
                      if (result.status !== 'error') return
                      cancelAssistantMaterialDrag(token)
                      if (owns())
                        toast.error(
                          t(`creation.materials.error.${result.error}`)
                        )
                    })
                    .catch(() => {
                      cancelAssistantMaterialDrag(token)
                      if (owns())
                        toast.error(t('creation.materials.error.storage'))
                    })
                }}
                onClick={() =>
                  void useCreationPendingStore.getState().open(entry.id)
                }
                onKeyDown={event => {
                  if (entry.kind === 'text' && event.key === 'F2') {
                    event.preventDefault()
                    void useCreationPendingStore
                      .getState()
                      .open(entry.id)
                      .then(opened => {
                        if (opened && owns())
                          setEditing({ id: entry.id, name: entry.name })
                      })
                  }
                }}
              >
                {entry.kind === 'audio' ? (
                  <Music2 aria-hidden="true" className="size-3.5 shrink-0" />
                ) : entry.kind === 'image' ? (
                  <ImageIcon aria-hidden="true" className="size-3.5 shrink-0" />
                ) : (
                  <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {entry.name || t('creation.pending.untitled')}
                  </span>
                  {entry.kind === 'audio' && (
                    <span className="truncate text-[10px] text-muted-foreground">
                      {t('creation.pending.audioMetadata', {
                        format: entry.mime === 'audio/wav' ? 'WAV' : 'MP3',
                        size: new Intl.NumberFormat(i18n.language, {
                          style: 'unit',
                          unit: 'megabyte',
                          maximumFractionDigits: 2,
                        }).format(entry.size / 1_000_000),
                        duration: timeLabel(entry.durationMs ?? 0),
                      })}
                    </span>
                  )}
                </span>
                {drafts[entry.id] && pendingDraftDirty(drafts[entry.id]) && (
                  <span
                    className="creation-dirty-dot"
                    aria-label={t('creation.unsaved')}
                  />
                )}
              </button>
            )}
            <button
              type="button"
              className="creation-icon-button pnds-focus-ring shrink-0"
              aria-label={t('creation.pending.remove', {
                name: entry.name || t('creation.pending.untitled'),
              })}
              disabled={
                disabled || drafts[entry.id]?.saving || removing.has(entry.id)
              }
              onClick={() =>
                void useCreationPendingStore
                  .getState()
                  .remove(entry.id)
                  .then(removed => {
                    if (removed && owns())
                      setEditing(current =>
                        current?.id === entry.id ? null : current
                      )
                  })
              }
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
