import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachCoverTitleFit } from './title-fit'

class Fonts extends EventTarget {
  status = 'loaded'
  resolve!: () => void
  reject!: (reason: Error) => void
  ready = new Promise<void>((resolve, reject) => {
    this.resolve = resolve
    this.reject = reject
  })
}

let resize: () => void
let disconnect: ReturnType<typeof vi.fn>
let fonts: Fonts
let hidden: boolean
let disposers: (() => void)[]
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden')

beforeEach(() => {
  vi.useFakeTimers()
  disposers = []
  hidden = false
  fonts = new Fonts()
  disconnect = vi.fn()
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  })
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe = vi.fn()
      disconnect = disconnect
    }
  )
})

afterEach(() => {
  disposers.forEach(dispose => dispose())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else Reflect.deleteProperty(document, 'fonts')
  if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden)
  else Reflect.deleteProperty(document, 'hidden')
})

/** Exercise the real DOM adapter. Each probe's geometry is frozen on insertion,
 * as in the older WebKit intrinsic-width cache; changing it later cannot work.
 * Deliberately dishonest h1 widths/font-size must never drive the fit. */
function fixture(available = 1100) {
  const zone = document.createElement('div')
  zone.style.paddingLeft = '20px'
  zone.style.paddingRight = '30px'
  const title = document.createElement('h1')
  title.innerHTML = '<span>失</span><span>语</span> III'
  zone.appendChild(title)
  document.body.appendChild(zone)
  const metrics = {
    available,
    em: 100,
    zeroWidth: 630,
    slope: 10,
    valid: true,
    resizedExtra: 0,
  }
  Object.defineProperty(zone, 'clientWidth', {
    get: () => metrics.available + 50,
  })
  Object.defineProperty(title, 'scrollWidth', { value: 9999 })
  Object.defineProperty(title, 'clientWidth', { value: 9999 })
  const computedStyle = getComputedStyle
  vi.stubGlobal('getComputedStyle', (node: Element) => {
    const style = computedStyle(node)
    if (node !== title) return style
    return { fontSize: '999px', direction: title.style.direction || 'ltr' }
  })
  const rects = new Map<Node, DOMRect>()
  const append = zone.appendChild.bind(zone)
  vi.spyOn(zone, 'appendChild').mockImplementation(node => {
    const probe = node as HTMLElement
    expect(probe.style.position).toBe('absolute')
    expect(probe.style.visibility).toBe('hidden')
    expect(probe.style.width).toBe('max-content')
    expect(probe.textContent).toBe(title.textContent)
    expect(rects.has(node)).toBe(false)
    const em = parseFloat(probe.style.fontSize) || metrics.em
    const spacing = probe.style.letterSpacing
      ? parseFloat(probe.style.letterSpacing)
      : 0.37 * em
    const extra = probe.style.fontSize ? metrics.resizedExtra : 0
    const width =
      ((metrics.zeroWidth + extra) * em) / metrics.em + metrics.slope * spacing
    rects.set(
      node,
      new DOMRect(
        0,
        0,
        metrics.valid ? width : 0,
        metrics.valid ? em * 1.05 : 0
      )
    )
    return append(node)
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      expect(this.isConnected).toBe(true)
      const rect = rects.get(this)
      if (!rect) throw new Error('Only fresh title probes may be measured')
      return rect
    }
  )
  const attach = () => {
    const dispose = attachCoverTitleFit(title)
    disposers.push(dispose)
    return dispose
  }
  const width = () => {
    const em = parseFloat(title.style.fontSize) || metrics.em
    const spacing = parseFloat(title.style.letterSpacing) || 0
    const extra = title.style.fontSize ? metrics.resizedExtra : 0
    return (
      ((metrics.zeroWidth + extra) * em) / metrics.em +
      (metrics.slope + 1) * spacing
    )
  }
  return { title, zone, metrics, rects, attach, width }
}

