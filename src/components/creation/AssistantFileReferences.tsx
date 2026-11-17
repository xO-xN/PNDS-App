import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  assistantFileReferenceKey,
  assistantFileReferenceName,
  loadAssistantFileReferences,
  MAX_ASSISTANT_FILE_REFERENCES,
} from '@/lib/assistant-file-references'
import { useAssistantStore } from '@/store/assistant-store'

export function AssistantFileReferences({
  identity,
  conversationId,
  disabled,
  open,
  onClose,
  onReturnFocus,
}: {
  identity: string
  conversationId: string | null
  disabled: boolean
  open: boolean
  onClose: () => void
  onReturnFocus: () => void
}) {
  const { t } = useTranslation()
  const references = useAssistantStore(state => state.fileReferences)
  const [catalog, setCatalog] = useState<Awaited<
    ReturnType<typeof loadAssistantFileReferences>
  > | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const existing = new Set(references.map(assistantFileReferenceKey))
  const limit =
    references.length + checked.size >= MAX_ASSISTANT_FILE_REFERENCES
  useEffect(() => {
    if (!open) return
    let current = true
    void loadAssistantFileReferences(identity).then(files => {
      if (current) setCatalog(files)
    })
    return () => {
      current = false
    }
  }, [open, identity])
  const visible = catalog?.references.filter(reference =>
    assistantFileReferenceName(reference)
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  )
  const close = () => {
    setCatalog(null)
    setChecked(new Set())
    setSearch('')
    onClose()
  }
  if (!open && !references.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Dialog
        open={open}
        onOpenChange={next => {
          if (!next) close()
        }}
      >
        <DialogContent
          onCloseAutoFocus={event => {
            event.preventDefault()
            onReturnFocus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('assistant.reference.add')}</DialogTitle>
            <DialogDescription>
              {t('assistant.reference.description')}
            </DialogDescription>
          </DialogHeader>
          {catalog?.allUnavailable ? (
            <p role="alert">{t('assistant.reference.unavailable')}</p>
          ) : !catalog ? (
            <p role="status">{t('assistant.reference.loading')}</p>
          ) : (
            <>
              {catalog.unavailable && (
                <p role="status">{t('assistant.reference.partial')}</p>
              )}
              <input
                type="search"
                aria-label={t('assistant.reference.search')}
                placeholder={t('assistant.reference.search')}
                className="pnds-focus-ring rounded-md border p-2"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
              <div className="max-h-[45vh] space-y-2 overflow-auto">
                {!visible?.length && <p>{t('assistant.reference.empty')}</p>}
                {(['project', 'material', 'image', 'audio'] as const).map(
                  kind => {
                    const entries = visible?.filter(item => item.kind === kind)
                    if (!entries?.length) return null
                    return (
                      <fieldset key={kind} className="min-w-0">
                        <legend className="text-sm font-medium">
                          {t(`assistant.reference.${kind}`)}
                        </legend>
                        {entries.map(reference => {
                          const key = assistantFileReferenceKey(reference)
                          return (
                            <label
                              key={key}
                              className="flex items-start gap-2 rounded-md p-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="pnds-focus-ring mt-1"
                                checked={existing.has(key) || checked.has(key)}
                                disabled={
                                  existing.has(key) ||
                                  (limit && !checked.has(key))
                                }
                                onChange={event => {
                                  const include = event.target.checked
                                  setChecked(previous => {
                                    const next = new Set(previous)
                                    if (include) next.add(key)
                                    else next.delete(key)
                                    return next
                                  })
                                }}
                              />
                              <span className="min-w-0 break-all">
                                {assistantFileReferenceName(reference)}
                              </span>
                            </label>
                          )
                        })}
                      </fieldset>
                    )
                  }
                )}
              </div>
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => {
                useAssistantStore
                  .getState()
                  .addFileReferences(
                    identity,
                    conversationId,
                    catalog?.references.filter(item =>
                      checked.has(assistantFileReferenceKey(item))
                    ) ?? []
                  )
                close()
              }}
            >
              {t('assistant.reference.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {references.map(reference => {
        const key = assistantFileReferenceKey(reference)
        const name = assistantFileReferenceName(reference)
        return (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="max-w-full"
            aria-label={t('assistant.reference.remove', { name })}
            title={name}
            onClick={() =>
              useAssistantStore.getState().removeFileReference(key)
            }
          >
            <span className="truncate">{name}</span>
            <X aria-hidden="true" />
          </Button>
        )
      })}
    </div>
  )
}
