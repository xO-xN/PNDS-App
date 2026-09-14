import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { currentResolvedLanguage } from '@/i18n/config'
import {
  onProjectionLocale,
  onProjectionTheme,
  onSessionSnapshot,
  onWindowFocus,
  PROJECTION_WINDOW_LABEL,
} from '@/lib/events'
import { commands } from '@/lib/tauri-bindings'
import type { SessionSnapshot } from '@/lib/tauri-bindings'
import {
  currentColorThemeSetting,
  useSettingsStore,
} from '@/store/settings-store'
import { setColorThemeAttribute } from '@/lib/color-theme'
import { pushThemeToFrame } from '@/lib/theme-bridge'
import { pushLocaleToFrame } from '@/lib/locale-bridge'
import { buildMonitorUrl } from '@/lib/monitor-url'
import {
  monitorNavigationRevealed,
  MONITOR_REVEAL_TIMEOUT_MS,
  MONITOR_REVEAL_FADE_MS,
  MONITOR_REVEAL_FADE_TRANSITION,
} from '@/lib/monitor-reveal'
import {
  projectionContent,
  projectionContentKey,
  type ProjectionContent,
} from '@/lib/projection-state'
import { readProjectReadme } from '@/lib/project-readme'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

/**
 * v1.5.0 (#129): the projection window's THIN root (ADR-0006) — the
 * venue screen. No AppShell boots here: the page mirrors the backend's
 * session snapshot (broadcast events + the getSessionState restore,
 * re-fetched on focus/visibility like the main shell — an occluded
 * WKWebView suspends JS and drops queued events), derives what to show
 * through the pure projectionContent machine, and renders exactly one
 * of two screens:
 *
 * - monitor — the same page the main window shows, assembled the same
 *   way (#39 address snapshot semantics, #49/#54 `?theme=`/`?lang=`
 *   first-frame parameters snapshotted per navigation, #50 reveal gate
 *   with the timeout backstop, the theme/locale bridges);
 * - 投影待机 — themed background, PNDS wordmark, 「无演出」.
 *
 * The stage below mounts only once the first snapshot has settled, so
 * its useState initializer captures that first content directly — a
 * session already 开演'd when the window (re)opens lands on the monitor
 * with no 简介 flash. Every LATER content change (standby↔简介↔monitor,
 * a project switch's address change) cross-fades through the themed
 * cover — the audience never sees a hard cut (spec #128: 投影内容切换
 * 都是渐变). The window reveals itself once its first snapshot settles
 * (#51 anti-flash; a failed restore still reveals — never an invisible
 * window).
 *
 * v1.5.0 (#130): the content is GATED — a session on stage holds the
 * 简介 (the project's README, or its name card) from the Starting
 * snapshot until the conductor opens the gate (▶ / ⌘⏎ → the
 * Rust-authoritative toggleProjectionStart command; the flag arrives
 * with the next session snapshot, so both windows move together).
 */

/** The venue screen's monitor half — one navigation per remount. */
function ProjectionMonitor({
  content,
}: {
  content: Extract<ProjectionContent, { kind: 'monitor' }>
}) {
  // v1.2.3 (#44)/v1.3.0 (#54): the bridges keep a LIVE session recolored
  // and re-localized; the URL below carries the same values only as
  // first-frame parameters, snapshotted per navigation.
  const colorTheme = useSettingsStore(state => state.colorThemeSetting)
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const monitorOrigin = `http://${content.host}:${content.port}`
  // The MonitorView contract (#39/#49/#54): the src is snapshotted per
  // NAVIGATION (mount, address change) — a live theme or language switch
  // must NOT retarget the src; the bridges push the new values instead.
  // Both are therefore read from their live sources inside the memo,
  // never from the render-time values above.
  const iframeSrc = useMemo(
    () =>
      buildMonitorUrl(content.host, content.port, {
        theme: currentColorThemeSetting(),
        lang: currentResolvedLanguage(),
      }),
    [content.host, content.port]
  )
  return (
    <MonitorNavigation
      key={iframeSrc}
      src={iframeSrc}
      origin={monitorOrigin}
      colorTheme={colorTheme}
      locale={locale}
    />
  )
}

/**
 * One monitor navigation (an address change remounts this whole
 * subtree, which is what resets the #50 reveal gate per navigation).
 */
