import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect, useRef } from 'react'
import { fireEvent, render, screen, act } from '@/test/test-utils'
import {
  useGuestFocusGate,
  isGuestFocusPayload,
  GUEST_FOCUS_MESSAGE_TYPE,
  type GuestFocusGate,
} from './use-guest-focus-gate'

/**
 * The guest-focus gate's own tests — the #105 guest gate and the #107
 * pointer-area gate, driven through the hook's interface exactly as
 * MonitorView binds it (window events, the iframe's mouse handlers, the
 * reporter's postMessages). MonitorView.test.tsx still exercises the
 * same machine end-to-end through the rendered view (keyboard focus and
 * bridge delivery); this file owns the gate's own branches.
 */

let gate: GuestFocusGate | null = null
let onReclaim: ReturnType<typeof vi.fn<() => void>>
let onRegain: ReturnType<typeof vi.fn<() => void>>

/** One monitor iframe with the gate bound as MonitorView binds it; the
 * controller and the spies are captured from an effect (a render-phase
 * assignment would be a side effect — the compiler lint blocks it). */
function Harness() {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const controller = useGuestFocusGate({ frame, onReclaim, onRegain })
  useEffect(() => {
    gate = controller
  })
  return (
    <iframe
      ref={frame}
      title="Project monitor"
      onMouseEnter={controller.onFramePointerEnter}
      onMouseLeave={controller.onFramePointerLeave}
    />
  )
}

const frame = () => screen.getByTitle('Project monitor') as HTMLIFrameElement

/** Posts a pnds:guest-focus signal as if sent by the monitor iframe. */
function postGuestFocus(interacting: boolean, source?: MessageEventSource) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: GUEST_FOCUS_MESSAGE_TYPE, interacting },
      source: source ?? frame().contentWindow,
    })
  )
}

/** A window focus regain — the #29 desktop-switch steal path. */
const regainFocus = () => window.dispatchEvent(new Event('focus'))

beforeEach(() => {
  onReclaim = vi.fn()
  onRegain = vi.fn()
  gate = null
})

describe('guest focus wire contract', () => {
  it('pins the message type the Rust reporter is built from', () => {
    // The cross-language pin: window.rs's GUEST_FOCUS_MESSAGE_TYPE (the
    // const the injected script is built from) must carry this literal —
    // its unit test does the same on the Rust side.
    expect(GUEST_FOCUS_MESSAGE_TYPE).toBe('pnds:guest-focus')
  })

  it('accepts only the reporter payload', () => {
    expect(
      isGuestFocusPayload({ type: 'pnds:guest-focus', interacting: true })
    ).toBe(true)
    expect(
      isGuestFocusPayload({ type: 'pnds:guest-focus', interacting: false })
    ).toBe(true)
    // Anything else flying by on `message` must not move the gate.
    expect(isGuestFocusPayload(null)).toBe(false)
    expect(isGuestFocusPayload('pnds:guest-focus')).toBe(false)
    expect(isGuestFocusPayload({})).toBe(false)
    expect(isGuestFocusPayload({ type: 'pnds:theme' })).toBe(false)
    expect(
      isGuestFocusPayload({ type: 'pnds:guest-focus' }) // no interacting flag
    ).toBe(false)
    expect(
      isGuestFocusPayload({ type: 'pnds:guest-focus', interacting: 'yes' })
    ).toBe(false)
  })
})

