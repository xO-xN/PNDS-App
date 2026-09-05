import { fireEvent, render, screen, act } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { MONITOR_REVEAL_TIMEOUT_MS } from '@/lib/monitor-reveal'
import { logger } from '@/lib/logger'
import i18n from '@/i18n/config'
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
 * v1.3.5 (#105): the guest focus gate. The all-frames user script
 * (window.rs GUEST_FOCUS_SCRIPT) makes the monitor page report its
 * focus state — `interacting: true` while a page element other than
 * body/html holds focus. The reclaim machinery stands down while it is
 * true (the page's inputs and dropdowns keep the keyboard) and takes
 * the keyboard back the moment focus returns to the page body. The
 * signal is trusted only from THIS iframe's content window.
 */
describe('MonitorView guest focus gate (#105)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      lanIp: '192.168.1.10',
      health: readyHealth,
    })
  })

  /** Posts a pnds:guest-focus signal as if sent by the monitor iframe. */
  function postGuestFocus(interacting: boolean, source?: MessageEventSource) {
    const frame = screen.getByTitle('Project monitor') as HTMLIFrameElement
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'pnds:guest-focus', interacting },
        source: source ?? frame.contentWindow,
      })
    )
  }

  it('every reclaim path stands down while the guest page interacts', () => {
    vi.useFakeTimers()
    try {
      render(<MonitorView />)
      const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement
      postGuestFocus(true)
      iframe.focus()
      expect(document.activeElement).toBe(iframe)

      // Window regain, visibility regain and the 2s heartbeat all pass
      // through the one gated choke point — none may steal.
      act(() => {
        window.dispatchEvent(new Event('focus'))
        document.dispatchEvent(new Event('visibilitychange'))
        vi.advanceTimersByTime(2000)
      })
      expect(document.activeElement).toBe(iframe)
    } finally {
      vi.useRealTimers()
    }
  })

  it('focus falling back to the page body hands the keyboard over at once', () => {
    render(<MonitorView />)
    const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement
    postGuestFocus(true)
    iframe.focus()

    postGuestFocus(false)

    expect(document.activeElement).toBe(screen.getByTestId('monitor-host'))
  })

  it('a spontaneous steal with no guest signal is still reclaimed (#29)', () => {
    render(<MonitorView />)
    const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement

    // Desktop switch back: WKWebView hands the responder to the iframe,
    // and the page is NOT interacting (no signal) — the reclaim fires
    // exactly as before the gate existed.
    iframe.focus()
    window.dispatchEvent(new Event('focus'))

    expect(document.activeElement).toBe(screen.getByTestId('monitor-host'))
  })

  it('messages from anywhere but this iframe leave the gate untouched', () => {
    render(<MonitorView />)
    const frame = screen.getByTitle('Project monitor') as HTMLIFrameElement
    postGuestFocus(true)
    frame.focus()

    // A foreign source claiming the interaction ended — ignored.
    postGuestFocus(false, {} as MessageEventSource)
    // A malformed payload from the right source — ignored too.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'pnds:guest-focus', interacting: 'yes' },
        source: frame.contentWindow,
      })
    )
    window.dispatchEvent(new Event('focus'))
    expect(document.activeElement).toBe(frame)

    // The real end-of-interaction signal still lands afterwards.
    postGuestFocus(false)
    expect(document.activeElement).toBe(screen.getByTestId('monitor-host'))
  })

  it('a monitor reload reclaims unconditionally and re-arms the gate', () => {
    render(<MonitorView />)
    const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement
    postGuestFocus(true)
    iframe.focus()

    // v1.3.4 behavior retained: the load reclaim is not gated, and the
    // fresh document starts with the gate down (no interaction yet).
    fireEvent.load(iframe)
    expect(document.activeElement).toBe(screen.getByTestId('monitor-host'))

    // No guest signal + focus parked in the iframe: the #29 reclaim
    // fires for the reloaded page as well.
    iframe.focus()
    window.dispatchEvent(new Event('focus'))
    expect(document.activeElement).toBe(screen.getByTestId('monitor-host'))
  })
})

/**
 * v1.2.3 (#44) / v1.3.0 (#54): the bridges' delivery timing — the
 * monitor iframe receives the current theme and resolved language on
 * load, on every theme/language switch and on every window regain (a
 * suspended OOPIF drops messages, so each regain re-pushes; the page
 * applies the latest value idempotently).
 */

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

