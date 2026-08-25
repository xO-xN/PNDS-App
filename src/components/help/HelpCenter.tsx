import { useEffect, useRef, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'

import i18n from '@/i18n/config'
import {
  buildHelpCorpus,
  HELP_BOOKS,
  type HelpBookId,
  type HelpDocument,
} from '@/lib/help-corpus'
import { setColorThemeAttribute, type ColorTheme } from '@/lib/color-theme'
import { buildHelpIndex, searchHelp, type HelpIndex } from '@/lib/help-search'
import type { HelpTarget } from '@/lib/help-window'
import { HELP_WINDOW_LABEL } from '@/lib/help-window'
import { logger } from '@/lib/logger'
import { splitTextOnTerms } from '@/lib/help-markdown'
import { commands } from '@/lib/tauri-bindings'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { HelpMarkdown } from './HelpMarkdown'

/**
 * v1.3.0 (#56): the help center window's whole UI. It boots the T7 seam
 * (helpCorpus → buildHelpCorpus → buildHelpIndex), runs the pure search
 * on every keystroke, and renders hits as jump cards — a click opens the
 * document, scrolls to the hit's section anchor, and keeps the query
 * terms marked in the body. The sidebar browses the entire corpus by
 * book. The window itself is created hidden (#51 anti-flash pattern);
 * THIS component reveals it once content is ready — or once loading has
 * failed — so the first visible frame is themed and populated, never a
 * white flash and never a window stuck invisible.
 */

interface ActiveDoc {
  docId: string
  /** Section anchor to scroll to (a search hit's landing section). */
  anchor: string | null
  /** Query terms to keep marking in the opened document. */
  terms: readonly string[]
}

/** Book ids are kebab; the locale keys stay camelCase — map explicitly. */
const BOOK_LABEL_KEYS: Record<HelpBookId, string> = {
  tutorial: 'help.book.tutorial',
  'creator-guide': 'help.book.creatorGuide',
  reference: 'help.book.reference',
}

function MarkedText({
  text,
  terms,
}: {
  text: string
  terms: readonly string[]
}) {
  const segments = splitTextOnTerms(text, terms)
  if (segments === null) return <>{text}</>
  return (
    <>
      {segments.map((segment, index) =>
        segment.marked ? <mark key={index}>{segment.text}</mark> : segment.text
      )}
    </>
  )
}

export function HelpCenterApp({
  initialTarget,
}: {
  initialTarget?: HelpTarget
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [corpus, setCorpus] = useState<readonly HelpDocument[]>([])
  const [index, setIndex] = useState<HelpIndex | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [query, setQuery] = useState('')
  const [activeDoc, setActiveDoc] = useState<ActiveDoc | null>(() => {
    if (initialTarget?.kind === 'doc') {
      return { docId: initialTarget.docId, anchor: null, terms: [] }
    }
    if (initialTarget?.kind === 'search') return null
    return { docId: 'app-tutorial', anchor: null, terms: [] }
  })

  const searchInput = useRef<HTMLInputElement>(null)
  const docViewport = useRef<HTMLDivElement>(null)
  const initialTargetRef = useRef(initialTarget)

  // Boot (and Retry): load and index the corpus; the reveal rides the
  // finally — a failed load still shows the themed error state, never a
  // hidden window. fadeInWindow is a Rust-side no-op when visible, so
  // retries never re-fade.
  useEffect(() => {
    let stale = false
    const load = async () => {
      try {
        const result = await commands.helpCorpus()
        if (stale) return
        if (result.status === 'error') {
          throw new Error(String(result.error))
        }
        const loaded = buildHelpCorpus(result.data)
        if (stale) return
        setCorpus(loaded)
        setIndex(buildHelpIndex(loaded))
        setStatus('ready')
      } catch (error) {
        if (stale) return
        logger.error('The help corpus failed to load', { error })
        setStatus('error')
      } finally {
        // #51 reveal: hidden create → ready → fade in.
        const revealed = await commands.fadeInWindow(HELP_WINDOW_LABEL)
        if (revealed.status === 'error') {
          logger.warn('The help window reveal failed', {
            error: revealed.error,
          })
        }
      }
    }
    void load()
    return () => {
      stale = true
    }
  }, [reloadNonce])

  useEffect(() => {
    if (initialTargetRef.current?.kind === 'search') {
      searchInput.current?.focus()
    }
  }, [])

  // The main window drives this window: menu entries navigate it, and
  // language switches push the resolved locale (the corpus stays
  // Chinese-only this release; the UI copy follows).
  useEffect(() => {
    const unlisteners: (() => void)[] = []
    void listen<HelpTarget>('pnds:help-navigate', event => {
      const target = event.payload
      if (target.kind === 'doc') {
        setActiveDoc({ docId: target.docId, anchor: null, terms: [] })
      } else {
        setActiveDoc(null)
        searchInput.current?.focus()
      }
    }).then(unlisten => {
      unlisteners.push(unlisten)
    })
    void listen<{ locale: string }>('pnds:help-locale', event => {
      void i18n.changeLanguage(event.payload.locale)
    }).then(unlisten => {
      unlisteners.push(unlisten)
    })
    // Live theme follow: an open help window must not keep a stale theme
    // after the user switches one in the main window's settings.
    void listen<{ colorTheme: ColorTheme }>('pnds:help-theme', event => {
      setColorThemeAttribute(event.payload.colorTheme)
    }).then(unlisten => {
      unlisteners.push(unlisten)
    })
    // The boot handshake: a target sent while this page was still loading
    // was dropped (no listener yet) — announce readiness so the main
    // window replays the last target.
    void emit('pnds:help-ready').catch(() => {
      // No receiver yet — nothing was dropped either.
    })
    return () => {
      for (const unlisten of unlisteners) unlisten()
    }
  }, [])

  // Typing returns to the hit list; the empty query keeps the document
  // open (a cleared search is browsing, not a blank page).
  const onQueryChange = (next: string) => {
    setQuery(next)
    if (next.trim() !== '') setActiveDoc(null)
  }

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(term => term !== '')
  const hits =
    status === 'ready' &&
    index !== null &&
    activeDoc === null &&
    queryTerms.length > 0
      ? searchHelp(index, query)
      : []

  const activeDocument =
    activeDoc === null
      ? null
      : (corpus.find(d => d.id === activeDoc.docId) ?? null)

  // Land on the anchor once the document view is painted; plain doc
  // opens reset the scroll to the top.
  useEffect(() => {
    if (activeDoc === null) return
    if (activeDoc.anchor !== null) {
      document.getElementById(activeDoc.anchor)?.scrollIntoView()
    } else if (docViewport.current) {
      docViewport.current.scrollTop = 0
    }
  }, [activeDoc])

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1">
        <nav
          className="w-56 shrink-0 overflow-y-auto border-e py-2"
          aria-label={t('menu.help')}
        >
          {HELP_BOOKS.map(book => (
            <div key={book.id} className="mb-2">
              <div className="text-muted-foreground px-3 pb-1 pt-2 text-xs font-semibold tracking-wide">
                {t(BOOK_LABEL_KEYS[book.id])}
              </div>
              {book.documentIds.map(docId => {
                const doc = corpus.find(d => d.id === docId)
                if (!doc) return null
                const active = activeDoc?.docId === docId
                return (
                  <button
                    key={docId}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'hover:bg-accent/50 w-full px-3 py-1.5 text-start text-sm',
                      active && 'bg-accent text-accent-foreground font-medium'
                    )}
                    onClick={() =>
                      setActiveDoc({ docId, anchor: null, terms: [] })
                    }
                  >
                    {doc.title}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b p-3">
            <Input
              ref={searchInput}
              value={query}
              onChange={event => onQueryChange(event.target.value)}
              placeholder={t('help.searchPlaceholder')}
              aria-label={t('help.searchPlaceholder')}
              className="text-sm"
            />
          </div>

          {status === 'error' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-muted-foreground text-sm">
                {t('help.loadError')}
              </p>
              <button
                type="button"
                className="text-sm underline underline-offset-2"
                onClick={() => {
                  setStatus('loading')
                  setReloadNonce(nonce => nonce + 1)
                }}
              >
                {t('help.retry')}
              </button>
            </div>
          ) : status === 'loading' ? (
            <div
              className="text-muted-foreground flex flex-1 items-center justify-center text-sm"
              role="status"
            >
              {t('help.loading')}
            </div>
          ) : activeDoc === null && queryTerms.length === 0 ? (
            <div
              className="text-muted-foreground flex flex-1 items-center justify-center text-sm"
              role="status"
            >
              {t('help.searchPrompt')}
            </div>
          ) : hits.length > 0 ? (
            <ul className="flex-1 overflow-y-auto p-2">
              {hits.map((hit, position) => (
                <li key={`${hit.docId}#${hit.sectionId}#${position}`}>
                  <button
                    type="button"
                    className="hover:bg-accent/50 mb-1 w-full rounded-md px-3 py-2 text-start"
                    onClick={() =>
                      setActiveDoc({
                        docId: hit.docId,
                        anchor: hit.sectionId,
                        terms: queryTerms,
                      })
                    }
                  >
                    <div className="text-muted-foreground truncate text-xs">
                      {hit.docTitle} · {hit.sectionTitle}
                    </div>
                    <div className="text-sm">
                      <MarkedText text={hit.snippet} terms={queryTerms} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : hits.length === 0 && activeDoc === null ? (
            <div
              className="text-muted-foreground flex flex-1 items-center justify-center text-sm"
              role="status"
            >
              {t('help.noResults', { query })}
            </div>
          ) : activeDocument !== null ? (
            <main
              ref={docViewport}
              className="flex-1 overflow-y-auto px-6 py-4"
            >
              <HelpMarkdown
                markdown={activeDocument.markdown}
                highlightTerms={activeDoc?.terms ?? []}
              />
            </main>
          ) : null}
        </div>
      </div>
    </div>
  )
}
