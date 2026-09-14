import { render, screen, act, fireEvent } from '@/test/test-utils'
import { emitTo } from '@tauri-apps/api/event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import type { SessionSnapshot } from '@/lib/tauri-bindings'
import { MONITOR_REVEAL_FADE_MS } from '@/lib/monitor-reveal'
import { ProjectionApp } from './ProjectionApp'

/**
 * v1.5.0 (#129/#130): the projection thin root — driven by snapshot
 * SEQUENCES through the same mocked event channel the app uses. #130's
 * acceptance is the gate: Load/switch holds the 简介 (README, or the
 * project-name card), 开演 (the snapshot's projectionStarted flip —
 * Rust-authoritative) cross-fades to the monitor, a close/stop fades
 * back to 投影待机, and a window reopened after 开演 lands DIRECTLY on
 * the monitor (the gate is a session fact, not a window fact).
 */

const listeners = vi.hoisted(
  () => new Map<string, (payload: unknown) => void>()
)

const setTitle = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: vi.fn(() => ({ setTitle })),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(async (name: string, handler: (event: unknown) => void) => {
    listeners.set(name, payload => handler({ payload }))
    return () => {
      listeners.delete(name)
    }
  }),
  emit: vi.fn().mockResolvedValue(undefined),
}))

const snapshot = (
  overrides: Partial<SessionSnapshot> = {}
): SessionSnapshot => ({
  status: 'ready',
  projectName: 'Inarticulate III',
  projectPath: '/Users/test/Inarticulate III',
  audioMode: 'internal',
  lanIp: '192.168.1.10',
  hostAddress: null,
  oscTarget: null,
  health: {
    status: 'ready',
    scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
  },
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 5,
  channelPlan: null,
  outputDevice: 'System default',
  projectionStarted: false,
  ...overrides,
})

/** Publishes a snapshot through the app's event channel. */
const publish = (data: SessionSnapshot) => {
  act(() => {
    listeners.get('session-snapshot-event')?.({ snapshot: data })
  })
}

/** Lets the pending restore promises (microtasks) land — no timers. */
const flush = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

/** Advances the fade swap to its end (fake timers held by the caller). */
const settleSwap = async () => {
  await act(async () => {
    vi.advanceTimersByTime(MONITOR_REVEAL_FADE_MS)
  })
}

const intro = () => screen.getByTestId('projection-intro')