/** The spy's calls carrying one bridge message type. */
function bridgeCalls(
  postMessage: ReturnType<typeof vi.fn>,
  type: 'pnds:theme' | 'pnds:locale'
) {
  return postMessage.mock.calls.filter(call => call[0]?.type === type)
}

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
    useSettingsStore.setState({ colorThemeSetting: 'pond' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pushes the theme on iframe load, at the exact monitor origin', () => {
    render(<MonitorView />)
    const postMessage = framePostMessage()

    fireEvent.load(screen.getByTitle('Project monitor'))

    const themeCalls = bridgeCalls(postMessage, 'pnds:theme')
    expect(themeCalls).toHaveLength(1)
    const firstCall = themeCalls[0]
    const message = firstCall?.[0]
    const origin = firstCall?.[1]
    expect(origin).toBe('http://192.168.1.10:6869') // never '*'
    expect(message.type).toBe('pnds:theme')
    expect(message.theme).toBe('pond')
    expect(message.palette.accent).toBe('#5a4ff3')
  })

  it('re-pushes when the theme changes', () => {
    render(<MonitorView />)
    const postMessage = framePostMessage()
    fireEvent.load(screen.getByTitle('Project monitor'))

    act(() => {
      useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    })

    const themeCalls = bridgeCalls(postMessage, 'pnds:theme')
    expect(themeCalls).toHaveLength(2)
    expect(themeCalls.at(-1)?.[0].theme).toBe('brutal')
  })

  it('re-pushes on every window regain (latest value wins)', () => {
    render(<MonitorView />)
    const postMessage = framePostMessage()

    fireEvent.load(screen.getByTitle('Project monitor'))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    // Load + the focus regain — the suspended-OOPIF backstop.
    const themeCalls = bridgeCalls(postMessage, 'pnds:theme')
    expect(themeCalls.length).toBeGreaterThanOrEqual(2)
    expect(themeCalls.at(-1)?.[0].type).toBe('pnds:theme')
  })

  it('pushes again after a monitor reload', () => {
    render(<MonitorView />)
    const first = framePostMessage()
    fireEvent.load(screen.getByTitle('Project monitor'))
    expect(bridgeCalls(first, 'pnds:theme')).toHaveLength(1)

    act(() => {
      useSessionStore.getState().bumpMonitorReload()
    })
    const second = framePostMessage()
    fireEvent.load(screen.getByTitle('Project monitor'))

    const themeCalls = bridgeCalls(second, 'pnds:theme')
    expect(themeCalls).toHaveLength(1)
    expect(themeCalls[0]?.[0].theme).toBe('pond')
  })
})

/**
 * v1.3.0 (#54): the locale bridge's delivery timing — the same triggers
 * as the theme bridge (load, language switch, window regain, reload),
 * carrying the RESOLVED language code, not the General setting.
 */
describe('MonitorView locale bridge (#54)', () => {
  beforeEach(async () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      sessionLanIp: '192.168.1.10',
      lanIp: '192.168.1.10',
      health: readyHealth,
    })
    useSettingsStore.setState({ colorThemeSetting: 'pond' })
    // The i18n singleton is shared across the whole file — pin the
    // language each time so a previous test's switch cannot leak in.
    await i18n.changeLanguage('en')
  })
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('pushes the locale on iframe load, at the exact monitor origin', () => {
    render(<MonitorView />)
    const postMessage = framePostMessage()

    fireEvent.load(screen.getByTitle('Project monitor'))

    const localeCalls = bridgeCalls(postMessage, 'pnds:locale')
    expect(localeCalls).toHaveLength(1)
    const firstCall = localeCalls[0]
    const message = firstCall?.[0]
    const origin = firstCall?.[1]
    expect(origin).toBe('http://192.168.1.10:6869') // never '*'
    expect(message.type).toBe('pnds:locale')
    expect(message.version).toBe(1)
    expect(message.locale).toBe('en')
  })

  it('re-pushes when the resolved language changes', async () => {
    render(<MonitorView />)
    const postMessage = framePostMessage()
    fireEvent.load(screen.getByTitle('Project monitor'))

    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })

    const localeCalls = bridgeCalls(postMessage, 'pnds:locale')
    expect(localeCalls).toHaveLength(2)
    expect(localeCalls.at(-1)?.[0].locale).toBe('zh-CN')
  })

  it('re-pushes on every window regain (latest value wins)', () => {
    render(<MonitorView />)
    const postMessage = framePostMessage()

    fireEvent.load(screen.getByTitle('Project monitor'))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    const localeCalls = bridgeCalls(postMessage, 'pnds:locale')
    expect(localeCalls.length).toBeGreaterThanOrEqual(2)
    expect(localeCalls.at(-1)?.[0].type).toBe('pnds:locale')
  })

  it('pushes again after a monitor reload', () => {
    render(<MonitorView />)
    const first = framePostMessage()
    fireEvent.load(screen.getByTitle('Project monitor'))
    expect(bridgeCalls(first, 'pnds:locale')).toHaveLength(1)

    act(() => {
      useSessionStore.getState().bumpMonitorReload()
    })
    const second = framePostMessage()
    fireEvent.load(screen.getByTitle('Project monitor'))

    const localeCalls = bridgeCalls(second, 'pnds:locale')
    expect(localeCalls).toHaveLength(1)
    expect(localeCalls[0]?.[0].locale).toBe('en')
  })
})

