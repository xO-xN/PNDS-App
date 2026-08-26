import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, fireEvent, waitFor } from '@testing-library/react'
import {
  applyIndicatorGeometry,
  clearIndicatorGeometry,
  useIndicatorPill,
} from './use-indicator-pill'

/** jsdom may or may not ship a FontFaceSet — pin document.fonts so the
 *  engine's font listener is test-deterministic: never-resolving by
 *  default, a controlled promise where a test drives it. */
function stubFontsReady(ready: Promise<void>): void {
  Reflect.deleteProperty(document, 'fonts')
  Object.defineProperty(document, 'fonts', {
    value: { ready },
    configurable: true,
  })
}

let restoreFonts: () => void

beforeEach(() => {
  const hadOwn = Object.prototype.hasOwnProperty.call(document, 'fonts')
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
  stubFontsReady(new Promise(() => undefined))
  restoreFonts = () => {
    Reflect.deleteProperty(document, 'fonts')
    if (hadOwn && descriptor) {
      Object.defineProperty(document, 'fonts', descriptor)
    }
  }
})

afterEach(() => {
  restoreFonts()
})

describe('useIndicatorPill (v1.3.2 issue #78 engine)', () => {
  it('applies after every commit and never re-measures on its own', () => {
    const apply = vi.fn()
    const remeasure = vi.fn()

    const { rerender } = renderHook(() =>
      useIndicatorPill({ apply, remeasure })
    )
    expect(apply).toHaveBeenCalledTimes(1)

    rerender()
    rerender()

    expect(apply).toHaveBeenCalledTimes(3)
    expect(remeasure).not.toHaveBeenCalled()
  })

  it('re-measures on resize through the latest render config', () => {
    const firstRemeasure = vi.fn()
    const secondRemeasure = vi.fn()
    const secondApply = vi.fn()

    const { rerender } = renderHook(config => useIndicatorPill(config), {
      initialProps: { apply: vi.fn(), remeasure: firstRemeasure },
    })

    rerender({ apply: secondApply, remeasure: secondRemeasure })
    fireEvent(window, new Event('resize'))

    expect(secondRemeasure).toHaveBeenCalledTimes(1)
    expect(firstRemeasure).not.toHaveBeenCalled()
    // The resize went to remeasure, not a second apply.
    expect(secondApply).toHaveBeenCalledTimes(1)
  })

  it('falls back to apply on resize when no remeasure is given', () => {
    const apply = vi.fn()

    const { rerender } = renderHook(() => useIndicatorPill({ apply }))
    rerender()
    fireEvent(window, new Event('resize'))

    expect(apply).toHaveBeenCalledTimes(3)
  })

  it('re-measures once web fonts are ready', async () => {
    let resolveFonts: () => void = () => undefined
    stubFontsReady(
      new Promise<void>(resolve => {
        resolveFonts = resolve
      })
    )
    const apply = vi.fn()
    const remeasure = vi.fn()

    renderHook(() => useIndicatorPill({ apply, remeasure }))
    expect(remeasure).not.toHaveBeenCalled()

    resolveFonts()
    await waitFor(() => expect(remeasure).toHaveBeenCalledTimes(1))
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('stops re-measuring on resize after unmount', () => {
    const apply = vi.fn()
    const remeasure = vi.fn()

    const { unmount } = renderHook(() => useIndicatorPill({ apply, remeasure }))
    unmount()

    fireEvent(window, new Event('resize'))

    expect(apply).toHaveBeenCalledTimes(1)
    expect(remeasure).not.toHaveBeenCalled()
  })
})

/** The test DOM has no layout, so the offset* properties stay 0 — pin the
 *  pair the axis under test reads. (document.fonts.ready is never
 *  cancelled on unmount, same as production: callers tolerate a late
 *  re-measure by no-oping on null refs, which the resize path here can't
 *  hit once the listener is gone.) */
function pinnedTarget(
  offsets: Partial<
    Record<'offsetLeft' | 'offsetTop' | 'offsetWidth' | 'offsetHeight', number>
  >
): HTMLDivElement {
  const target = document.createElement('div')
  for (const [key, value] of Object.entries(offsets)) {
    Object.defineProperty(target, key, { value })
  }
  return target
}

describe('applyIndicatorGeometry', () => {
  it('writes translateX and width on the x axis (folder-pill shape)', () => {
    const pill = document.createElement('div')
    const target = pinnedTarget({ offsetLeft: 32, offsetWidth: 120 })

    applyIndicatorGeometry(pill, target, 'x')

    expect(pill.style.transform).toBe('translateX(32px)')
    expect(pill.style.width).toBe('120px')
    expect(pill.style.height).toBe('')
  })

  it('writes translateY and height on the y axis (card-pill shape)', () => {
    const pill = document.createElement('div')
    const target = pinnedTarget({ offsetTop: 56, offsetHeight: 88 })

    applyIndicatorGeometry(pill, target, 'y')

    expect(pill.style.transform).toBe('translateY(56px)')
    expect(pill.style.height).toBe('88px')
    expect(pill.style.width).toBe('')
  })
})

describe('clearIndicatorGeometry', () => {
  it('hands both geometry properties back to the stylesheet', () => {
    const pillX = document.createElement('div')
    applyIndicatorGeometry(
      pillX,
      pinnedTarget({ offsetLeft: 32, offsetWidth: 120 }),
      'x'
    )
    const pillY = document.createElement('div')
    applyIndicatorGeometry(
      pillY,
      pinnedTarget({ offsetTop: 56, offsetHeight: 88 }),
      'y'
    )

    clearIndicatorGeometry(pillX, 'x')
    clearIndicatorGeometry(pillY, 'y')

    expect(pillX.style.transform).toBe('')
    expect(pillX.style.width).toBe('')
    expect(pillY.style.transform).toBe('')
    expect(pillY.style.height).toBe('')
  })
})
