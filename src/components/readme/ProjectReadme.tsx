import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import { PreflightDock } from '@/components/shell/PreflightDock'
import { Button } from '@/components/ui/button'
import { readProjectReadme, type ProjectReadmeRead } from '@/lib/project-readme'
import { openHelpWindow } from '@/lib/help-window'

/**
 * v1.5.0 (#125): the project's root README.md in the main area — the
 * optional, author-written document the README routing shows when the
 * project's card is selected. The renderer is the help center's
 * HelpMarkdown (react-markdown + GFM; raw HTML never renders), so a
 * README renders exactly like the corpus. Reused as-is from help — no
 * decoupling was needed: the component is prop-driven (markdown +
 * className) with no help-window coupling.
 *
 * The read re-runs when the selection moves to another path; while it
 * is in flight the panel keeps its frame (and dock) and renders no
 * content — the IPC read is fast. No README (or an unreadable one —
 * the wrapper logs and lands here too) is the empty state, pointing at
 * the writing rules in Help (the "Writing a Project README" chapter,
 * added by #127; the structure reference carries the contract).
 */
export function ProjectReadme({ path }: { path: string }) {
  const { t } = useTranslation()
  // The last completed read, keyed by the path it belongs to: a prop
  // change renders as "still reading" (no content) until the new read
  // lands — no synchronous reset inside the effect, and neither the
  // empty state nor the read-failure state ever flashes mid-flight.
  const [loaded, setLoaded] = useState<{
    path: string
    read: ProjectReadmeRead
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void readProjectReadme(path).then(read => {
      if (!cancelled) setLoaded({ path, read })
    })
    return () => {
      cancelled = true
    }
  }, [path])

  const settled = loaded !== null && loaded.path === path
  const read = settled ? loaded.read : null

  return (
    <div
      data-testid="project-readme"
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
