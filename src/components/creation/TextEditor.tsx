import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentLess, indentMore } from '@codemirror/commands'
import { getSearchQuery } from '@codemirror/search'
import type { TextBuffer } from '@/lib/text-buffer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Reusable local editing surface. A caller owns the buffer and any save action. */
export function TextEditor({
  buffer,
  path = buffer.path,
  value,
  onChange,
  readOnly = false,
  resetKey = 0,
  location,
}: {
  buffer: TextBuffer
  path?: string
  value: string
  onChange?: (text: string) => void
  readOnly?: boolean
  resetKey?: number
  location?: { line: number } | null
}) {
  const { t } = useTranslation()
  const hintId = useId()
  const host = useRef<HTMLDivElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const lineInput = useRef<HTMLInputElement>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [lineOpen, setLineOpen] = useState(false)
  const [query, setQuery] = useState(
    () => getSearchQuery(buffer.getSnapshot()).search
  )
  const [replacement, setReplacement] = useState(
    () => getSearchQuery(buffer.getSnapshot()).replace
  )
  const [line, setLine] = useState('1')
  const [message, setMessage] = useState('')
  const state = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot)
  const publish = useEffectEvent(() => {
    if (buffer.text !== value) onChange?.(buffer.text)
  })
  useLayoutEffect(() => buffer.sync(value, resetKey), [buffer, value, resetKey])
  useEffect(() => buffer.subscribe(publish), [buffer])
  useEffect(() => {
    if (!host.current) return
    buffer.rename(path)
    return buffer.mount(host.current, [
      EditorState.readOnly.of(readOnly),
      EditorView.contentAttributes.of({
        'aria-label': path,
        'aria-describedby': hintId,
        spellcheck: 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
      }),
      EditorView.domEventHandlers({
        beforeinput: event => {
          if (
            event.inputType !== 'historyUndo' &&
            event.inputType !== 'historyRedo'
          )
            return false
          event.preventDefault()
          if (event.inputType === 'historyUndo') buffer.undo()
          else buffer.redo()
          return true
        },
      }),
      keymap.of([
        {
          key: 'Mod-f',
          run: () => {
            setFindOpen(true)
            findInput.current?.focus()
            return true
          },
        },
        {
          key: 'Mod-g',
          run: () => {
            setLineOpen(true)
            lineInput.current?.focus()
            return true
          },
        },
      ]),
    ])
  }, [buffer, path, readOnly, hintId])
  useEffect(() => {
    if (findOpen) findInput.current?.focus()
  }, [findOpen])
  useEffect(() => {
    if (lineOpen) lineInput.current?.focus()
  }, [lineOpen])
  useEffect(() => {
    if (location && buffer.locate(location) === false)
      setMessage(
        t('creation.editor.invalidLine', {
          count: buffer.getSnapshot().doc.lines,
        })
      )
  }, [buffer, location, t])
  const updateSearch = (search: string, replace: string) => {
    setQuery(search)
    setReplacement(replace)
    setMessage('')
    buffer.search(search, replace)
  }
  const next = () => setMessage(buffer.findNext() ? '' : t('creation.noMatch'))
  const cursor = state.doc.lineAt(state.selection.main.head)
  return (
    <div className="creation-text-editor" data-text-buffer="">
      <div
        className="creation-editor-tools"
        role="group"
        aria-label={t('creation.editor.tools')}
      >
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly || !buffer.canUndo}
          onClick={() => buffer.undo()}
        >
          {t('creation.editor.undo')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly || !buffer.canRedo}
          onClick={() => buffer.redo()}
        >
          {t('creation.editor.redo')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setFindOpen(!findOpen)}
          aria-expanded={findOpen}
        >
          {t('creation.editor.find')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setLineOpen(!lineOpen)}
          aria-expanded={lineOpen}
        >
          {t('creation.editor.goLine')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly}
          onClick={() =>
            indentMore({
              state,
              dispatch: transaction => buffer.apply(transaction),
            })
          }
        >
          {t('creation.editor.indent')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly}
          onClick={() =>
            indentLess({
              state,
              dispatch: transaction => buffer.apply(transaction),
            })
          }
        >
          {t('creation.editor.outdent')}
        </Button>
      </div>
      {findOpen && (
        <div
          className="creation-editor-tools"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setFindOpen(false)
              host.current?.querySelector<HTMLElement>('.cm-content')?.focus()
            }
          }}
        >
          <Input
            ref={findInput}
            aria-label={t('creation.findText')}
            value={query}
            onChange={event => updateSearch(event.target.value, replacement)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                next()
              }
            }}
          />
          <Button size="sm" variant="outline" disabled={!query} onClick={next}>
            {t('creation.nextMatch')}
          </Button>
          {!readOnly && (
            <>
              <Input
                aria-label={t('creation.editor.replaceWith')}
                value={replacement}
                onChange={event => updateSearch(query, event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!query}
                onClick={() => {
                  if (!buffer.replaceNext()) setMessage(t('creation.noMatch'))
                }}
              >
                {t('creation.editor.replace')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!query}
                onClick={() =>
                  setMessage(
                    t('creation.editor.replaced', {
                      count: buffer.replaceAll(),
                    })
                  )
                }
              >
                {t('creation.editor.replaceAll')}
              </Button>
            </>
          )}
        </div>
      )}
      {lineOpen && (
        <form
          className="creation-editor-tools"
          onSubmit={event => {
            event.preventDefault()
            if (buffer.goToLine(Number(line))) {
              setLineOpen(false)
              setMessage('')
            } else
              setMessage(
                t('creation.editor.invalidLine', { count: state.doc.lines })
              )
          }}
        >
          <Input
            ref={lineInput}
            aria-label={t('creation.editor.lineNumber')}
            inputMode="numeric"
            value={line}
            onChange={event => setLine(event.target.value)}
          />
          <Button size="sm" type="submit">
            {t('creation.editor.goLine')}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => setLineOpen(false)}
          >
            {t('creation.cancel')}
          </Button>
        </form>
      )}
      <div ref={host} className="creation-editor-host" dir="ltr" />
      <div className="creation-editor-tools creation-editor-detail">
        <span>
          {t('creation.editor.position', {
            line: cursor.number,
            column: state.selection.main.head - cursor.from + 1,
          })}
        </span>
        <span>{buffer.language || t('creation.editor.plainText')} · UTF-8</span>
        <span id={hintId}>{t('creation.editor.keyboardHint')}</span>
        <span>{t('creation.editor.syntaxHint')}</span>
      </div>
      {(message || buffer.resetCount > 0) && (
        <p role="status" className="px-3 text-xs">
          {message || t('creation.editor.historyReset')}
        </p>
      )}
    </div>
  )
}