describe('cover title fit lifetime', () => {
  it.each([
    ['design tracking', 1100],
    ['squeezed tracking', 900],
    ['smaller type', 500],
  ])(
    'commits %s before paint using fresh probes in the padded zone',
    (_, available) => {
      const f = fixture(available)
      f.attach()
      expect(f.title.style.visibility).toBe('')
      expect(f.width()).toBeLessThanOrEqual(available + 0.5)
      if (available === 1100) expect(f.title.style.letterSpacing).toBe('37px')
      else if (available === 900) {
        expect(parseFloat(f.title.style.letterSpacing)).toBeGreaterThan(0)
        expect(parseFloat(f.title.style.letterSpacing)).toBeLessThan(37)
        expect(f.title.style.fontSize).toBe('')
      } else {
        expect(f.title.style.letterSpacing).toBe('0px')
        expect(parseFloat(f.title.style.fontSize)).toBeCloseTo(
          (100 * 500) / 630
        )
      }
      expect(f.zone.children).toHaveLength(1)
      expect([...f.rects.keys()].every(node => !node.isConnected)).toBe(true)
    }
  )

  it('uses a bounded ratio fallback when the initial model stops matching resized probes', () => {
    const f = fixture(500)
    // Simulate metrics changing between the baseline probes and resized probes.
    f.metrics.resizedExtra = 900
    f.attach()
    expect(f.title.style.letterSpacing).toBe('0px')
    expect(parseFloat(f.title.style.fontSize)).toBeGreaterThanOrEqual(25)
    expect(f.width()).toBeLessThanOrEqual(500.5)
    expect(f.rects.size).toBeLessThanOrEqual(10)
    const size = f.title.style.fontSize
    resize()
    expect(f.title.style.fontSize).toBe(size)
    expect(f.zone.children).toHaveLength(1)
  })

  it('centers RTL in the opposite direction and repeated fits do not drift', () => {
    const f = fixture(900)
    f.title.style.direction = 'rtl'
    f.attach()
    const spacing = f.title.style.letterSpacing
    const transform = f.title.style.transform
    expect(transform).toBe(`translateX(${-parseFloat(spacing) / 2}px)`)
    resize()
    vi.advanceTimersByTime(5000)
    expect(f.title.style.letterSpacing).toBe(spacing)
    expect(f.title.style.transform).toBe(transform)
  })

  it('tracks zone resize and recovers the class font size when widened', () => {
    const f = fixture(500)
    f.attach()
    f.metrics.available = 900
    resize()
    expect(f.title.style.fontSize).toBe('')
    expect(f.width()).toBeLessThanOrEqual(900.5)
    f.metrics.available = 1100
    resize()
    expect(f.title.style.letterSpacing).toBe('37px')
    expect(f.title.style.transform).toBe('translateX(18.5px)')
  })

  it('retries late geometry and cancels the outstanding retry once measured', () => {
    const f = fixture()
    f.metrics.valid = false
    f.attach()
    resize()
    resize()
    expect(vi.getTimerCount()).toBe(4) // one retry and three finite verification beats
    f.metrics.valid = true
    vi.advanceTimersByTime(300)
    expect(f.title.style.letterSpacing).toBe('37px')
    expect(vi.getTimerCount()).toBe(3)
  })

  it('rejects a collapsed spacing slope and repairs it when the engine starts answering', () => {
    const f = fixture()
    f.metrics.slope = 0
    f.attach()
    expect(f.title.style.letterSpacing).toBe('')
    expect(f.title.style.fontSize).toBe('')
    f.metrics.slope = 10
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(f.title.style.letterSpacing).toBe('37px')
    expect(vi.getTimerCount()).toBe(3)
  })

  it('bounds degenerate retries and releases every timer and probe', () => {
    const f = fixture()
    f.metrics.valid = false
    const dispose = f.attach()
    resize()
    fonts.dispatchEvent(new Event('loadingdone'))
    vi.advanceTimersByTime(10000)
    expect(vi.getTimerCount()).toBe(0)
    const probes = f.rects.size
    vi.advanceTimersByTime(10000)
    expect(f.rects.size).toBe(probes)
    expect(f.zone.children).toHaveLength(1)
    dispose()
    expect(disconnect).toHaveBeenCalled()
  })

  it('waits for the reduced-motion hold and restarts the quiet window on resize', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const f = fixture()
    f.attach()
    expect(f.title.style.visibility).toBe('hidden')
    vi.advanceTimersByTime(140)
    f.metrics.available = 500
    resize()
    vi.advanceTimersByTime(89)
    expect(f.title.style.visibility).toBe('hidden')
    vi.advanceTimersByTime(1)
    expect(f.title.style.visibility).toBe('')
    expect(f.width()).toBeLessThanOrEqual(500.5)
  })

  it('does not reveal during font loading or hidden boot; the finite cap still reveals', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    fonts.status = 'loading'
    hidden = true
    const f = fixture()
    f.attach()
    vi.advanceTimersByTime(599)
    expect(f.title.style.visibility).toBe('hidden')
    vi.advanceTimersByTime(1)
    expect(f.title.style.visibility).toBe('')
  })

  it('reveals reduced motion after visible fonts settle, before the fallback cap', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    fonts.status = 'loading'
    hidden = true
    const f = fixture()
    f.attach()
    vi.advanceTimersByTime(200)
    expect(f.title.style.visibility).toBe('hidden')
    fonts.status = 'loaded'
    hidden = false
    f.metrics.available = 500
    fonts.dispatchEvent(new Event('loadingdone'))
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(89)
    expect(f.title.style.visibility).toBe('hidden')
    vi.advanceTimersByTime(1)
    expect(f.title.style.visibility).toBe('')
    expect(f.width()).toBeLessThanOrEqual(500.5)
  })

  it('refits on visibility, font ready and subsequent font batches', async () => {
    const f = fixture()
    f.attach()
    f.metrics.available = 500
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(f.title.style.fontSize).toBe('')
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(f.width()).toBeLessThanOrEqual(500.5)
    f.metrics.available = 1100
    fonts.resolve()
    await Promise.resolve()
    expect(f.title.style.letterSpacing).toBe('37px')
    f.metrics.zeroWidth = 1000
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(f.width()).toBeLessThanOrEqual(1100.5)
    expect(parseFloat(f.title.style.letterSpacing)).toBeLessThan(37)
  })

  it.each(['resolve', 'reject', 'timeout'] as const)(
    'reveals a motion-allowed cold-font boot on %s',
    async action => {
      fonts.status = 'loading'
      const f = fixture()
      f.attach()
      expect(f.title.style.visibility).toBe('hidden')
      if (action === 'timeout') vi.advanceTimersByTime(400)
      else {
        fonts.status = 'loaded'
        if (action === 'resolve') fonts.resolve()
        else fonts.reject(new Error('Font load failed'))
        await Promise.resolve()
        await Promise.resolve()
      }
      expect(f.title.style.visibility).toBe('')
      expect(f.title.style.letterSpacing).toBe('37px')
    }
  )

  it('disposes queued callbacks even when the same h1 is reused for the next title', async () => {
    fonts.status = 'loading'
    const f = fixture()
    const dispose = f.attach()
    const oldResize = resize
    const probes = f.rects.size
    dispose()
    expect(f.title.style.visibility).toBe('')
    expect(vi.getTimerCount()).toBe(0)
    f.title.textContent = '下一部作品'
    f.title.style.letterSpacing = '123px' // the next lifetime owns the styles
    f.title.style.visibility = 'hidden'
    oldResize()
    fonts.dispatchEvent(new Event('loadingdone'))
    document.dispatchEvent(new Event('visibilitychange'))
    fonts.resolve()
    await Promise.resolve()
    await Promise.resolve()
    vi.advanceTimersByTime(10000)
    expect(f.title.style.letterSpacing).toBe('123px')
    expect(f.title.style.visibility).toBe('hidden')
    expect(f.rects.size).toBe(probes)
    expect(vi.getTimerCount()).toBe(0)
  })
})
