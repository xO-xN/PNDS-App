import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, fireEvent, waitFor } from '@testing-library/react'
import { mockOffsets } from '@/test/test-utils'
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
    // The resize listener is what unmounting removes. document.fonts.ready
    // is never cancelled (same as production) — callers tolerate a late
    // re-measure by no-oping on null refs.
    const apply = vi.fn()
    const remeasure = vi.fn()

    const { unmount } = renderHook(() => useIndicatorPill({ apply, remeasure }))
    unmount()

    fireEvent(window, new Event('resize'))

    expect(apply).toHaveBeenCalledTimes(1)
    expect(remeasure).not.toHaveBeenCalled()
  })
})

/** A pill target with pinned geometry — the test DOM has no layout, so
 *  mockOffsets states the box the axis under test reads. */
function pinnedTarget(
  offsets: Parameters<typeof mockOffsets>[1]
): HTMLDivElement {
  const target = document.createElement('div')
  mockOffsets(target, offsets)
  return target
}

describe('applyIndicatorGeometry', () => {
  it('writes translateX and width on the x axis (folder-pill shape)', () => {
    const pill = document.createElement('div')
    const target = pinnedTarget({ left: 32, width: 120 })

    applyIndicatorGeometry(pill, target, 'x')

    expect(pill.style.transform).toBe('translateX(32px)')
    expect(pill.style.width).toBe('120px')
    expect(pill.style.height).toBe('')
  })

  it('writes translateY and height on the y axis (card-pill shape)', () => {
    const pill = document.createElement('div')
    const target = pinnedTarget({ top: 56, height: 88 })

    applyIndicatorGeometry(pill, target, 'y')

    expect(pill.style.transform).toBe('translateY(56px)')
    expect(pill.style.height).toBe('88px')
    expect(pill.style.width).toBe('')
  })
})

describe('clearIndicatorGeometry', () => {
  it('hands both geometry properties back to the stylesheet', () => {
    const pillX = document.createElement('div')
    applyIndicatorGeometry(pillX, pinnedTarget({ left: 32, width: 120 }), 'x')
    const pillY = document.createElement('div')
    applyIndicatorGeometry(pillY, pinnedTarget({ top: 56, height: 88 }), 'y')

    clearIndicatorGeometry(pillX, 'x')
    clearIndicatorGeometry(pillY, 'y')

    expect(pillX.style.transform).toBe('')
    expect(pillX.style.width).toBe('')
    expect(pillY.style.transform).toBe('')
    expect(pillY.style.height).toBe('')
  })
})