describe('ProjectionApp (#130 gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot(),
    })
    // #125 default: no README — the intro shows the project-name card.
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: null,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds the 简介 for a ready session with the gate closed', async () => {
    render(<ProjectionApp />)
    await flush()

    expect(intro().dataset.introView).toBe('card')
    expect(screen.getByText('Inarticulate III')).toBeInTheDocument()
    expect(screen.queryByTitle('Project monitor')).not.toBeInTheDocument()
    expect(commands.fadeInWindow).toHaveBeenCalledWith('projection')
  })

  it('renders the project README from #125 channel — text only', async () => {
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: '# Venue Title\n\nHello audience.',
    })
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot({ status: 'starting' }),
    })
    render(<ProjectionApp />)
    await flush()

    // The README read keys by path + resolved locale.
    expect(commands.readProjectReadme).toHaveBeenCalledWith(
      '/Users/test/Inarticulate III',
      'en'
    )
    expect(intro().dataset.introView).toBe('readme')
    expect(screen.getByText('Venue Title').tagName).toBe('H1')
    // v1.5 renders TEXT ONLY — images are hidden outright (the inner
    // markdown wrapper carries the hide).
    expect(
      screen.getByText('Hello audience.').closest('div.max-w-3xl')?.className
    ).toContain('[&_img]:hidden')
  })

  // User report after #130: a cover-format README must render the
  // creator-designed title page — the SAME layout the app window's
  // README panel shows (PNDS + composer/github pills, the huge title,
  // the cover band with the cover image) — never raw markdown.
  it('renders the cover-format README as the cover page, matching the app window', async () => {
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: [
        '# 失语 III',
        '',
        'title: 失语 III',
        'composer: @肖翔',
        'github_url: https://github.com/xO-xN/pnds-app',
        '',
        '## 作品简介：',
        '',
        '为场地屏幕而作。',
        '',
        '---',
        '',
        '## 关于作品',
        'GitHub boilerplate beyond the boundary.',
      ].join('\n'),
    })
    vi.mocked(commands.readProjectCover).mockResolvedValue({
      status: 'ok',
      data: 'data:image/png;base64,cover',
    })

    render(<ProjectionApp />)
    await flush()

    expect(intro().dataset.introView).toBe('cover')
    expect(screen.getByTestId('project-cover-page')).toBeInTheDocument()
    expect(screen.getByTestId('cover-title')).toHaveTextContent('失语 III')
    expect(screen.getByTestId('cover-composer')).toHaveTextContent('@肖翔')
    expect(screen.getByTestId('cover-github')).toBeInTheDocument()
    expect(screen.getByTestId('cover-label')).toHaveTextContent('作品简介：')
    expect(screen.getByText('为场地屏幕而作。')).toBeInTheDocument()
    // The panel stops at the --- boundary; the boilerplate never shows.
    expect(
      screen.queryByText(/boilerplate beyond the boundary/)
    ).not.toBeInTheDocument()
    // The band carries the project's cover image (fetched once, keyed
    // by path — the same readProjectCover channel as the app panel).
    expect(commands.readProjectCover).toHaveBeenCalledWith(
      '/Users/test/Inarticulate III'
    )
    expect(screen.getByTestId('cover-image')).toHaveAttribute(
      'src',
      'data:image/png;base64,cover'
    )
    // Venue-screen only (user request): the band rides the roomier
    // 40cqh share — more first-section content before the in-band
    // scroll; the title rides higher, composition still centered.
    const coverRoot = screen.getByTestId('project-cover-page')
    expect(coverRoot.style.getPropertyValue('--cover-band-h')).toBe(
      'min(40cqh,42cqw)'
    )
    // …and the venue screen's roomier title spacing (user request:
    // title 与上下两部分的间距增大) rides a TIGHTER edge inset — the
    // centered title's field grows both ways (pt/pb overrides are
    // absorbed by the centering slack and only shift the title; the
    // inset lifts the header and drops the band by the same amount, so
    // each visible gap widens symmetrically).
    expect(coverRoot.style.getPropertyValue('--cover-edge-inset')).toBe('2cqh')
    // The venue-screen frame: the cover composes inside a generously
    // inset stage box (user report: 大屏要更多四周留白) — and the zoom
    // scales the STAGE BOX itself (real layout, crisp text; the cq
    // composition rides along). Base frame at 100%: 85% × 80%. The
    // stage is also the composition's SIZE container — the cover root
    // is inline-size only, so every cqh resolves against this definite
    // box (the app panel's copy keeps its viewport fallback, its
    // approved original look).
    const stage = screen.getByTestId('projection-cover-stage')
    expect(stage.className).toContain('[container-type:size]')
    expect(stage.style.width).toBe('85%')
    expect(stage.style.height).toBe('80%')
    // ⌘+ grows the poster frame — 110% zoom → 93.5% × 88%.
    act(() => {
      listeners.get('pnds:projection-action')?.({ kind: 'zoom-in' })
    })
    expect(stage.style.width).toBe('93.5%')
    expect(stage.style.height).toBe('88%')
  })

  it('renders a cover-format README band text-only when the project ships no cover image', async () => {
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: [
        '# No Image',
        '',
        'composer: @someone',
        '',
        '## About:',
        '',
        'Text is enough.',
      ].join('\n'),
    })
    // The previous test's cover override persists through clearAllMocks
    // (it clears calls, not implementations) — re-pin the no-cover read.
    vi.mocked(commands.readProjectCover).mockResolvedValue({
      status: 'ok',
      data: null,
    })

    render(<ProjectionApp />)
    await flush()

    expect(intro().dataset.introView).toBe('cover')
    expect(screen.queryByTestId('cover-image')).not.toBeInTheDocument()
    expect(screen.getByText('Text is enough.')).toBeInTheDocument()
  })

  it('cross-fades to the monitor when 开演 lands (snapshot flip)', async () => {
    vi.useFakeTimers()
    render(<ProjectionApp />)
    await flush()
    expect(intro()).toBeInTheDocument()

    // The conductor toggled the gate; Rust published the new snapshot.
    publish(snapshot({ projectionStarted: true }))
    expect(screen.getByTestId('projection-swap-cover').className).toContain(
      'opacity-100'
    )
    await settleSwap()

    const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement
    expect(iframe.src).toBe('http://192.168.1.10:6869/?theme=pond&lang=en')
    // 撤回 — the same action reverses through the same fade.
    publish(snapshot({ projectionStarted: false }))
    await settleSwap()
    expect(intro()).toBeInTheDocument()
  })

  it('lands DIRECTLY on the monitor when reopened after 开演', async () => {
    // The gate is a session fact: a window reopened mid-开演 restores a
    // projectionStarted snapshot — no 简介 flash, no re-asking.
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot({ projectionStarted: true }),
    })
    render(<ProjectionApp />)
    await flush()

    const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement
    expect(iframe.src).toBe('http://192.168.1.10:6869/?theme=pond&lang=en')
    expect(screen.queryByTestId('projection-intro')).not.toBeInTheDocument()
    expect(screen.getByTestId('projection-swap-cover').className).toContain(
      'opacity-0'
    )
  })

  it("shows the next work's 简介 through a switch — the gate resets", async () => {
    vi.useFakeTimers()
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot({ projectionStarted: true }),
    })
    render(<ProjectionApp />)
    await flush()
    expect(screen.getByTitle('Project monitor')).toBeInTheDocument()

    // Confirm → stop old → start new: starting(B) carries the reset gate.
    publish(
      snapshot({
        status: 'starting',
        projectPath: '/Users/test/Other',
        projectName: 'Other Work',
        projectionStarted: false,
      })
    )
    await settleSwap()
    expect(intro().dataset.introView).toBe('card')
    expect(screen.getByText('Other Work')).toBeInTheDocument()
  })

  it('reveals even when the restore fails — a themed standby, never an invisible window', async () => {
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'error',
      error: 'ipc down',
    })
    render(<ProjectionApp />)
    await flush()

    expect(commands.fadeInWindow).toHaveBeenCalledWith('projection')
    expect(screen.getByTestId('projection-standby')).toBeInTheDocument()
  })

  it('stands by (themed, bilingual) with no session', async () => {
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot({ status: 'idle', projectName: null, health: null }),
    })
    render(<ProjectionApp />)
    await flush()

    expect(screen.getByTestId('projection-standby')).toBeInTheDocument()
    expect(screen.getByText('No performance')).toBeInTheDocument()
    expect(screen.queryByTitle('Project monitor')).not.toBeInTheDocument()
  })

  it('fades to standby when the session closes', async () => {
    vi.useFakeTimers()
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot({ projectionStarted: true }),
    })
    render(<ProjectionApp />)
    await flush()
    expect(screen.getByTitle('Project monitor')).toBeInTheDocument()

    publish(snapshot({ status: 'stopping', projectionStarted: true }))
    expect(screen.getByTestId('projection-swap-cover').className).toContain(
      'opacity-100'
    )
    await settleSwap()
    expect(screen.getByTestId('projection-standby')).toBeInTheDocument()
  })

  it('holds the reveal cover until the iframe load event', async () => {
    vi.useFakeTimers()
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot({ projectionStarted: true }),
    })
    render(<ProjectionApp />)
    await flush()

    const cover = screen.getByTestId('projection-reveal-cover')
    expect(cover.className).not.toContain('opacity-0')

    fireEvent.load(screen.getByTitle('Project monitor'))
    expect(cover.className).toContain('opacity-0')
  })

  it('titles the window with the project while on stage, plain on standby', async () => {
    vi.useFakeTimers()
    render(<ProjectionApp />)
    await flush()
    // The 简介 is on stage — a session IS running.
    expect(setTitle).toHaveBeenLastCalledWith(
      'PNDS Projection — Inarticulate III'
    )

    publish(snapshot({ status: 'stopping' }))
    await settleSwap()
    publish(snapshot({ status: 'idle', projectName: null, health: null }))
    await settleSwap()
    expect(setTitle).toHaveBeenLastCalledWith('PNDS Projection')

    // A language switch re-titles live.
    act(() => {
      listeners.get('pnds:projection-locale')?.({ locale: 'zh-CN' })
    })
    await flush()
    expect(setTitle).toHaveBeenLastCalledWith('PNDS 投影')

    // Restore the suite's language for the tests that follow — awaited
    // DIRECTLY (fake timers starve vi.waitFor's polling): a leaky zh-CN
    // would ride the next URL snapshot's first-frame params.
    await act(async () => {
      await i18n.changeLanguage('en')
    })
  })

  it('follows the main window theme pushes live', async () => {
    render(<ProjectionApp />)
    await flush()

    act(() => {
      listeners.get('pnds:projection-theme')?.({ colorTheme: 'stage' })
    })
    await flush()
    expect(document.documentElement.getAttribute('data-color-theme')).toBe(
      'stage'
    )

    act(() => {
      listeners.get('pnds:projection-theme')?.({ colorTheme: 'pond' })
    })
    await flush()
    expect(document.documentElement.getAttribute('data-color-theme')).toBe(
      'pond'
    )
  })

  // v1.5.0 (#131 + zoom memory): the projection window's OWN zoom —
  // dispatched ⌘±/⌘0 actions from the main window's focused-window
  // menu dispatch, applied to the monitor (§v1.1.1 transform frame) AND
  // the 简介 (which scales its CONTENT — CSS layout zoom on the card /
  // document, the stage box itself on the cover; a transform frame
  // self-compensates the cover's cq layout and blurs text, user
  // report), and every change REPORTED to the main window so it is
  // remembered in preferences (reopen/boot restores the value).
  const dispatchAction = (kind: string) => {
    act(() => {
      listeners.get('pnds:projection-action')?.({ kind })
    })
  }

  it('zooms the 简介 too, keeping the value through content swaps', async () => {
    vi.useFakeTimers()
    render(<ProjectionApp />)
    await flush()

    // Zoom while the 简介 holds (the name card here — no README): CSS
    // LAYOUT zoom, so the text re-rasterizes crisp at the new size, and
    // the change is reported for persistence.
    dispatchAction('zoom-in')
    dispatchAction('zoom-in')
    expect(intro().style.zoom).toBe('1.2')
    expect(emitTo).toHaveBeenCalledWith('main', 'pnds:projection-zoom', {
      zoom: 110,
    })
    expect(emitTo).toHaveBeenLastCalledWith('main', 'pnds:projection-zoom', {
      zoom: 120,
    })

    // 开演 → the monitor renders at the kept value (transform +
    // inverse size, the MonitorView approach).
    publish(snapshot({ projectionStarted: true }))
    await settleSwap()
    const scale = screen.getByTestId('monitor-scale-frame')
    expect(scale.style.transform).toBe('scale(1.2)')
    expect(scale.style.width).toBe(`${100 / 1.2}%`)
    expect(scale.style.height).toBe(`${100 / 1.2}%`)

    // A project switch walks the content machinery (intro → monitor);
    // the zoom is ProjectionApp-owned and survives the swap.
    publish(
      snapshot({
        status: 'starting',
        projectPath: '/Users/test/Other',
        projectionStarted: false,
      })
    )
    await settleSwap()
    expect(intro().style.zoom).toBe('1.2')
    publish(
      snapshot({
        projectPath: '/Users/test/Other',
        projectionStarted: true,
      })
    )
    await settleSwap()
    expect(screen.getByTestId('monitor-scale-frame').style.transform).toBe(
      'scale(1.2)'
    )

    // ⌘0 resets the projection's own value — and reports the reset.
    dispatchAction('zoom-reset')
    expect(screen.getByTestId('monitor-scale-frame').style.transform).toBe(
      'scale(1)'
    )
    expect(emitTo).toHaveBeenLastCalledWith('main', 'pnds:projection-zoom', {
      zoom: 100,
    })
  })

  it('seeds from the remembered zoom and restores it on reopen', async () => {
    vi.useFakeTimers()
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot({ projectionStarted: true }),
    })
    // Boot with a remembered preference (projection-main clamps and
    // passes it): the FIRST frame already renders at that scale.
    render(<ProjectionApp initialZoom={130} />)
    await flush()
    expect(screen.getByTestId('monitor-scale-frame').style.transform).toBe(
      'scale(1.3)'
    )
    dispatchAction('zoom-out')
    expect(screen.getByTestId('monitor-scale-frame').style.transform).toBe(
      'scale(1.2)'
    )
    expect(emitTo).toHaveBeenLastCalledWith('main', 'pnds:projection-zoom', {
      zoom: 120,
    })
  })

  it('reloads the monitor on the ⌘⇧R action — nonce semantics, fresh reveal gate', async () => {
    vi.useFakeTimers()
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot({ projectionStarted: true }),
    })
    render(<ProjectionApp />)
    await flush()

    const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement
    expect(iframe.src).not.toContain('_r=')
    fireEvent.load(iframe)
    expect(screen.getByTestId('projection-reveal-cover').className).toContain(
      'opacity-0'
    )

    dispatchAction('reload-monitor')
    const reloaded = screen.getByTitle('Project monitor') as HTMLIFrameElement
    // The nonce rides the URL as the cache-buster (`_r`) — the same
    // cold-fetch semantics as the main window's reload.
    expect(reloaded.src).toBe(
      'http://192.168.1.10:6869/?theme=pond&lang=en&_r=1'
    )
    // The remounted navigation holds its reveal gate until the load.
    expect(
      screen.getByTestId('projection-reveal-cover').className
    ).not.toContain('opacity-0')
  })

  it('leaves Esc to the page — no app dialog ever opens from the projection', async () => {
    render(<ProjectionApp />)
    await flush()

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(screen.getByTestId('projection-root'), {
      key: 'Escape',
    })

    // The thin root has no ⌘ layer and no close-project confirm — the
    // keypress belongs to the page (page-interaction.md, window-scoped).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('projection-intro')).toBeInTheDocument()
  })
})
