import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import { PreflightDock } from '@/components/shell/PreflightDock'
import { Button } from '@/components/ui/button'
import { resolveProjectReadmeLink } from '@/lib/project-readme'
import { openHelpWindow } from '@/lib/help-window'
import { logger } from '@/lib/logger'
import { ProjectCoverPage } from './ProjectCoverPage'
import type { ProjectReadmePreview } from './project-readme-preview'

/**
 * v1.5.0 (#125): the project's root README.md in the main area — the
 * optional, author-written document the README routing shows when the
 * project's card is selected. Ordinary documents use the help center's
 * HelpMarkdown (react-markdown + GFM; raw HTML never renders). Covers
 * use the dedicated, non-interactive audience renderer. Reused as-is from help — no
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
 * v1.5.0 (README cover page): a README in the creator's cover format
 * (metadata block + first section, see lib/readme-cover-page) renders
 * as the designed title page instead of the document view —
 * ProjectCoverPage composes it; every other README keeps rendering
 * exactly as before.
 */
export function ProjectReadme({
  preview: read,
}: {
  preview: ProjectReadmePreview | null
}) {
  const { t } = useTranslation()
  const coverPage = read?.coverPage

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
  if (coverPage) {
    return (
      <div
        data-testid="project-readme"
        onClick={onRootClick}
        className="readme-cover-host absolute inset-0 flex flex-col"
      >
        <ProjectCoverPage page={coverPage} cover={read.cover} />
        <PreflightDock />
      </div>
    )
  }

  return (
    <div
      data-testid="project-readme"
      onClick={onRootClick}
      className="performance-reading-surface relative flex min-h-full flex-col bg-(--pnds-bg) p-8"
    >
      {read !== null && read.error !== null ? (
        // A README that exists but cannot be served (oversized, invalid
        // UTF-8, unreadable) — a readable failure, never dressed up as
        // "there is none".
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center">
          <p className="text-[15px] text-(--pnds-text-secondary)">
            {t('projectReadme.readFailed')}
          </p>
          <p className="font-manrope mt-2 max-w-full overflow-wrap-anywhere text-start text-sm whitespace-pre-wrap text-(--pnds-text-secondary)">
            {read.error}
          </p>
        </div>
      ) : read !== null && read.readme === null ? (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center">
          <p className="text-[15px] text-(--pnds-text-secondary)">
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