function MonitorNavigation({
  src,
  origin,
  colorTheme,
  locale,
}: {
  src: string
  origin: string
  colorTheme: string
  locale: string
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // #50: the reveal gate — released by the iframe's own load event or
  // the timeout backstop; the themed cover hides the still-loading page
  // behind the App theme.
  const [loaded, setLoaded] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const revealed = monitorNavigationRevealed(loaded, timedOut)
  useEffect(() => {
    if (revealed) return
    const id = setTimeout(() => setTimedOut(true), MONITOR_REVEAL_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [revealed])
  // Initial push + re-push on theme/language switch.
  useEffect(() => {
    pushThemeToFrame(iframeRef.current, origin, colorTheme)
    pushLocaleToFrame(iframeRef.current, origin, locale)
  }, [colorTheme, locale, origin])

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <iframe
        ref={iframeRef}
        src={src}
        title="Project monitor"
        className="block h-full w-full border-0"
        onLoad={() => {
          setLoaded(true)
          pushThemeToFrame(iframeRef.current, origin, colorTheme)
          pushLocaleToFrame(iframeRef.current, origin, locale)
        }}
      />
      {/* #50 reveal cover — appears INSTANTLY over a loading iframe,
          fades out once the gate releases (data-reveal-motion exempts
          the fade from Brutal's instant rule). */}
      <div
        aria-hidden
        data-testid="projection-reveal-cover"
        data-reveal-motion=""
        className={cn(
          'absolute inset-0 bg-(--pnds-bg)',
          revealed && 'pointer-events-none opacity-0'
        )}
        style={
          revealed ? { transition: MONITOR_REVEAL_FADE_TRANSITION } : undefined
        }
      />
    </div>
  )
}

/** The venue screen's idle half — themed, bilingual, never a dead page. */
function ProjectionStandby() {
  const { t } = useTranslation()
  return (
    <div
      data-testid="projection-standby"
      className="flex h-full w-full flex-col items-center justify-center gap-6 bg-(--pnds-bg)"
    >
      {/* ps- compensates the tracking's trailing space so the wordmark
          optically centers. */}
      <span className="ps-[0.35em] text-5xl font-semibold tracking-[0.35em] text-(--pnds-text)/35 select-none">
        PNDS
      </span>
      <span className="text-sm text-(--pnds-text)/45">
        {t('projection.standby')}
      </span>
    </div>
  )
}

/**
 * v1.5.0 (#130): the 简介 — what the venue screen holds from the Load's
 * Starting snapshot until the conductor 开演s. The project's root
 * README renders through #125's channel (read keyed by path AND locale,
 * so a language switch re-reads into that language's variant) on the
 * help center's HelpMarkdown — v1.5 renders TEXT ONLY: images are
 * hidden, and anchor clicks never navigate this webview (the projection
 * is a display, not a browser — every link is a dead no-op). No README
 * (or an unreadable one) falls back to the project-name card — a
 * missing file must not break the venue screen's look (spec story 23).
 */
function ProjectionIntro({
  content,
}: {
  content: Extract<ProjectionContent, { kind: 'intro' }>
}) {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  // The last completed read, keyed by the path and locale it belongs
  // to — the ProjectReadme pattern: a change renders "still reading"
  // (the name card) until the new read lands, with no synchronous
  // reset and no stale cross-project flash.
  const [loaded, setLoaded] = useState<{
    path: string
    locale: string
    readme: string | null
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    void readProjectReadme(content.projectPath, locale).then(read => {
      if (!cancelled) {
        setLoaded({ path: content.projectPath, locale, readme: read.readme })
      }
    })
    return () => {
      cancelled = true
    }
  }, [content.projectPath, locale])
  const settled =
    loaded !== null &&
    loaded.path === content.projectPath &&
    loaded.locale === locale
  const markdown = settled ? loaded.readme : null

  // The projection is a display: no anchor click ever navigates this
  // webview (the stranded-app lesson from the main window) and nothing
  // leaves for a browser mid-performance — every link is a no-op.
  const swallowAnchor = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('a')) event.preventDefault()
  }

  if (markdown === null) {
    return (
      <div
        data-testid="projection-intro"
        data-intro-view="card"
        className="flex h-full w-full flex-col items-center justify-center bg-(--pnds-bg) p-10"
      >
        <span className="max-w-full truncate text-center text-4xl font-semibold text-(--pnds-text)/45">
          {content.projectName ?? 'PNDS'}
        </span>
      </div>
    )
  }
  return (
    <div
      data-testid="projection-intro"
      data-intro-view="readme"
      onClick={swallowAnchor}
      className="h-full w-full overflow-y-auto bg-(--pnds-bg)"
    >
      <div className="mx-auto w-full max-w-3xl px-10 py-12 text-(--pnds-text) [&_img]:hidden">
        <HelpMarkdown markdown={markdown} />
      </div>
    </div>
  )
}