/**
 * v1.3.0 (#49/#54): the iframe URL carries `?theme=` and `?lang=` as
 * first-frame parameters — the single thing that removes the
 * light-then-dark flash (and the wrong-language flash) on dark themes.
 * The src is snapshotted per navigation: a live theme or language
 * switch must NOT retarget it (that would reload the live monitor; the
 * bridges push updates instead), while a reload re-snapshots it.
 */
describe('MonitorView iframe URL (#49)', () => {
  beforeEach(async () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      lanIp: '192.168.1.10',
      health: readyHealth,
    })
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    await i18n.changeLanguage('en')
  })
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  const frameSrc = () =>
    (screen.getByTitle('Project monitor') as HTMLIFrameElement).getAttribute(
      'src'
    )

  it('navigates to the monitor address with the current theme and language on first frame', () => {
    render(<MonitorView />)

    expect(frameSrc()).toBe('http://192.168.1.10:6869/?theme=brutal&lang=en')
  })

  it('keeps the src frozen across a live theme switch (the bridge owns updates)', () => {
    render(<MonitorView />)

    act(() => {
      useSettingsStore.setState({ colorThemeSetting: 'stage' })
    })

    // Still the snapshot from the last navigation — retargeting the src
    // would reload the live monitor page.
    expect(frameSrc()).toBe('http://192.168.1.10:6869/?theme=brutal&lang=en')
  })

  it('keeps the src frozen across a live language switch (the bridge owns updates)', async () => {
    render(<MonitorView />)

    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })

    expect(frameSrc()).toBe('http://192.168.1.10:6869/?theme=brutal&lang=en')
  })

  it('re-snapshots the theme and language when the monitor reloads', async () => {
    render(<MonitorView />)

    await act(async () => {
      await i18n.changeLanguage('zh-CN')
      useSettingsStore.setState({ colorThemeSetting: 'stage' })
      useSessionStore.getState().bumpMonitorReload()
    })

    expect(frameSrc()).toBe('http://192.168.1.10:6869/?theme=stage&lang=zh-CN')
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

  it('carries the reveal-motion marker so Brutal cannot snap the cross-fade', () => {
    // theme-variables.css exempts [data-reveal-motion] from Brutal's
    // global `transition-duration: 0s !important`; without the marker
    // the #50 cross-fade hard-cuts under that theme (user report).
    render(<MonitorView />)
    expect(cover().hasAttribute('data-reveal-motion')).toBe(true)
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

/**
 * v1.3.3 (#84): the title strip's name resolution — a user display-name
 * override still wins, the built-in tool's concise alias (resolved from
 * its registry id, ABOVE the learned names) is the second stop, and the
 * session's manifest name is the fallback. A running tool must read the
 * same name as its sidebar card.
 */
describe('MonitorView title strip (#84)', () => {
  const TOOL_PATH =
    '/Applications/PNDS.app/Contents/Resources/utilities/multichannel-signal-generator'

  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Multichannel Signal Generator',
      sessionProjectPath: TOOL_PATH,
      lanIp: '192.168.1.10',
      health: readyHealth,
    })
    useProjectStore.setState({
      projectDisplayNames: {},
      manifestProjectNames: {},
    })
  })

  it('keeps the alias over the manifest name preflight learned (user report on #84)', () => {
    // Selecting the tool runs its preflight, which learns the FORMAL
    // manifest name into the map — the title must not flip back to the
    // truncating long name.
    useProjectStore.setState({
      manifestProjectNames: { [TOOL_PATH]: 'Multichannel Signal Generator' },
    })

    render(<MonitorView />)

    expect(screen.getByText('PNDS - Multichannel Gen')).toBeTruthy()
  })

  it('keeps a user display-name override above the alias', () => {
    useProjectStore.setState({
      projectDisplayNames: { [TOOL_PATH]: 'My MSG' },
      manifestProjectNames: { [TOOL_PATH]: 'Multichannel Signal Generator' },
    })

    render(<MonitorView />)

    expect(screen.getByText('PNDS - My MSG')).toBeTruthy()
  })

  it('falls back to the session-reported manifest name', () => {
    // A regular project carries no alias, so an empty name map falls
    // through to the name the session itself reports.
    useSessionStore.setState({
      sessionProjectPath: '/Users/test/inarticulate-iii',
      projectName: 'Inarticulate III',
    })

    render(<MonitorView />)

    expect(screen.getByText('PNDS - Inarticulate III')).toBeTruthy()
  })
})
