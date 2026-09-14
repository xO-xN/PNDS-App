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
 * Every size is a container-query percentage of the panel (the frames'
 * proportions: 350px type on a 2080px panel → 16.8cqw), so the
 * composition scales with the window exactly as the mock does. The
 * design's fixed light values become tokens — text on --pnds-text,
 * rules at 40% text, the pill on --pnds-sidebar-bg with the theme's
 * card shadow — so Pond renders the frames verbatim and the dark
 * themes get the same page in their own palette.
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
  const zoneRef = useRef<HTMLDivElement>(null)

  // The 0.37em tracking makes long titles overflow a narrow panel, and
  // the composition is single-line — so the type scales down to fit.
  // Measured imperatively on the DOM (the style is the state; no React
  // re-render), re-run when the panel resizes.
  useEffect(() => {
    const title = titleRef.current
    const zone = zoneRef.current
    if (!title || !zone) return
    const fit = () => {
      // Back to the cqw class size first, then measure the natural
      // width at that size.
      title.style.fontSize = ''
      const available = zone.clientWidth
      if (available === 0) return
      const needed = title.scrollWidth
      if (needed <= available) return
      const base = Number.parseFloat(getComputedStyle(title).fontSize)
      if (Number.isNaN(base) || base === 0) return
      title.style.fontSize = `${(base * available) / needed}px`
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(zone)
    return () => observer.disconnect()
  }, [page.title])

  return (
    <div
      data-testid="project-cover-page"
      className="@container flex min-h-full w-full flex-col"
    >
      {/* Header: diamond mark + wordmark, composer pill on the right. */}
      <div className="flex items-center justify-between px-[12.6cqw] pt-[9.5cqw]">
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
      <div className="mx-[12.6cqw] mt-[4.4cqw] border-t border-(--pnds-text)/40" />

      {/* The title, centered in the open field between rule and band. */}
      <div
        ref={zoneRef}
        className="flex min-h-0 flex-1 items-center px-[12.6cqw] py-[4cqw]"
      >
        <h1
          ref={titleRef}
          data-testid="cover-title"
          dir="auto"
          className="font-hans text-[16.8cqw] font-bold leading-[1.05] tracking-[0.37em] whitespace-nowrap text-(--pnds-text)"
        >
          {page.title}
        </h1>
      </div>

      {/* The band: cover square left, the first section's label and
          body right — the panel's content ends here (the README's ---
          boundary). */}
      <div className="mx-auto mb-[12cqw] flex w-[74.8cqw] items-start gap-[5.9cqw] border border-(--pnds-text)/40">
        {cover !== null && (
          <img
            data-testid="cover-image"
            src={cover}
            alt=""
            className="aspect-square w-[20cqw] shrink-0 object-cover"
          />
        )}
        <div className="min-w-0 flex-1 py-[2.6cqw] pe-[5.5cqw]">
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
