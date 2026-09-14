import { render, screen, act, fireEvent } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

    act(() => {
      listeners.get('pnds:projection-theme')?.({ colorTheme: 'pond' })
    })
    await flush()
    expect(document.documentElement.getAttribute('data-color-theme')).toBe(
      'pond'
    )
  })
})