describe('guest focus gate (#105)', () => {
  it('reclaims when focus is stranded and nothing gates hold', () => {
    // The #29 spontaneous steal: no guest signal at all, the window
    // regains focus, activeElement sits on the body — reclaim.
    render(<Harness />)
    expect(gate).not.toBeNull()

    regainFocus()

    expect(onReclaim).toHaveBeenCalledTimes(1)
  })

  it('every reclaim path stands down while the guest page interacts', () => {
    vi.useFakeTimers()
    try {
      render(<Harness />)
      postGuestFocus(true)

      // Window regain, visibility regain and the 2s heartbeat all pass
      // through the one gated choke point — none may steal.
      act(() => {
        regainFocus()
        document.dispatchEvent(new Event('visibilitychange'))
        vi.advanceTimersByTime(2000)
      })
      expect(onReclaim).not.toHaveBeenCalled()

      // The focus-neutral regain (where the bridges ride) still fires on
      // every path — one per event plus one heartbeat tick.
      expect(onRegain).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the heartbeat alone reclaims without any event arriving', () => {
    vi.useFakeTimers()
    try {
      render(<Harness />)

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(onReclaim).toHaveBeenCalledTimes(1)
      expect(onRegain).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('focus falling back to the page body hands the keyboard over at once', () => {
    render(<Harness />)
    postGuestFocus(true)
    postGuestFocus(false)

    expect(onReclaim).toHaveBeenCalledTimes(1)
  })

  it('messages from anywhere but this iframe leave the gate untouched', () => {
    render(<Harness />)
    postGuestFocus(true)

    // A foreign source claiming the interaction ended — ignored.
    postGuestFocus(false, {} as MessageEventSource)
    // A malformed payload from the right source — ignored too.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GUEST_FOCUS_MESSAGE_TYPE, interacting: 'yes' },
        source: frame().contentWindow,
      })
    )
    regainFocus()
    expect(onReclaim).not.toHaveBeenCalled()

    // The real end-of-interaction signal still lands afterwards.
    postGuestFocus(false)
    expect(onReclaim).toHaveBeenCalledTimes(1)
  })

  it('rearm drops the gate for a freshly loaded document', () => {
    render(<Harness />)
    postGuestFocus(true)
    regainFocus()
    expect(onReclaim).not.toHaveBeenCalled()

    // The iframe's onLoad path: the fresh document starts with the gate
    // down (no interaction yet — its reporter re-registers with it).
    gate?.rearm()
    regainFocus()

    expect(onReclaim).toHaveBeenCalledTimes(1)
  })

  it('never reclaims while a meaningful main-frame holder has focus', () => {
    render(<Harness />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    regainFocus()

    expect(onReclaim).not.toHaveBeenCalled()
    // The bridges' regain is focus-neutral — it rides anyway.
    expect(onRegain).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('tears its listeners down on unmount', () => {
    const { unmount } = render(<Harness />)
    const contentWindow = frame().contentWindow
    unmount()

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: GUEST_FOCUS_MESSAGE_TYPE, interacting: false },
        source: contentWindow,
      })
    )
    regainFocus()

    expect(onReclaim).not.toHaveBeenCalled()
    expect(onRegain).not.toHaveBeenCalled()
  })
})

describe('pointer-area gate (#107)', () => {
  /** jsdom implements neither elementFromPoint nor layout: a stub hit
   * test, defaulting to "the pointer is over app chrome". */
  let hitTest: ReturnType<
    typeof vi.fn<(x: number, y: number) => Element | null>
  >

  beforeEach(() => {
    hitTest = vi.fn(() => document.body)
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      writable: true,
      value: hitTest,
    })
  })

  afterEach(() => {
    delete (
      document as {
        elementFromPoint?: (x: number, y: number) => Element | null
      }
    ).elementFromPoint
  })

  it('the pointer inside the frame suppresses the reclaim without any guest signal', () => {
    render(<Harness />)

    hitTest.mockReturnValue(frame())
    fireEvent.mouseEnter(frame(), { clientX: 120, clientY: 200 })
    regainFocus()

    expect(onReclaim).not.toHaveBeenCalled()
  })

  it('leaving the frame re-arms the reclaim once the debounce window passes', () => {
    vi.useFakeTimers()
    try {
      render(<Harness />)

      hitTest.mockReturnValue(frame())
      fireEvent.mouseEnter(frame(), { clientX: 120, clientY: 200 })
      hitTest.mockReturnValue(document.body)
      fireEvent.mouseLeave(frame())

      // Inside the debounce window the gate still holds.
      act(() => {
        regainFocus()
      })
      expect(onReclaim).not.toHaveBeenCalled()

      // Past the window the pending leave lifts the gate and reclaims
      // at once — no waiting for the next heartbeat.
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(onReclaim).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-entering during the debounce window cancels the pending leave', () => {
    vi.useFakeTimers()
    try {
      render(<Harness />)

      hitTest.mockReturnValue(frame())
      fireEvent.mouseEnter(frame(), { clientX: 120, clientY: 200 })
      hitTest.mockReturnValue(document.body)
      fireEvent.mouseLeave(frame())
      hitTest.mockReturnValue(frame())
      fireEvent.mouseEnter(frame(), { clientX: 130, clientY: 210 })

      act(() => {
        vi.advanceTimersByTime(1000)
        regainFocus()
      })
      expect(onReclaim).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a missed leave self-corrects from the last known pointer coordinates', () => {
    render(<Harness />)

    // The enter landed inside the frame…
    hitTest.mockImplementation((x: number) =>
      x < 100 ? document.body : frame()
    )
    fireEvent.mouseEnter(frame(), { clientX: 120, clientY: 200 })
    // …the leave never fires (a suspended webview drops it), but the
    // pointer moved onto app chrome — the hit test at the fresh
    // coordinates says so, and the reclaim re-runs the gate.
    fireEvent.mouseMove(window, { clientX: 40, clientY: 40 })
    regainFocus()

    expect(onReclaim).toHaveBeenCalledTimes(1)
  })
})
