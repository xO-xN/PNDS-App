import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { ReadmeCoverPage } from '@/lib/readme-cover-page'
import { CoverMarkdown } from './CoverMarkdown'
import { coverFogColors } from './cover-colors'
import { attachCoverFrame } from './cover-frame'
import { attachCoverIntroFit } from './cover-intro-fit'
import { attachCoverTitleFit } from './title-fit'
import './cover-page.css'

export type CoverEditableField =
  | 'title'
  | 'composer'
  | 'duration'
  | 'performers'
  | 'contact'
  | 'color_palette'
  | 'sectionLabel'
  | 'sectionMarkdown'

/** The approved 1200 × 800 artwork, shared by performance, projection and
 * inline creation editing. Window geometry changes only the whole-canvas scale. */
export function ProjectCoverPage({
  page,
  cover,
  surface = 'app',
  zoom = 100,
  headerNote,
  centerBandText,
  renderEditor,
  editorActive = false,
}: {
  page: ReadmeCoverPage
  cover: string | null
  surface?: 'app' | 'projection'
  zoom?: number
  headerNote?: string
  centerBandText?: boolean
  editorActive?: boolean
  renderEditor?: (field: CoverEditableField) => ReactNode
}) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLElement>(null)
  const markdownRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const stage = stageRef.current
    if (viewport && stage) return attachCoverFrame(viewport, stage, zoom)
  }, [zoom])

  useLayoutEffect(() => {
    const title = titleRef.current
    if (title) return attachCoverTitleFit(title, -0.055)
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
    if (!column || !inner || editorActive) return
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
  }, [page.sectionMarkdown, page.sectionLabel, editorActive])

  useLayoutEffect(() => {
    const stage = stageRef.current
    const region = bandRef.current
    const column = bandColumnRef.current
    const copy = rollInnerRef.current
    const body = markdownRef.current
    if (stage && region && column && copy && body)
      return attachCoverIntroFit({
        stage,
        region,
        column,
        copy,
        body,
        maximum: 18,
        minimum: 15,
      })
  }, [page.sectionMarkdown, page.sectionLabel, cover, surface])

  const [primary, mid] = coverFogColors(page.palette)
  const composer = page.composer?.replace(/^@\s*/, '').trim()
  const metadata = [
    {
      field: 'composer',
      label: 'author',
      value: composer === 'PNDS' ? t('projectReadme.cover.brand') : composer,
    },
    { field: 'duration', label: 'duration', value: page.duration },
    { field: 'performers', label: 'performers', value: page.performers },
    { field: 'contact', label: 'contact', value: page.contact },
  ] as const

  return (
    <div
      ref={viewportRef}
      data-testid="project-cover-page"
      data-surface={surface}
      data-has-cover={cover !== null}
      className="project-cover-page"
      style={
        {
          '--cover-fog-primary': primary,
          '--cover-fog-mid': mid,
          '--cover-zoom': zoom / 100,
        } as CSSProperties
      }
    >
      <div
        ref={stageRef}
        data-testid="cover-content-stage"
        className="cover-content-stage"
      >
        <div className="cover-fog" aria-hidden="true">
          <div className="cover-fog-color cover-fog-mid" />
          <div className="cover-fog-color cover-fog-primary" />
        </div>
        <div className="cover-grain" aria-hidden="true" />
        <div className="cover-guides" aria-hidden="true">
          <i className="cover-guide-v" />
          <i className="cover-guide-h" />
        </div>
        {headerNote === undefined ? (
          <dl data-testid="cover-metadata" className="cover-metadata">
            {metadata.map(({ field, label, value }) => (
              <div key={field} className="cover-meta-field">
                <dt>{t(`projectReadme.cover.${label}`)}</dt>
                <dd
                  data-testid={`cover-${field}`}
                  className="cover-meta-value"
                  dir="auto"
                  data-cover-editable={renderEditor ? field : undefined}
                >
                  {value || '—'}
                  {renderEditor?.(field)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <span data-testid="cover-header-note" className="cover-header-note">
            {headerNote}
          </span>
        )}
        <div
          data-testid="cover-header"
          className="cover-brand"
          data-cover-editable={renderEditor ? 'color_palette' : undefined}
        >
          <span className="cover-wordmark">
            {t('projectReadme.cover.brand')}
          </span>
          <DiamondMark palette={page.palette} />
          {renderEditor?.('color_palette')}
        </div>
        <header className="cover-heading">
          <h1
            ref={titleRef}
            data-testid="cover-title"
            dir="auto"
            aria-label={page.title}
            className="cover-title"
            data-cover-editable={renderEditor ? 'title' : undefined}
          >
            {JOINED_SCRIPT.test(page.title)
              ? page.title
              : titleGlyphs(page.title).map((glyph, index, all) => {
                  if (glyph === ' ') return ' '
                  const spread = Math.min(
                    0.16 * Math.max(0, all.length - 1),
                    0.8
                  )
                  const step = all.length > 1 ? spread / (all.length - 1) : 0
                  return (
                    <span
                      key={`${page.title}:${index}`}
                      aria-hidden="true"
                      className="cover-title-glyph"
                      style={{ animationDelay: `${-(step * index)}s` }}
                    >
                      {glyph}
                    </span>
                  )
                })}
            {renderEditor?.('title')}
          </h1>
        </header>
        <section ref={bandRef} data-testid="cover-band" className="cover-band">
          {cover !== null && (
            <img
              data-testid="cover-image"
              src={cover}
              alt=""
              className="cover-band-image"
            />
          )}
          <div
            ref={bandColumnRef}
            data-testid="cover-band-text"
            className={
              centerBandText
                ? 'cover-band-text text-center'
                : 'cover-band-text text-start'
            }
          >
            <div ref={rollInnerRef} className="cover-band-copy">
              {(page.sectionLabel !== '' || renderEditor) && (
                <h2
                  data-testid="cover-label"
                  className="cover-section-label"
                  data-cover-editable={
                    renderEditor ? 'sectionLabel' : undefined
                  }
                >
                  {page.sectionLabel.replace(/[：:]$/u, '') || ' '}
                  {renderEditor?.('sectionLabel')}
                </h2>
              )}
              <div
                ref={markdownRef}
                data-cover-markdown
                data-cover-editable={
                  renderEditor ? 'sectionMarkdown' : undefined
                }
                className="cover-section-markdown"
              >
                <CoverMarkdown markdown={page.sectionMarkdown} />
                {renderEditor?.('sectionMarkdown')}
              </div>
            </div>
          </div>
        </section>
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

/** Keep the four work colors beside the wordmark, in their source order. */
function DiamondMark({ palette }: { palette: readonly string[] }) {
  return (
    <span data-testid="cover-diamond" aria-hidden className="cover-diamond">
      <span>
        {palette.map((color, index) => (
          <span key={index} style={{ backgroundColor: color }} />
        ))}
      </span>
    </span>
  )
}
