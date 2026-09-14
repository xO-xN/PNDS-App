import { render, screen, act, fireEvent } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import type { SessionSnapshot } from '@/lib/tauri-bindings'
import { MONITOR_REVEAL_FADE_MS } from '@/lib/monitor-reveal'
import { ProjectionApp } from './ProjectionApp'

/**
 * v1.5.0 (#129): the projection thin root — driven by snapshot
 * SEQUENCES through the same mocked event channel the app uses. The
 * acceptance is about transitions: opening during a run lands DIRECTLY
 * on the monitor with the main-window URL contract (no standby flash),
 * a close/switch fades back to 投影待机, the window reveals itself once
 * its first snapshot settles, and the native title follows the content
 * and the UI language.
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

describe('ProjectionApp (#129)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot(),
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lands directly on the monitor for a running session — no standby flash', async () => {
    render(<ProjectionApp />)
    await flush()

    // The main window's first-frame URL contract (#49/#54).
    const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement
    expect(iframe.src).toBe('http://192.168.1.10:6869/?theme=pond&lang=en')
    expect(screen.queryByTestId('projection-standby')).not.toBeInTheDocument()
    // No cross-fade fired on boot: the first settled content rides the
    // window reveal instead.
    expect(screen.getByTestId('projection-swap-cover').className).toContain(
      'opacity-0'
    )
    // #51: hidden create → snapshot settled → the page reveals itself.
    expect(commands.fadeInWindow).toHaveBeenCalledWith('projection')
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

  it('holds the reveal cover until the iframe load event', async () => {
    vi.useFakeTimers()
    render(<ProjectionApp />)
    await flush()

    const cover = screen.getByTestId('projection-reveal-cover')
    expect(cover.className).not.toContain('opacity-0')

    fireEvent.load(screen.getByTitle('Project monitor'))
    expect(cover.className).toContain('opacity-0')
  })

  it('releases a stuck navigation through the timeout backstop', async () => {
    vi.useFakeTimers()
    render(<ProjectionApp />)
    await flush()

    const cover = screen.getByTestId('projection-reveal-cover')
    expect(cover.className).not.toContain('opacity-0')

    await act(async () => {
      vi.advanceTimersByTime(10_500)
    })
    expect(cover.className).toContain('opacity-0')
  })

  it('fades to standby when the session closes, and to the new monitor on a switch', async () => {
    vi.useFakeTimers()
    render(<ProjectionApp />)
    await flush()
    expect(screen.getByTitle('Project monitor')).toBeInTheDocument()

    // Close: stopping → idle. The themed cover fades in over the
    // outgoing monitor before the standby swap.
    publish(snapshot({ status: 'stopping' }))
    expect(screen.getByTestId('projection-swap-cover').className).toContain(
      'opacity-100'
    )
    await settleSwap()
    expect(screen.getByTestId('projection-standby')).toBeInTheDocument()

    // Switch: Load of the next project → ready at a new address. The
    // iframe re-navigates with fresh first-frame parameters.
    publish(
      snapshot({
        projectName: 'Other Work',
        hostAddress: '10.0.0.5',
        health: {
          status: 'ready',
          scoreServer: { performerPort: 7000, monitorPort: 7001, error: null },
        },
      })
    )
    await settleSwap()
    const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement
    expect(iframe.src).toBe('http://10.0.0.5:7001/?theme=pond&lang=en')
  })

  it('collapses a rapid switch sequence onto the newest content', async () => {
    vi.useFakeTimers()
    render(<ProjectionApp />)
    await flush()

    // ready → starting (fade in) → ready-B lands WITHIN the fade window:
    // the timer restarts and the single swap shows B, never A-standby-B.
    publish(snapshot({ status: 'starting' }))
    await act(async () => {
      vi.advanceTimersByTime(MONITOR_REVEAL_FADE_MS / 2)
    })
    publish(
      snapshot({
        hostAddress: '10.0.0.5',
        health: {
          status: 'ready',
          scoreServer: { performerPort: 7000, monitorPort: 7001, error: null },
        },
      })
    )
    await settleSwap()

    const iframe = screen.getByTitle('Project monitor') as HTMLIFrameElement
    expect(iframe.src).toBe('http://10.0.0.5:7001/?theme=pond&lang=en')
    expect(screen.getByTestId('projection-swap-cover').className).toContain(
      'opacity-0'
    )
  })

  it('titles the window with the projected project, plain on standby, following the language', async () => {
    vi.useFakeTimers()
    render(<ProjectionApp />)
    await flush()
    expect(setTitle).toHaveBeenLastCalledWith(
      'PNDS Projection — Inarticulate III'
    )

    // Close to standby: the plain title.
    publish(snapshot({ status: 'stopping' }))
    await settleSwap()
    publish(snapshot({ status: 'idle', projectName: null, health: null }))
    await settleSwap()
    expect(setTitle).toHaveBeenLastCalledWith('PNDS Projection')

    // A language switch re-titles live (the main-window bridge pushes
    // the locale; the page changes language).
    act(() => {
      listeners.get('pnds:projection-locale')?.({ locale: 'zh-CN' })
    })
    await flush()
    expect(setTitle).toHaveBeenLastCalledWith('PNDS 投影')

    // Restore the suite's language for the files that follow.
    act(() => {
      listeners.get('pnds:projection-locale')?.({ locale: 'en' })
    })
    await flush()
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

    // Restore the themed document for whatever renders next.
    act(() => {
      listeners.get('pnds:projection-theme')?.({ colorTheme: 'pond' })
    })
    await flush()
    expect(document.documentElement.getAttribute('data-color-theme')).toBe(
      'pond'
    )
  })
})
