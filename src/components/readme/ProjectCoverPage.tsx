import { useEffect, useRef } from 'react'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import type { ReadmeCoverPage } from '@/lib/readme-cover-page'

/**
 * v1.5.0 (README cover page): the creator-designed title page the main
 * area shows for the cover README format (the user's Frames 1/2,
 * mapped onto theme tokens so every theme carries it). Top to bottom:
 * the four-dot diamond mark in the project's palette beside the PNDS
 * wordmark, the composer pill, a hairline; the huge wide-tracked title;
 * and the bordered band — cover square left, the first section's label
 * and body right.
 *
 * Fluid layout (user report after the first build): the page FITS the
 * panel — never taller, never page-scrolling. Horizontal metrics track
 * the panel's width (cqw), vertical metrics its height (cqh), so every
 * element keeps its frame-relative position whichever axis the window
 * moves on; the title zone flexes to absorb the remainder, and the
 * band's text column scrolls INSIDE the band when the window is short.
 *
 * Neo-brutalist finish (the creator's declared style): full-strength
 * 2px rules, hard zero-blur offset shadows in the text token, squared
 * corners everywhere (the diamond's dots are squares — the app's own
 * Brutal theme squares the logo the same way), a solid accent block
 * for the composer pill, and an inverted text-token tag for the
 * section label. Every value still rides theme tokens, so Pond renders
 * the classic cream-and-black neubrutalist page and the dark themes
 * carry the same grammar inverted.
 *
 * The title is centered under the hairline's column, and its tracking
 * is the flexible variable: the design's 0.37em when it fits, squeezed
 * toward 0 for long titles, and only then does the type scale down —
 * measured imperatively (the style is the state; no React re-render),
 * re-run on panel resize.
 */
