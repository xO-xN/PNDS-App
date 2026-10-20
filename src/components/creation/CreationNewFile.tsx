import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { CreationError, CreationFile } from '@/lib/tauri-bindings'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { CreationErrorNotice } from './CreationErrorNotice'

export function CreationNewFile({
  disabled,
  onCreated,
  directory = '',
  groupLabel,
  kind = 'file',
  initiallyOpen = false,
  onClose,
  onDirectoryCreated,
}: {
  disabled: boolean
  onCreated: (file: CreationFile) => void
  directory?: string
  groupLabel?: string
  kind?: 'file' | 'directory'
  initiallyOpen?: boolean
  onClose?: () => void
  onDirectoryCreated?: (path: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(initiallyOpen)
  const [name, setName] = useState('')
  const [error, setError] = useState<CreationError | null>(null)
  const busy = useCreationFilesStore(state => state.creating)
  const fieldId = useId()
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open, error])
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
    onClose?.()
  }
  const filename = name.trim()
  // File groups are presentation categories, not additional path segments.
  // A filename uses the suggested parent; explicit paths start at project root.
  const path = filename.includes('/')
    ? filename
    : [directory, filename].filter(Boolean).join('/')
  const valid =
    filename.length > 0 &&
    !filename
      .split('/')
      .some(part => ['', '.', '..', '.git', 'node_modules'].includes(part)) &&
    !name.includes('\\') &&
    ![...name].some(
      char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  return (
    <>
      <button
        hidden={initiallyOpen}
        ref={trigger}
        type="button"
        className="creation-icon-button pnds-focus-ring absolute end-1 top-1"
        aria-label={
          groupLabel
            ? t('creation.newFile.inGroup', { group: groupLabel })
            : t('creation.newFile.open')
        }
        title={t('creation.newFile.open')}
        disabled={disabled || busy}
        onClick={() => {
          setError(null)
          setName('')
          setOpen(true)
        }}
      >
        <Plus aria-hidden="true" />
      </button>
      {open && (
        <form
          className="px-2 pb-2"
          aria-label={t(
            kind === 'directory'
              ? 'creation.tree.newDirectory'
              : 'creation.newFile.open'
          )}
          onSubmit={async event => {
            event.preventDefault()
            if (busy || disabled || !valid) return
            if (kind === 'directory') {
              const result = await useCreationFilesStore
                .getState()
                .createDirectory(path)
              if (!result) return
              if (result.status === 'error') setError(result.error)
              else {
                setOpen(false)
                onDirectoryCreated?.(result.data)
              }
              return
            }
            const result = await useCreationFilesStore.getState().create(path)
            if (!result) return
            if (result.status === 'error') setError(result.error)
            else {
              setOpen(false)
              onCreated(result.data)
            }
          }}
        >
          <div className="flex items-center gap-1">
            <Input
              id={fieldId}
              ref={input}
              value={name}
              disabled={busy || disabled}
              className="h-7 min-w-0 text-xs"
              aria-label={t('creation.newFile.path')}
              placeholder={t(
                kind === 'directory'
                  ? 'creation.tree.directoryName'
                  : 'creation.newFile.filename'
              )}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={`${fieldId}-hint`}
              aria-invalid={error != null}
              onChange={event => {
                setName(event.target.value)
                setError(null)
              }}
              onKeyDown={event => {
                if (
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                ) {
                  if (event.key === 'Enter') event.preventDefault()
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!busy) close()
                }
              }}
            />
            <button
              type="submit"
              className="creation-icon-button pnds-focus-ring"
              disabled={busy || disabled || !valid}
              aria-label={t(
                kind === 'directory'
                  ? 'creation.tree.createDirectory'
                  : 'creation.newFile.create'
              )}
            >
              <Check aria-hidden="true" />
            </button>
            <button
              type="button"
              className="creation-icon-button pnds-focus-ring"
              disabled={busy}
              aria-label={t('creation.cancel')}
              onClick={close}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <p
            id={`${fieldId}-hint`}
            className="mt-1 break-all text-xs text-muted-foreground"
          >
            {t('creation.newFile.destinationHint', {
              path: filename ? path : directory ? `${directory}/` : './',
            })}
          </p>
          {error &&
            (error.code === 'missing' || error.code === 'invalidProject' ? (
              <p role="alert" className="text-xs text-destructive">
                {t(
                  error.code === 'missing'
                    ? 'creation.newFile.parentMissing'
                    : 'creation.newFile.textOnly'
                )}
              </p>
            ) : (
              <CreationErrorNotice error={error} />
            ))}
        </form>
      )}
    </>
  )
}
