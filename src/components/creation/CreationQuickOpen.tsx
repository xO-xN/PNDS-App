import { useEffect, useEffectEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListFilter } from 'lucide-react'
import type { CreationFile } from '@/lib/tauri-bindings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { hasOpenOverlay } from '@/hooks/use-command-keyboard'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'

/** Search only the already-issued capability's bounded inventory. No raw path read. */
export function CreationQuickOpen({
  files,
  onOpen,
  request = 0,
  hideTrigger = false,
  disabled = false,
  returnFocus,
}: {
  files: CreationFile[]
  onOpen: (path: string) => void
  request?: number
  hideTrigger?: boolean
  disabled?: boolean
  returnFocus?: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const showRequested = useEffectEvent(() => setOpen(true))
  useEffect(() => {
    if (request) showRequested()
  }, [request])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listId = useId()
  const matches = files.filter(file =>
    file.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )
  const results = matches.slice(0, 100)
  const index = Math.min(selected, Math.max(0, results.length - 1))
  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${index}`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [open, listId, index, query])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !disabled &&
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === 'KeyP' &&
        useCreationStore.getState().active &&
        useCreationStore.getState().modePhase === 'idle' &&
        !useCreationStore.getState().opening &&
        !useCreationTestStore.getState().expanded &&
        !hasOpenOverlay()
      ) {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [disabled])
  const choose = (path: string) => {
    onOpen(path)
    setOpen(false)
  }
  return (
    <>
      <button
        hidden={hideTrigger}
        disabled={disabled}
        type="button"
        className="creation-icon-button creation-quick-open-trigger pnds-focus-ring"
        aria-label={t('creation.editor.quickOpen')}
        title={t('creation.editor.quickOpen')}
        aria-keyshortcuts="Meta+P"
        onClick={() => setOpen(true)}
      >
        <ListFilter aria-hidden="true" />
      </button>
      <Dialog
        open={open}
        onOpenChange={value => {
          setOpen(value)
          if (!value) {
            setQuery('')
            setSelected(0)
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={event => {
            if (returnFocus) {
              event.preventDefault()
              returnFocus()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('creation.editor.quickOpen')}</DialogTitle>
            <DialogDescription>
              {t('creation.editor.quickOpenHint')}
            </DialogDescription>
          </DialogHeader>
          <Input
            role="combobox"
            aria-label={t('creation.editor.quickOpenQuery')}
            aria-controls={listId}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={
              results.length ? `${listId}-${index}` : undefined
            }
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected(
                  Math.max(
                    0,
                    Math.min(
                      results.length - 1,
                      index + (event.key === 'ArrowDown' ? 1 : -1)
                    )
                  )
                )
              }
              if (event.key === 'Enter' && results[index]) {
                event.preventDefault()
                choose(results[index].path)
              }
            }}
          />
          <div
            role="listbox"
            id={listId}
            aria-label={t('creation.files')}
            className="creation-quick-open-results"
          >
            {results.map((file, i) => (
              <button
                key={file.path}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === index}
                type="button"
                tabIndex={-1}
                className="creation-quick-open-result pnds-focus-ring"
                onClick={() => choose(file.path)}
              >
                <span>{file.path}</span>
                <small>{file.size} B</small>
              </button>
            ))}
          </div>
          <p role="status" className="text-xs">
            {matches.length
              ? t('creation.editor.quickOpenCount', {
                  shown: results.length,
                  count: matches.length,
                })
              : t('creation.noFiles')}
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