export function ProjectCoverPage({
  page,
  cover,
}: {
  page: ReadmeCoverPage
  /** The cover image as a data URL; null renders the band text-only. */
  cover: string | null
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const title = titleRef.current
    if (!title) return
    const fit = () => {
      // Back to the class values first (base size, 0.37em tracking),
      // then measure. The title is a block spanning its column, so
      // clientWidth IS the available width — the hairline's width.
      title.style.letterSpacing = ''
      title.style.fontSize = ''
      title.style.textIndent = ''
      const available = title.clientWidth
      if (available === 0) return
      // CSS letter-spacing lands after every glyph, including the
      // last — a same-size text-indent pulls that trailing space back
      // into the box so the centered text is optically centered.
      const em = Number.parseFloat(getComputedStyle(title).fontSize)
      if (Number.isNaN(em) || em === 0) return
      if (title.scrollWidth <= available) {
        title.style.textIndent = `${0.37 * em}px`
        return
      }
      // Too wide at the design tracking: measure the zero-tracking
      // width and spend whatever room is left on tracking.
      title.style.letterSpacing = '0px'
      const natural = title.scrollWidth
      const glyphs = [...(title.textContent ?? '')].length || 1
      if (natural <= available) {
        const spacing = Math.max(0, (available - natural) / glyphs)
        title.style.letterSpacing = `${spacing}px`
        title.style.textIndent = `${spacing}px`
        return
      }
      // Still too wide with no tracking at all: the type shrinks.
      title.style.fontSize = `${(em * available) / natural}px`
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(title)
    return () => observer.disconnect()
  }, [page.title])

  return (
    <div
      data-testid="project-cover-page"
      className="@container flex h-full w-full flex-col overflow-hidden"
    >
      {/* Header: diamond mark + wordmark, composer block on the right. */}
      <div className="flex shrink-0 items-center justify-between px-[12.6cqw] pt-[7.2cqh]">
        <div className="flex items-center gap-[2.2cqw]">
          <DiamondMark palette={page.palette} />
          <span className="font-(--pnds-font-ui) text-[3cqw] font-bold tracking-[0.04em] text-(--pnds-text)">
            PNDS
          </span>
        </div>
        {page.composer !== null && (
          <span
            data-testid="cover-composer"
            className="rounded-none border-2 border-(--pnds-text) bg-(--pnds-accent) px-[2.4cqw] py-[1.1cqw] font-hans text-[2.4cqw] font-bold tracking-[0.18em] text-(--pnds-accent-foreground) shadow-[0.3cqw_0.3cqw_0_var(--pnds-text)]"
          >
            {page.composer}
          </span>
        )}
      </div>
      <div className="mx-[12.6cqw] mt-[3.2cqh] shrink-0 border-t-2 border-(--pnds-text)" />

      {/* The title, centered in the open field between rule and band.
          Its column is the rule's width (same inset), its size caps
          against BOTH panel axes, and the tracking flexes to fit. */}
      <div className="flex min-h-0 flex-1 items-center overflow-hidden px-[12.6cqw] py-[3cqh]">
        <h1
          ref={titleRef}
          data-testid="cover-title"
          dir="auto"
          className="w-full text-center font-hans text-[min(17.2cqw,21cqh)] font-bold leading-[1.05] tracking-[0.37em] whitespace-nowrap text-(--pnds-text)"
        >
          {page.title}
        </h1>
      </div>

      {/* The band: its height is a frame share of the panel (capped so
          the square cover can never outgrow the band's width), the
          cover fills that height flush against the band's left edge,
          and the text column scrolls inside when the window is short.
          A card in the neubrutalist grammar: 2px rule, hard offset
          shadow, no radius. The panel's content ends here (the
          README's --- boundary). */}
      <div className="mx-auto mb-[9.5cqh] flex h-[min(26cqh,42cqw)] w-[74.8cqw] shrink-0 gap-[4.5cqw] border-2 border-(--pnds-text) bg-(--pnds-card) shadow-[0.55cqw_0.55cqw_0_var(--pnds-text)]">
        {cover !== null && (
          <img
            data-testid="cover-image"
            src={cover}
            alt=""
            className="aspect-square h-full shrink-0 border-e-2 border-(--pnds-text) object-cover"
          />
        )}
        <div className="min-w-0 flex-1 overflow-y-auto py-[3cqh] pe-[4.2cqw]">
          <p
            data-testid="cover-label"
            className="inline-block bg-(--pnds-text) px-[1.5cqw] py-[0.7cqh] font-hans text-[1.8cqw] font-semibold tracking-[0.08em] text-(--pnds-bg)"
          >
            {page.sectionLabel}
          </p>
          <HelpMarkdown
            markdown={page.sectionMarkdown}
            className="mt-[3cqw] text-[1.92cqw] leading-[1.45] text-(--pnds-text) [&_li]:my-[0.5cqw] [&_p]:my-0 [&_ul]:my-[1cqw]"
          />
        </div>
      </div>
    </div>
  )
}

/**
 * The four-dot diamond mark — the app logo's arrangement in the
 * project's own palette. Palette order is panel order (left, top,
 * right, bottom); the 45° rotation maps the unrotated corners
 * TL→top, TR→right, BR→bottom, BL→left. The dots are SQUARES — the
 * neubrutalist read of the mark, and exactly what the app's own
 * Brutal theme does to the logo (its global 0-radius rule).
 */
function DiamondMark({ palette }: { palette: readonly string[] }) {
  const corners = [
    { left: '0%', top: '58%' }, // BL — the left dot
    { left: '0%', top: '0%' }, // TL — the top dot
    { left: '58%', top: '0%' }, // TR — the right dot
    { left: '58%', top: '58%' }, // BR — the bottom dot
  ] as const
  return (
    <span
      data-testid="cover-diamond"
      aria-hidden
      className="relative block size-[5.2cqw] shrink-0"
    >
      <span className="absolute inset-0 rotate-45">
        {palette.map((color, index) => (
          <span
            key={index}
            className="absolute size-[42%] rounded-none"
            style={{ backgroundColor: color, ...corners[index] }}
          />
        ))}
      </span>
    </span>
  )
}
