import { fireEvent, render, screen, act } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
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
