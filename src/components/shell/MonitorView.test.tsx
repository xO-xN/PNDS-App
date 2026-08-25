import { fireEvent, render, screen, act } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { MONITOR_REVEAL_TIMEOUT_MS } from '@/lib/monitor-reveal'
import { logger } from '@/lib/logger'
import { MonitorView } from './MonitorView'

/** The health block MonitorView needs to render a ready session. */
const readyHealth = {
  status: 'ready' as const,
  projectId: 'inarticulate-iii',
  audioMode: 'internal' as const,
  audio: { status: 'running' as const, target: null, error: null },
  scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
}

/**
 * v1.1.2 fix: WKWebView hands a freshly loaded out-of-process monitor
 * iframe the keyboard first responder (most visibly on the first project
 * opened after launch), which kills every window-level shortcut — ⌘
 * badges/peek, Esc — until the next click. MonitorView must hold the
 * keyboard focus on its host root and reclaim it after the iframe loads.
 */
describe('MonitorView keyboard focus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      lanIp: '192.168.1.10',
      health: readyHealth,
    })
  })

  it('focuses the host root on mount', () => {
    render(<MonitorView />)

    expect(document.activeElement).toBe(screen.getByTestId('monitor-host'))
  })

  it('reclaims keyboard focus when the window regains focus after a space switch', () => {
    render(<MonitorView />)

    // Coming back from another desktop, WKWebView can hand the first
    // responder to the monitor iframe again (user report on #29): every
    // window-level key goes dead until the next click.
    const iframe = screen.getByTitle('Project monitor')
    iframe.focus()
    window.dispatchEvent(new Event('focus'))

    expect(document.activeElement).toBe(screen.getByTestId('monitor-host'))

    // The reclaim never steals from a meaningful focus holder.
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    window.dispatchEvent(new Event('focus'))
    expect(document.activeElement).toBe(input)
    input.remove()
  })

  it('reclaims keyboard focus after the monitor iframe loads', () => {
    render(<MonitorView />)

    // Emulate the iframe steal: the webview moves the first responder
    // into the out-of-process frame when it finishes loading.
    const iframe = screen.getByTitle('Project monitor')
    iframe.focus()
    fireEvent.load(iframe)

    expect(document.activeElement).toBe(screen.getByTestId('monitor-host'))
  })
})

/**
 * v1.2.3 (#44): the theme bridge's delivery timing — the monitor iframe
 * receives the current theme on load, on every theme switch and on every
 * window regain (a suspended OOPIF drops messages, so each regain
 * re-pushes; the page applies the latest value idempotently).
 */
describe('MonitorView theme bridge (#44)', () => {
  beforeEach(() => {
    // The palette values come from theme-variables.css at runtime; stub
    // the style read so the tests pin the delivery, not the colors.
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          getPropertyValue: (name: string) =>
            name === '--pnds-accent' ? '#5a4ff3' : '',
        }) as unknown as CSSStyleDeclaration
    )
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      sessionLanIp: '192.168.1.10',
      lanIp: '192.168.1.10',
      health: readyHealth,
    })
    useSettingsStore.setState({ colorThemeSetting: 'lavender' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Replaces the iframe's contentWindow with a postMessage spy. */
  function framePostMessage() {
    const frame = screen.getByTitle('Project monitor') as HTMLIFrameElement
    const postMessage = vi.fn()
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage },
      configurable: true,
    })
    return postMessage
  }

  it('pushes the theme on iframe load, at the exact monitor origin', () => {
    render(<MonitorView />)
    const postMessage = framePostMessage()

    fireEvent.load(screen.getByTitle('Project monitor'))

    expect(postMessage).toHaveBeenCalledTimes(1)
    const firstCall = postMessage.mock.calls[0]
    const message = firstCall?.[0]
    const origin = firstCall?.[1]
    expect(origin).toBe('http://192.168.1.10:6869') // never '*'
    expect(message.type).toBe('pnds:theme')
    expect(message.theme).toBe('lavender')
    expect(message.palette.accent).toBe('#5a4ff3')
  })

  it('re-pushes when the theme changes', () => {
    render(<MonitorView />)
    const postMessage = framePostMessage()
    fireEvent.load(screen.getByTitle('Project monitor'))
    expect(postMessage).toHaveBeenCalledTimes(1)

    act(() => {
      useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    })

    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(postMessage.mock.calls[1]?.[0].theme).toBe('brutal')
  })

  it('re-pushes on every window regain (latest value wins)', () => {
    render(<MonitorView />)
    const postMessage = framePostMessage()

    fireEvent.load(screen.getByTitle('Project monitor'))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    // Load + the focus regain — the suspended-OOPIF backstop.
    expect(postMessage.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(postMessage.mock.calls.at(-1)?.[0].type).toBe('pnds:theme')
  })

  it('pushes again after a monitor reload', () => {
    render(<MonitorView />)
    const first = framePostMessage()
    fireEvent.load(screen.getByTitle('Project monitor'))
    expect(first).toHaveBeenCalledTimes(1)

    act(() => {
      useSessionStore.getState().bumpMonitorReload()
    })
    const second = framePostMessage()
    fireEvent.load(screen.getByTitle('Project monitor'))

    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0]?.[0].theme).toBe('lavender')
  })
})

