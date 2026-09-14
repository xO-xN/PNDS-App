import { useEffect, useRef } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import { logger } from '@/lib/logger'
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
 * The composer and github pills are buttons when their README URL
 * metadata (composer_url / github_url, http(s) only) parsed — a click
 * hands off to the system browser, never the webview.
 *
 * The root is a true SIZE container (`container-type: size`), NOT
 * Tailwind's `@container` (inline-size only): with inline-size, every
 * cqh unit silently falls back to the SMALL VIEWPORT, and the two
 * reference frames diverge the moment the panel isn't the viewport —
 * inside the projection window's zoom frame the cqw-scaled column kept
 * a viewport-sized font, so the title's fit squeezed its tracking in
 * jumps and overflowed, and the band (26cqh of the viewport) overran
 * the panel's bottom (user report: 字间距突变、内容超出窗口). Size
 * containment needs a definite-height parent — both embeddings give it
 * one (the README panel's absolute box, the projection's stage frame).
 * The title is centered under the hairline's column, and its tracking
 * is the flexible variable: the design's 0.37em when it fits, squeezed
 * toward 0 for long titles, and only then does the type scale down —
 * measured imperatively (the style is the state; no React re-render),
 * re-run on panel resize. The glyphs each carry a slow, staggered
 * ripple (see .cover-title-glyph in App.css) — one gentle crest
 * traveling across the word; joined-script titles stay whole.
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
  // Destructured so the null-guards below narrow inside the click
  // closures too (property narrowing doesn't survive into callbacks).
  const { composerUrl, githubUrl } = page

  // The header's link pills share one shape; a pill only becomes a
  // button when the README gave it an http(s) URL.
  const pillClass =
    'rounded-full bg-(--pnds-sidebar-bg) px-[2cqw] py-[0.9cqw] font-hans text-[1.8cqw] tracking-[0.1em] text-(--pnds-text) shadow-(--pnds-card-shadow)'
  const openExternal = (url: string) => {
    // Same failure posture as the README panel's link handoff — a
    // browser that refuses to open logs, it never rejects unhandled.
    openUrl(url).catch((error: unknown) => {
      logger.warn('Failed to open a cover link in the browser', { error })
    })
  }

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

  // The band's text auto-scrolls in the reading direction when the
  // section outgrows the band — real scrollTop on a native (hidden
  // scrollbar) overflow column, so the WHEEL can take over at any
  // moment: any wheel/pointer touch pauses the auto-drive for a beat
  // (RESUME_MS of idleness) and then it continues from wherever the
  // reader left it. One pass: crawl down, hold at the bottom, restart
  // at the top. A section that fits never moves; reduced-motion never
  // auto-drives (the wheel still works).
  const bandColumnRef = useRef<HTMLDivElement>(null)
  const rollInnerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const column = bandColumnRef.current
    const inner = rollInnerRef.current
    if (!column || !inner) return
    const SPEED_PX_PER_S = 12
    const HOLD_MS = 3500
    const RESUME_MS = 2500
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    let lastUser = -Infinity
    let arrivedAt = performance.now()
    let raf = 0
    let last = performance.now()
    // WebKit quantizes scrollTop to whole pixels: a per-frame +0.2px
    // write would truncate back to the same integer forever and the
    // crawl would never move. The float position lives HERE; every
    // frame writes the absolute value.
    let pos = 0
    const markUser = () => {
      lastUser = performance.now()
    }
    column.addEventListener('wheel', markUser, { passive: true })
    column.addEventListener('pointerdown', markUser, { passive: true })

    const step = (now: number) => {
      // Clamp the frame delta so a backgrounded tab doesn't teleport.
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const range = column.scrollHeight - column.clientHeight
      if (range > 1 && now - lastUser > RESUME_MS) {
        // An external jump (the reader's wheel) bigger than our own
        // drift resyncs the accumulator to their position; ordinary
        // quantization loss (fractions of a pixel) does not.
        if (Math.abs(column.scrollTop - Math.floor(pos)) > 1.5) {
          pos = column.scrollTop
        }
        const atTop = pos <= 0.5
        const atBottom = pos >= range - 0.5
        if (atTop || atBottom) {
          if (now - arrivedAt >= HOLD_MS) {
            pos = atBottom
              ? 0 // The pass ends — restart it from the top.
              : Math.min(1.5, range) // clear of WebKit's quantization
            arrivedAt = now
          }
        } else {
          pos = Math.min(pos + SPEED_PX_PER_S * dt, range)
          if (pos >= range - 0.5) arrivedAt = now
        }
        // WebKit quantizes scrollTop to whole pixels, and a crawl of a
        // few px/s would step 1px at a time — visible judder. The
        // integer part rides scrollTop (the wheel stays native); the
        // subpixel remainder rides a transform on the inner layer,
        // composited smoothly between the steps.
        column.scrollTop = Math.floor(pos)
        inner.style.transform = `translateY(${-(pos - Math.floor(pos))}px)`
      } else {
        // The reader holds the wheel — drop our offset entirely.
        inner.style.transform = ''
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      column.removeEventListener('wheel', markUser)
      column.removeEventListener('pointerdown', markUser)
    }
  }, [page.sectionMarkdown, page.sectionLabel])

  return (
    <div
      data-testid="project-cover-page"
      className="[container-type:size] relative flex min-h-0 w-full flex-1 flex-col overflow-hidden [--cover-edge-inset:5cqh] [--cover-band-h:min(26cqh,42cqw)]"
    >
      {/* Header: diamond mark + wordmark left; the composer and github
          pills right (a pill is a button only when its URL metadata
          parsed; the click hands off to the system browser). The row's
          top padding is --cover-edge-inset — the ONE token that also
          pins the band at the bottom — so this row's gap to the window
          top and the band's gap to the window bottom are the same
          number. Change the token on the root, never one side. */}
      <div
        data-testid="cover-header"
        className="flex shrink-0 items-center justify-between px-[8cqw] pt-(--cover-edge-inset)"
      >
        <div className="flex items-center gap-[2cqw]">
          <DiamondMark palette={page.palette} />
          <span className="font-[family-name:Comfortaa] text-[2.2cqw] font-medium text-(--pnds-text)">
            PNDS
          </span>
        </div>
        <div className="flex items-center gap-[1.6cqw]">
          {page.composer !== null &&
            (composerUrl !== null ? (
              <button
                type="button"
                data-testid="cover-composer"
                className={`cursor-pointer ${pillClass}`}
                onClick={() => openExternal(composerUrl)}
              >
                {page.composer}
              </button>
            ) : (
              <span data-testid="cover-composer" className={pillClass}>
                {page.composer}
              </span>
            ))}
          {githubUrl !== null && (
            <button
              type="button"
              data-testid="cover-github"
              className={`cursor-pointer ${pillClass}`}
              onClick={() => openExternal(githubUrl)}
            >
              github
            </button>
          )}
        </div>
      </div>
      <div className="mx-[8cqw] mt-[4.4cqh] shrink-0 border-t border-(--pnds-text)/40" />

      {/* The title, vertically CENTERED in the open field between the
          hairline and the band: the zone's bottom reserve (edge inset
          + band height + gap) excludes the band's footprint, so
          items-center centers on the true open field, never over the
          band. Its column is the hairline's width (same inset), its
          size caps against BOTH panel axes, and the tracking flexes
          to fit. */}
      <div className="flex min-h-0 flex-1 items-center overflow-hidden px-[8cqw] pt-[2cqh] pb-[calc(var(--cover-edge-inset)_+_var(--cover-band-h)_+_4.5cqh)]">
        <h1
          ref={titleRef}
          data-testid="cover-title"
          dir="auto"
          aria-label={page.title}
          className="w-full text-center font-hans text-[min(16.8cqw,20.5cqh)] font-bold leading-[1.05] tracking-[0.37em] whitespace-nowrap text-(--pnds-text)"
        >
          {JOINED_SCRIPT.test(page.title)
            ? page.title
            : titleGlyphs(page.title).map((glyph, index) =>
                glyph === ' ' ? (
                  ' '
                ) : (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="cover-title-glyph"
                    style={{ animationDelay: `${-(index * 0.16)}s` }}
                  >
                    {glyph}
                  </span>
                )
              )}
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
        className="absolute bottom-(--cover-edge-inset) left-1/2 flex h-(--cover-band-h) w-[84cqw] -translate-x-1/2 gap-[5.9cqw] border border-(--pnds-text)/40"
      >
        {cover !== null && (
          <img
            data-testid="cover-image"
            src={cover}
            alt=""
            className="aspect-square h-full shrink-0 object-cover"
          />
        )}
        <div
          ref={bandColumnRef}
          data-testid="cover-band-text"
          className="cover-band-text min-w-0 flex-1 overflow-y-auto py-[3.2cqh] pe-[5.5cqw]"
        >
          <div ref={rollInnerRef} className="will-change-transform">
            <p
              data-testid="cover-label"
              className="font-hans text-[1.92cqw] font-[250] leading-[1.45] text-(--pnds-text)"
            >
              {page.sectionLabel}
            </p>
            <HelpMarkdown
              markdown={page.sectionMarkdown}
              className="text-[1.92cqw] leading-[1.45] text-(--pnds-text) [&_li]:my-[0.5cqw] [&_p]:my-0 [&_ul]:my-[1cqw]"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Connected scripts (Arabic et al.) must never be split per glyph —
 * the letters would come apart. */
const JOINED_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/

/** Graphemes, not code points — a combining mark must ride its base
 * glyph into its own ripple span. */
function titleGlyphs(title: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
        title
      ),
    ].map(part => part.segment)
  }
  return [...title]
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
      className="relative block size-[3.4cqw] shrink-0"
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
