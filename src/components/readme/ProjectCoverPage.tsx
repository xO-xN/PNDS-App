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
 * The band is pinned ABSOLUTELY to the panel's bottom edge; its offset
 * and the header's top padding resolve the SAME --cover-edge-inset
 * token, so the band's gap to the window bottom equals the PNDS row's
 * gap to the window top by construction, not by matched constants.
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
      className="@container relative flex min-h-0 w-full flex-1 flex-col overflow-hidden [--cover-edge-inset:9.5cqh] [--cover-band-h:min(24.3cqh,40cqw)]"
    >
      {/* Header: diamond mark + wordmark, composer pill on the right.
          Its top padding is --cover-edge-inset — the ONE token that
          also pins the band at the bottom — so this row's gap to the
          window top and the band's gap to the window bottom are the
          same number. Change the token on the root, never one side. */}
      <div
        data-testid="cover-header"
        className="flex shrink-0 items-center justify-between px-[12.6cqw] pt-(--cover-edge-inset)"
      >
        <div className="flex items-center gap-[2.7cqw]">
          <DiamondMark palette={page.palette} />
          <span className="font-[family-name:Comfortaa] text-[2.9cqw] font-medium text-(--pnds-text)">
            PNDS
          </span>
        </div>
        {page.composer !== null && (
          <span
            data-testid="cover-composer"
            className="rounded-full bg-(--pnds-sidebar-bg) px-[2.7cqw] py-[1.2cqw] font-hans text-[2.4cqw] tracking-[0.25em] text-(--pnds-text) shadow-(--pnds-card-shadow)"
          >
            {page.composer}
          </span>
        )}
      </div>
      <div className="mx-[12.6cqw] mt-[4.4cqh] shrink-0 border-t border-(--pnds-text)/40" />

      {/* The title, anchored LOW: items-end plus a reserved bottom
          (edge inset + band height + gap) park it directly above the
          band, so it rides down with it (user direction: the title
          and the band move together). Its column is the hairline's
          width (same inset), its size caps against BOTH panel axes,
          and the tracking flexes to fit. */}
      <div className="flex min-h-0 flex-1 items-end overflow-hidden px-[12.6cqw] pt-[2cqh] pb-[calc(var(--cover-edge-inset)_+_var(--cover-band-h)_+_4.5cqh)]">
        <h1
          ref={titleRef}
          data-testid="cover-title"
          dir="auto"
          className="w-full text-center font-hans text-[min(16.8cqw,20.5cqh)] font-bold leading-[1.05] tracking-[0.37em] whitespace-nowrap text-(--pnds-text)"
        >
          {page.title}
        </h1>
      </div>

      {/* The band: ABSOLUTELY pinned to the panel's bottom edge at
          --cover-edge-inset — its gap to the window bottom is the
          token itself, independent of the flow above and of anything
          the panel grows around it. Its height is a frame share of
          the panel (capped so the square cover can never outgrow the
          band's width), the cover fills that height flush against the
          band's left edge, and the text column scrolls inside when
          the window is short. The panel's content ends here (the
          README's --- boundary). */}
      <div
        data-testid="cover-band"
        className="absolute bottom-(--cover-edge-inset) left-1/2 flex h-(--cover-band-h) w-[74.8cqw] -translate-x-1/2 gap-[5.9cqw] border border-(--pnds-text)/40"
      >
        {cover !== null && (
          <img
            data-testid="cover-image"
            src={cover}
            alt=""
            className="aspect-square h-full shrink-0 object-cover"
          />
        )}
        <div className="min-w-0 flex-1 overflow-y-auto py-[3.2cqh] pe-[5.5cqw]">
          <p
            data-testid="cover-label"
            className="font-hans text-[1.92cqw] font-[250] leading-[1.45] text-(--pnds-text)"
          >
            {page.sectionLabel}
          </p>
          <HelpMarkdown
            markdown={page.sectionMarkdown}
            className="mt-[3.65cqw] text-[1.92cqw] leading-[1.45] text-(--pnds-text) [&_li]:my-[0.5cqw] [&_p]:my-0 [&_ul]:my-[1cqw]"
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
 * TL→top, TR→right, BR→bottom, BL→left.
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
      className="relative block size-[4.6cqw] shrink-0"
    >
      <span className="absolute inset-0 rotate-45">
        {palette.map((color, index) => (
          <span
            key={index}
            className="absolute size-[42%] rounded-full"
            style={{ backgroundColor: color, ...corners[index] }}
          />
        ))}
      </span>
    </span>
  )
}
