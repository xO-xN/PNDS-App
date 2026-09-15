import { useEffect, useRef, type CSSProperties } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import { logger } from '@/lib/logger'
import type { ReadmeCoverPage } from '@/lib/readme-cover-page'
import { planTitleFit, refineTitleFit } from './title-fit'

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
 * The cq reference frames are split per axis, deliberately: the root
 * is an inline-size container (Tailwind `@container`) so every cqw
 * tracks the panel's width, while the block axis resolves against the
 * EMBEDDING — the projection's stage box carries
 * `[container-type:size]` (zoom-stable cq layout), and the README
 * panel has no size container, so its cqh falls back to the viewport.
 * That fallback is not a leak but the composition's approved original
 * look: a size-carrying root re-referenced every cqh to the p-8-inset
 * panel and shrank the whole vertical rhythm by roughly the chrome
 * share (user report: app 端的间距被扩大) — the stage box gives the
 * projection its stable frame without touching the panel's rendering.
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
  bandHeight,
  edgeInset,
  headerNote,
  centerBandText,
}: {
  page: ReadmeCoverPage
  /** The cover image as a data URL; null renders the band text-only. */
  cover: string | null
  /** Overrides the band's height token (`--cover-band-h`, default
   *  `min(26cqh,42cqw)`) for embeddings that want a roomier band — the
   *  projection screen (user request: 带内容上下增长、可容纳更多) passes
   *  a taller share; the title's open field shrinks by the same amount,
   *  so the title rides higher while the composition stays vertically
   *  centered. Keep the cqw cap when overriding — it bounds the square
   *  cover by the band's width. */
  bandHeight?: string
  /** Overrides the edge inset token (`--cover-edge-inset`, default
   *  `5cqh`) — the ONE number that pins both window-edge gaps (the
   *  header's top padding and the band's bottom offset) and feeds the
   *  title's bottom reserve. It is the honest lever for roomier title
   *  spacing: the title centers in its open field, so pt/pb overrides
   *  cannot widen the visible gaps (symmetric growth is absorbed by the
   *  centering slack; asymmetric growth merely shifts the
   *  midpoint), while a SMALLER inset lifts the header and drops the
   *  band by the same amount — the field grows 2Δ and each visible
   *  title gap grows Δ with the title still dead-center. The
   *  projection screen (user request: title 与上下两部分的间距增大)
   *  passes a tighter inset; the app panel passes nothing. */
  edgeInset?: string
  /** Plain-text pill on the header's RIGHT for pill-less pages — the
   *  utility intro's "PNDS Utility" tag (v1.5.0 polish; same pill
   *  background as the project cover's pills per the follow-up
   *  report). Renders only when the page carries neither a composer
   *  pill nor a github button. */
  headerNote?: string
  /** Centers the band's text column (both axes) instead of the
   *  document-flow start alignment — the utility intro's one-liner
   *  (follow-up report: 上下左右居中). A column that overflows still
   *  auto-scrolls; centered text that fits never moves. */
  centerBandText?: boolean
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
    // v1.5.0 (projection user report: 某比例下 title 字间距突然过大且
    // 溢出): the old fit measured `title.scrollWidth/clientWidth`, but a
    // centered nowrap flex child clamps BOTH to its own box in WebKit —
    // design width, zero-tracking width and "available" all read back
    // the SAME number, so the branch decision was effectively random per
    // proportion (a false "fits at 0.37em" rendered with huge tracking
    // and real overflow). Honest measurements instead: available comes
    // from the ZONE's content box (never shaped by the title's own
    // styles), and the rendered text width from a Range — immune to the
    // box feedback (min-width:auto) and scrollWidth clamping. The branch
    // math lives in planTitleFit (pure, unit-tested).
    //
    // v1.5.0 polish (projection report round two: title 不居中、字距大且
    // 右溢): the model's inputs are still measurements taken before the
    // plan applies, and any of them can lie in the wild — a fit that
    // ran while the projection webview was still HIDDEN (anti-flash
    // boot), a font swap between probes, the union rect's unaccounted
    // trailing space. The fit therefore no longer trusts its own first
    // verdict: after applying the plan it RE-MEASURES the rendered line
    // against the column's real edges and refines (refineTitleFit,
    // bounded passes) until the truth fits, then corrects the centering
    // from measured geometry — the exact offset between the glyph run's
    // center and the column's center, which absorbs every engine
    // trailing-space semantic instead of guessing an indent model.
    const fit = () => {
      const zone = title.parentElement
      if (zone === null) return
      // Back to the class values first (base size, 0.37em tracking),
      // then measure.
      title.style.letterSpacing = ''
      title.style.fontSize = ''
      title.style.textIndent = ''
      title.style.transform = ''
      const zoneStyle = getComputedStyle(zone)
      const padLeft = Number.parseFloat(zoneStyle.paddingLeft)
      const padRight = Number.parseFloat(zoneStyle.paddingRight)
      const available = zone.clientWidth - padLeft - padRight
      if (Number.isNaN(available) || available <= 0) return
      const em = Number.parseFloat(getComputedStyle(title).fontSize)
      if (Number.isNaN(em) || em === 0) return
      const textRect = () => {
        const range = document.createRange()
        range.selectNodeContents(title)
        return range.getBoundingClientRect()
      }
      // The rendered width per 1px of letter-spacing is MEASURED, not
      // counted: the ripple wraps each glyph in a span and the spacing
      // lands inside the span AND after its box (a spanned "Splash Ink"
      // bills 19 units, not its 10 characters — counting glyphs made
      // every squeeze underfill and overflow by the difference).
      const widthAt = (spacing: string) => {
        title.style.letterSpacing = spacing
        return textRect().width
      }
      const designWidth = widthAt('')
      const zeroWidth = widthAt('0px')
      const unitSlope = (widthAt('100px') - zeroWidth) / 100
      // Degenerate inputs (all-zero rects before the webview ever laid
      // out — jsdom, a hidden boot): commit NOTHING (the class baseline
      // stands) and let the next trigger refit, instead of freezing a
      // garbage verdict no later event would correct.
      if (
        !(designWidth > 0) ||
        !(zeroWidth > 0) ||
        !(unitSlope > 0) ||
        zeroWidth > designWidth
      ) {
        return
      }
      let plan = planTitleFit({
        available,
        em,
        designWidth,
        zeroWidth,
        unitSlope,
      })
      const apply = (next: typeof plan) => {
        plan = next
        title.style.letterSpacing = next.letterSpacing
        if (next.fontSize !== undefined) title.style.fontSize = next.fontSize
        title.style.textIndent = next.textIndent
      }
      apply(plan)
      // Measured-truth convergence: the rendered rect against the
      // column's edges (both visual coordinates — transform-safe on the
      // projection's stage). Width first, then the centering offset.
      for (let pass = 0; pass < 3; pass += 1) {
        const rect = textRect()
        const zoneRect = zone.getBoundingClientRect()
        const columnLeft = zoneRect.left + padLeft
        const columnRight = zoneRect.right - padRight
        const overflow = Math.max(
          rect.right - columnRight,
          columnLeft - rect.left
        )
        if (overflow > 0.5) {
          apply(
            refineTitleFit({
              plan,
              overflow,
              em: Number.parseFloat(getComputedStyle(title).fontSize) || em,
              unitSlope,
            })
          )
          continue
        }
        const centerError =
          (columnLeft + columnRight) / 2 - (rect.left + rect.right) / 2
        if (Math.abs(centerError) > 1) {
          // NOT via text-indent: on a centered line an indent shifts
          // the glyphs by only HALF its value (the line recenters in
          // the remaining space — CSS22 §16.1), so an indent-based
          // correction would leave half the error standing, glaring at
          // the projection's font scale. translateX is 1:1 in visual
          // coordinates — exactly the space the error was measured in.
          title.style.transform = `translateX(${centerError}px)`
        }
        break
      }
    }
    fit()
    // Webfonts swap in AFTER first paint and nothing about the BOX
    // changes with the swap (the font-size is cq-based, the line-height
    // unitless) — the ResizeObserver stays silent while the metrics
    // change under it, and a fit decided on fallback metrics sticks
    // (projection report: 某比例下 0.37em 决定 + 真字体溢出). Refit on
    // EVERY font-load batch; fonts.ready alone is racy (it can resolve
    // before a late webfont request even starts).
    const refit = () => {
      if (titleRef.current === title) fit()
    }
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener('loadingdone', refit)
      void document.fonts.ready.then(refit).catch(() => undefined)
    }
    // The projection window boots HIDDEN (#51 anti-flash) and reveals
    // after its first snapshot: a fit measured before the webview was
    // ever on screen can land on pre-layout values, and nothing else
    // fires afterwards (the box never changes size, the fonts were
    // already settled) — the wrong verdict would stick for the whole
    // session (projection report round two). Refit at reveal.
    const onVisibility = () => {
      if (!document.hidden) refit()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    // Observe the ZONE, never the title itself: once the nowrap text's
    // min-content width matches the column, the h1's own box stops
    // tracking container changes and an h1 observer goes silent exactly
    // when a refit is needed (projection report: spacing frozen at one
    // width's squeeze value while the window kept resizing).
    observer?.observe(title.parentElement ?? title)
    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      if (typeof document !== 'undefined' && document.fonts) {
        document.fonts.removeEventListener('loadingdone', refit)
      }
    }
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
      className="@container relative flex min-h-0 w-full flex-1 flex-col overflow-hidden [--cover-edge-inset:5cqh] [--cover-band-h:min(26cqh,42cqw)]"
      // An embedding's overrides ride the SAME tokens as the class
      // defaults — the title zone's bottom reserve reads both
      // variables, so the whole composition re-balances around them.
      style={
        bandHeight !== undefined || edgeInset !== undefined
          ? ({
              ...(bandHeight !== undefined
                ? { '--cover-band-h': bandHeight }
                : {}),
              ...(edgeInset !== undefined
                ? { '--cover-edge-inset': edgeInset }
                : {}),
            } as CSSProperties)
          : undefined
      }
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
          {page.composer === null &&
            githubUrl === null &&
            headerNote !== undefined && (
              // The pill-less corner's tag (v1.5.0 polish + follow-up:
              // the user asked for the SAME pill background the project
              // cover's pills carry) — the utility intro's "PNDS
              // Utility" (brand label, verbatim like the wordmark).
              <span data-testid="cover-header-note" className={pillClass}>
                {headerNote}
              </span>
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
            : titleGlyphs(page.title).map((glyph, index, all) => {
                if (glyph === ' ') return ' '
                // One crest reads as ONE crest only while the glyphs'
                // phase spread stays a small slice of the cycle: a
                // fixed per-glyph step on a long title (the utility
                // aliases' 15+ letters) smears across half the 5.2s
                // period and the wave dissolves into random bobbing
                // (user report: 波浪运动顺序杂乱). The step therefore
                // normalizes by the glyph count — short titles keep
                // the original 0.16s cadence, long ones cap the TOTAL
                // spread at 0.8s (≈15% of the cycle).
                const spread = Math.min(0.16 * Math.max(0, all.length - 1), 0.8)
                const step = all.length > 1 ? spread / (all.length - 1) : 0
                return (
                  <span
                    // The title rides the key: an index-keyed span is
                    // REUSED when the selection moves to another work
                    // and its CSS animation never restarts — it keeps
                    // the start time of the work that created it, while
                    // spans for newly-reached indexes start NOW. A few
                    // selections later the elements' timelines have
                    // skewed arbitrarily and the wave reads as chaos
                    // (user report: 多选几次不同的工程，逐渐变杂乱). A
                    // fresh element set per title keeps every glyph on
                    // ONE shared timeline.
                    key={`${page.title}:${index}`}
                    aria-hidden="true"
                    className="cover-title-glyph"
                    style={{ animationDelay: `${-(step * index)}s` }}
                  >
                    {glyph}
                  </span>
                )
              })}
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
          className={
            centerBandText
              ? // The utility one-liner rides centered on both axes —
                // flex centering of the inner layer; the column keeps
                // its overflow/auto-scroll contract for the day a
                // translation outgrows it.
                'cover-band-text flex min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto py-[3.2cqh] text-center'
              : 'cover-band-text min-w-0 flex-1 overflow-y-auto py-[3.2cqh] pe-[5.5cqw]'
          }
        >
          <div ref={rollInnerRef} className="will-change-transform">
            {page.sectionLabel !== '' && (
              <p
                data-testid="cover-label"
                className="font-hans text-[1.92cqw] font-[250] leading-[1.45] text-(--pnds-text)"
              >
                {page.sectionLabel}
              </p>
            )}
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

/**
 * Connected scripts (Arabic et al.) must never be split per glyph —
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
