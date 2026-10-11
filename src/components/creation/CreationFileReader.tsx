import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  commands,
  type CreationContent,
  type CreationError,
  type CreationFile,
} from '@/lib/tauri-bindings'
import { creationTransportError } from '@/store/creation-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CreationErrorNotice } from './CreationErrorNotice'

export function CreationFileReader({
  identity,
  file,
}: {
  identity: string
  file: CreationFile
}) {
  const { t } = useTranslation()
  const [content, setContent] = useState<CreationContent | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [start, setStart] = useState(0)
  const match = useRef<HTMLElement>(null)
  useEffect(() => {
    let live = true
    void commands
      .readCreationFile(identity, file.path)
      .then(result => {
        if (!live) return
        if (result.status === 'ok') setContent(result.data)
        else setError(result.error)
      })
      .catch(error => {
        if (live) setError(creationTransportError(error))
      })
    return () => {
      live = false
    }
  }, [identity, file.path])
  const text = content?.kind === 'text' ? content.text : ''
  const index = query
    ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase(), start)
    : -1
  useEffect(() => {
    match.current?.scrollIntoView({ block: 'center' })
  }, [index, query])
  const reveal = async () => {
    try {
      const result = await commands.revealCreationPath(identity, file.path)
      if (result.status === 'error') setError(result.error)
    } catch (error) {
      setError(creationTransportError(error))
    }
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={file.path}>
      <header className="space-y-3 border-b border-(--pnds-text)/15 p-4">
        <h2 className="break-all font-medium">{file.path}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            {t('creation.fileInfo', {
              type: file.path.split('.').pop()?.toUpperCase() ?? file.kind,
              size: file.size,
            })}
          </p>
          <Button size="sm" variant="outline" onClick={() => void reveal()}>
            {t('creation.revealFile')}
          </Button>
        </div>
        <p className="text-xs">{t('creation.readOnly')}</p>
        {content?.kind === 'text' && (
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
        {error && <CreationErrorNotice error={error} />}
        {!content && !error && <p role="status">{t('creation.loading')}</p>}
        {content?.kind === 'text' && (
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
        )}
        {content?.kind === 'image' && !imageFailed && (
          <img
            className="mx-auto max-h-full max-w-full object-contain"
            src={content.url}
            alt={file.path}
            onError={() => setImageFailed(true)}
          />
        )}
        {imageFailed && <p role="status">{t('creation.imageFailed')}</p>}
        {content?.kind === 'binary' && <p>{t('creation.binaryHint')}</p>}
      </div>
    </section>
  )
}
