import { useEffect, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import { PreflightDock } from '@/components/shell/PreflightDock'
import { Button } from '@/components/ui/button'
import {
  readProjectCover,
  readProjectReadme,
  resolveProjectReadmeLink,
  type ProjectReadmeRead,
} from '@/lib/project-readme'
import { parseReadmeCoverPage } from '@/lib/readme-cover-page'
import { openHelpWindow } from '@/lib/help-window'
import { logger } from '@/lib/logger'
import { ProjectCoverPage } from './ProjectCoverPage'

/**
 * v1.5.0 (#125): the project's root README.md in the main area — the
 * optional, author-written document the README routing shows when the
 * project's card is selected. The renderer is the help center's
 * HelpMarkdown (react-markdown + GFM; raw HTML never renders), so a
 * README renders exactly like the corpus. Reused as-is from help — no
 * decoupling was needed: the component is prop-driven (markdown +
 * className) with no help-window coupling.
 *
 * User report after #127: the read is locale-aware — a project shipping
 * `README.<locale>.md` serves the App's UI-language variant, falling
 * back to the plain `README.md` — and a language switch re-reads, so
 * the panel follows the UI. Links inside the README NEVER navigate the
 * main webview: external URLs leave via the system browser, relative
 * references (a `[中文](README.zh-CN.md)` switcher, hand file links)
 * are dead no-ops — a stray navigation once stranded the whole app on
 * the raw file.
 *
 * The read re-runs when the selection moves to another path; while it
 * is in flight the panel keeps its frame (and dock) and renders no
 * content — the IPC read is fast. No README (or an unreadable one —
 * the wrapper logs and lands here too) is the empty state, pointing at
 * the writing rules in Help (the "Writing a Project README" chapter,
 * added by #127; the structure reference carries the contract).
 *
 * v1.5.0 (README cover page): a README in the creator's cover format
 * (metadata block + first section, see lib/readme-cover-page) renders
 * as the designed title page instead of the document view —
 * ProjectCoverPage composes it; every other README keeps rendering
 * exactly as before.
 */
export function ProjectReadme({ path }: { path: string }) {
  const { t, i18n } = useTranslation()
  // The registered tag ("en" / "zh-CN") — drives the README variant the
  // backend picks; useTranslation re-renders on languageChanged, so the
  // dependency below stays live.
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // The last completed read, keyed by the path AND locale it belongs
  // to: a change of either renders as "still reading" (no content)
  // until the new read lands — no synchronous reset inside the effect,
  // and neither the empty state nor the read-failure state ever flashes
  // mid-flight.
  const [loaded, setLoaded] = useState<{
    path: string
    locale: string
    read: ProjectReadmeRead
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void readProjectReadme(path, locale).then(read => {
      if (!cancelled) setLoaded({ path, locale, read })
    })
    return () => {
      cancelled = true
    }
  }, [path, locale])

  const settled =
    loaded !== null && loaded.path === path && loaded.locale === locale
  const read = settled ? loaded.read : null

  // v1.5.0 (README cover page): a README in the creator's cover format
  // (metadata block + first section) renders as the designed title
  // page; anything else stays the legacy document view. The parse is
  // pure — an unparseable README is simply "not the format".
  const coverPage =
    settled && read !== null && read.readme !== null
      ? parseReadmeCoverPage(read.readme)
      : null
  const wantsCover = coverPage !== null

  // The band's cover image, keyed by path (a cover is
  // locale-independent — one fetch per selected project, only when the
  // format actually wants one). Same keyed-state pattern as `loaded`:
  // no synchronous reset, no stale image across selections.
  const [coverLoaded, setCoverLoaded] = useState<{
    path: string
    cover: string | null
  } | null>(null)

  useEffect(() => {
    if (!wantsCover) return
    let cancelled = false
    void readProjectCover(path).then(result => {
      if (!cancelled) setCoverLoaded({ path, cover: result.cover })
    })
    return () => {
      cancelled = true
    }
  }, [path, wantsCover])

  const coverImage =
    coverLoaded !== null && coverLoaded.path === path ? coverLoaded.cover : null

  // One interception at the panel root: no anchor click ever reaches the
  // webview's default navigation. External URLs hand off to the system
  // browser; everything else no-ops.
  const onRootClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor) return
    event.preventDefault()
    const target = resolveProjectReadmeLink(anchor.getAttribute('href') ?? '')
    if (target?.kind === 'external') {
      // Same failure posture as the help center's link handoff — a
      // browser that refuses to open logs, it never rejects unhandled.
      openUrl(target.url).catch((error: unknown) => {
        logger.warn('Failed to open a README link in the browser', { error })
      })
    }
  }

  // The cover format's root is EDGE-ANCHORED, not flowed: it pins
  // absolutely to <main> (relative), so its box IS the panel's box — a
  // definite height with zero percentage-height links. The flow-based
  // min-h-full stretch proved unreliable in the webview (the chain can
  // collapse to content height, which pins the band's absolute bottom
  // to a folded root — the band hangs mid-window).
  if (coverPage !== null) {
    return (
      <div
        data-testid="project-readme"
        onClick={onRootClick}
        className="absolute inset-0 flex flex-col bg-(--pnds-bg) p-8 animate-[fade-in_0.8s_ease-in]"
      >
        <ProjectCoverPage page={coverPage} cover={coverImage} />
        <PreflightDock />
      </div>
    )
  }

  return (
    <div
      data-testid="project-readme"
      onClick={onRootClick}
      className="relative flex min-h-full flex-col bg-(--pnds-bg) p-8 animate-[fade-in_0.8s_ease-in]"
    >
      {settled && read !== null && read.error !== null ? (
        // A README that exists but cannot be served (oversized, invalid
        // UTF-8, unreadable) — a readable failure, never dressed up as
        // "there is none".
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center">
          <p className="text-[15px] text-(--pnds-text)/50">
            {t('projectReadme.readFailed')}
          </p>
          <p className="font-manrope mt-2 max-w-full overflow-wrap-anywhere text-start text-sm whitespace-pre-wrap text-(--pnds-text)/70">
            {read.error}
          </p>
        </div>
      ) : settled && read !== null && read.readme === null ? (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center">
          <p className="text-[15px] text-(--pnds-text)/50">
            {t('projectReadme.empty')}
          </p>
          <Button
            variant="link"
            className="mt-2 self-start px-0"
            onClick={() =>
              void openHelpWindow({ kind: 'doc', docId: 'readme-guide' })
            }
          >
            {t('projectReadme.writingRules')}
          </Button>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-2xl flex-1 pb-16 text-(--pnds-text)">
          <HelpMarkdown markdown={read?.readme ?? ''} />
        </div>
      )}
      <PreflightDock />
    </div>
  )
}