/**
 * v1.3.0 (#49): the iframe URL carries `?theme=` as a first-frame
 * parameter — the single thing that removes the light-then-dark flash
 * on dark themes. The src is snapshotted per navigation: a live theme
 * switch must NOT retarget it (that would reload the live monitor; the
 * bridge pushes updates instead), while a reload re-snapshots it.
 */
describe('MonitorView iframe URL (#49)', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      lanIp: '192.168.1.10',
      health: readyHealth,
    })
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
  })

  const frameSrc = () =>
    (screen.getByTitle('Project monitor') as HTMLIFrameElement).getAttribute(
      'src'
    )

  it('navigates to the monitor address with the current theme on first frame', () => {
    render(<MonitorView />)

    expect(frameSrc()).toBe('http://192.168.1.10:6869/?theme=brutal')
  })

  it('keeps the src frozen across a live theme switch (the bridge owns updates)', () => {
    render(<MonitorView />)

    act(() => {
      useSettingsStore.setState({ colorThemeSetting: 'stage' })
    })

    // Still the snapshot from the last navigation — retargeting the src
    // would reload the live monitor page.
    expect(frameSrc()).toBe('http://192.168.1.10:6869/?theme=brutal')
  })

  it('re-snapshots the theme when the monitor reloads', () => {
    render(<MonitorView />)

    act(() => {
      useSettingsStore.setState({ colorThemeSetting: 'stage' })
      useSessionStore.getState().bumpMonitorReload()
    })

    expect(frameSrc()).toBe('http://192.168.1.10:6869/?theme=stage')
  })
})

/**
 * v1.3.0 (#50): the reveal gate wiring — the iframe's own load event
 * reports the navigation ready, the cover hides a rebuilding iframe
 * behind the App theme until then, and the timeout backstop releases
 * (with a log) so the cover can never stick.
 */
describe('MonitorView reveal gate (#50)', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      lanIp: '192.168.1.10',
      health: readyHealth,
      monitorReloadNonce: 0,
      monitorLoaded: false,
      monitorLoadTimedOut: false,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const cover = () => screen.getByTestId('monitor-reveal-cover')
  const coverHeld = () => expect(cover().className).not.toContain('opacity-0')
  const coverReleased = () => {
    expect(cover().className).toContain('opacity-0')
    expect(cover().className).toContain('pointer-events-none')
  }

  it('covers the iframe until its load event reports readiness', () => {
    render(<MonitorView />)
    coverHeld()

    fireEvent.load(screen.getByTitle('Project monitor'))

    expect(useSessionStore.getState().monitorLoaded).toBe(true)
    coverReleased()
  })

  it('re-holds the cover INSTANTLY on a monitor reload (no fade-in flash)', () => {
    render(<MonitorView />)
    fireEvent.load(screen.getByTitle('Project monitor'))
    coverReleased()

    act(() => {
      useSessionStore.getState().bumpMonitorReload()
    })

    // The rebuilding iframe is hidden again the same frame — a fading-in
    // cover would flash it through.
    coverHeld()
    expect(cover().style.transition).toBe('')

    fireEvent.load(screen.getByTitle('Project monitor'))
    coverReleased()
  })

  it('releases via the timeout backstop and logs, when the iframe never loads', () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    render(<MonitorView />)
    coverHeld()

    act(() => {
      vi.advanceTimersByTime(MONITOR_REVEAL_TIMEOUT_MS)
    })

    expect(useSessionStore.getState().monitorLoadTimedOut).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    coverReleased()
  })
})
