import { fireEvent, render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSessionStore } from '@/store/session-store'
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