/**
 * The content stage — mounted with the FIRST settled content as its
 * baseline (the initializer; no fade, it rides the window reveal). A
 * LATER content change keeps the displayed screen on stage under the
 * themed cover while the swap is pending: the cover's opacity is
 * DERIVED (displayed key ≠ latest key — it flips the moment the content
 * changes and the CSS transition does the fading), a timer lands the
 * swap one fade-length later, and the derived flag flips back to fade
 * the cover OUT. Rapid snapshot sequences restart the timer and
 * collapse onto the newest content; a sequence that ends back on the
 * displayed content releases the cover without a swap.
 */
function ProjectionStage({
  latest,
  projectName,
}: {
  latest: ProjectionContent
  projectName: string | null
}) {
  const { t, i18n } = useTranslation()
  const [displayed, setDisplayed] = useState(latest)
  useEffect(() => {
    if (projectionContentKey(displayed) === projectionContentKey(latest)) {
      return
    }
    const id = setTimeout(() => setDisplayed(latest), MONITOR_REVEAL_FADE_MS)
    return () => clearTimeout(id)
  }, [displayed, latest])
  const coverOpaque =
    projectionContentKey(displayed) !== projectionContentKey(latest)

  // The native title describes what the venue screen shows — the
  // project's name while a session is on stage (简介 or monitor, #130),
  // plain on standby — and follows the UI language (t and locale both
  // move on a switch).
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  useEffect(() => {
    const title =
      displayed.kind !== 'standby' && projectName
        ? t('projection.windowTitle', { name: projectName })
        : t('projection.windowTitleIdle')
    getCurrentWebviewWindow()
      .setTitle(title)
      .catch(error => {
        logger.warn('Failed to retitle the projection window', { error })
      })
  }, [displayed, projectName, locale, t])

  return (
    <>
      {displayed.kind === 'monitor' ? (
        <ProjectionMonitor content={displayed} />
      ) : displayed.kind === 'intro' ? (
        <ProjectionIntro content={displayed} />
      ) : (
        <ProjectionStandby />
      )}
      {/* The content cross-fade cover (the StopCover language: fade in
          over the outgoing screen, swap, fade out). */}
      <div
        aria-hidden
        data-testid="projection-swap-cover"
        data-reveal-motion=""
        className={cn(
          'absolute inset-0 z-40 bg-(--pnds-bg)',
          coverOpaque ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        style={{ transition: MONITOR_REVEAL_FADE_TRANSITION }}
      />
    </>
  )
}

export function ProjectionApp() {
  const { i18n } = useTranslation()
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const revealRef = useRef(false)

  // The session mirror: live broadcast events, the mount restore, and
  // the occlusion catch-ups (visibility + the Rust regain signal) all
  // funnel through one re-fetch — same shape as AppShell's. The FIRST
  // restore also drives the #51 reveal (settled snapshot or failed
  // restore — either way the window must appear).
  useEffect(() => {
    const offSession = onSessionSnapshot(setSnapshot)
    const restore = () => {
      void commands.getSessionState().then(result => {
        if (result.status === 'ok') {
          setSnapshot(result.data)
        } else {
          setRestoreFailed(true)
        }
        if (revealRef.current) return
        revealRef.current = true
        commands
          .fadeInWindow(PROJECTION_WINDOW_LABEL)
          .then(revealed => {
            if (revealed.status === 'error') {
              logger.warn('The projection window reveal failed', {
                error: revealed.error,
              })
            }
          })
          .catch(error => {
            logger.warn('The projection window reveal failed', { error })
          })
      })
    }
    restore()
    const handleVisibility = () => {
      if (!document.hidden) restore()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    const offFocus = onWindowFocus(restore)
    return () => {
      offSession()
      document.removeEventListener('visibilitychange', handleVisibility)
      offFocus()
    }
  }, [])

  // Live-follow the main window's language and Appearance theme —
  // same contract as the help center (#56/#68). The i18n instance from
  // useTranslation is the global singleton (stable identity).
  useEffect(() => {
    const offLocale = onProjectionLocale(next => {
      void i18n.changeLanguage(next)
    })
    const offTheme = onProjectionTheme(theme => {
      setColorThemeAttribute(theme)
    })
    return () => {
      offLocale()
      offTheme()
    }
  }, [i18n])

  // `restoreFailed`: the initial fetch answered with an error — a
  // themed standby screen, not an empty window.
  const latest =
    snapshot === null
      ? restoreFailed
        ? ({ kind: 'standby' } as const)
        : null
      : projectionContent(snapshot)

  return (
    <div
      data-testid="projection-root"
      className="relative h-screen w-screen overflow-hidden bg-(--pnds-bg)"
    >
      {latest !== null && (
        <ProjectionStage
          latest={latest}
          projectName={snapshot?.projectName ?? null}
        />
      )}
    </div>
  )
}
