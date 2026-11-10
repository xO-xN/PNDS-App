import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Plus, Upload } from 'lucide-react'
import { open as pickFile } from '@tauri-apps/plugin-dialog'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationMaterialsStore } from '@/store/creation-materials-store'
import {
  pendingDraftDirty,
  useCreationPendingStore,
} from '@/store/creation-pending-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PendingIntegrationRecovery } from './PendingIntegrationRecovery'

/** Private pending documents use the file area's main editor, never project paths. */
export function CreationMaterials({
  identity,
  disabled,
}: {
  identity: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const documents = useCreationPendingStore(state => state.documents)
  const drafts = useCreationPendingStore(state => state.drafts)
  const activeId = useCreationPendingStore(state => state.activeId)
  const reading = useCreationReadingStore(state => state.view)
  const error = useCreationPendingStore(state => state.error)
  const intent = useCreationMaterialsStore(state => state.request)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null
  )
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const newButton = useRef<HTMLButtonElement>(null)
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
        else newButton.current?.focus()
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
    })),
    ...Object.values(drafts)
      .filter(draft => !documents.some(document => document.id === draft.id))
      .map(draft => ({ id: draft.id, name: draft.name })),
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
  const importDocument = async () => {
    if (disabled || importing) return
    setImporting(true)
    setImportError(null)
    try {
      const path = await pickFile({
        directory: false,
        multiple: false,
        title: t('creation.pending.import'),
      })
      if (!owns() || typeof path !== 'string') return
      const result = await commands.addCreationMaterial(identity, path)
      if (!owns()) return
      if (result.status === 'error') {
        setImportError(result.error)
        return
      }
      await useCreationPendingStore.getState().refresh()
      if (!owns()) return
      await useCreationPendingStore.getState().open(result.data.id)
      if (owns()) setEditing({ id: result.data.id, name: result.data.name })
    } catch {
      if (owns()) setImportError('storage')
    } finally {
      if (owns()) setImporting(false)
    }
  }
  return (
    <section
      className="creation-pending-group"
      aria-label={t('creation.pending.title')}
    >
      <div className="creation-tree-heading">
        <strong>{t('creation.pending.title')}</strong>
        <button
          ref={newButton}
          type="button"
          className="creation-icon-button pnds-focus-ring"
          aria-label={t('creation.pending.new')}
          disabled={disabled}
          onClick={() => {
            const id = useCreationPendingStore.getState().create()
            if (id) setEditing({ id, name: '' })
          }}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="creation-icon-button pnds-focus-ring"
          aria-label={t('creation.pending.import')}
          disabled={disabled || importing}
          onClick={() => void importDocument()}
        >
          <Upload aria-hidden="true" />
        </button>
      </div>
      <p className="px-3 pb-2 text-xs text-muted-foreground">
        {t('creation.pending.privateHint')}
      </p>
      {(error || importError) && (
        <div role="alert" className="px-3 text-xs text-(--pnds-danger)">
          {t(`creation.materials.error.${importError ?? error}`)}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setImportError(null)
              void useCreationPendingStore.getState().refresh()
            }}
          >
            {t('error.retry')}
          </Button>
        </div>
      )}
      {!entries.length && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          {t('creation.pending.empty')}
        </p>
      )}
      <div className="max-h-56 overflow-auto">
        {entries.map(entry =>
          editing?.id === entry.id ? (
            <form
              key={entry.id}
              className="px-3 py-1"
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
                    newButton.current?.focus()
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
              key={entry.id}
              type="button"
              className="creation-pending-row pnds-focus-ring"
              aria-label={entry.name || t('creation.pending.untitled')}
              aria-pressed={activeId === entry.id && reading === 'pending'}
              disabled={disabled}
              onClick={() =>
                void useCreationPendingStore.getState().open(entry.id)
              }
              onKeyDown={event => {
                if (event.key === 'F2') {
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
              <FileText aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {entry.name || t('creation.pending.untitled')}
              </span>
              {drafts[entry.id] && pendingDraftDirty(drafts[entry.id]) && (
                <span
                  className="creation-dirty-dot"
                  aria-label={t('creation.unsaved')}
                />
              )}
            </button>
          )
        )}
      </div>
      <div className="px-3 pt-2">
        <PendingIntegrationRecovery identity={identity} disabled={disabled} />
      </div>
    </section>
  )
}
