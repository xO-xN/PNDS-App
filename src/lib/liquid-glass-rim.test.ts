import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let frames: Map<number, FrameRequestCallback>
let frameId: number
let observers: { notify: () => void; disconnect: ReturnType<typeof vi.fn> }[]
let decode: ReturnType<typeof vi.fn<() => Promise<void>>>
let destroyers: (() => void)[]

function flushFrame() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach(callback => callback(0))
}
async function decodedFrame() {
  await Promise.resolve()
  await Promise.resolve()
  flushFrame()
}
function targetWithSize(width = 100, height = 30) {
  const target = document.createElement('span')
  const size = { width, height }
  Object.defineProperties(target, {
    offsetWidth: { get: () => size.width },
    offsetHeight: { get: () => size.height },
  })
  document.body.appendChild(target)
  return { target, size }
}
async function attach(target: HTMLElement) {
  const { createRimLens } = await import('./liquid-glass-rim')
  const lens = createRimLens(target)
  destroyers.push(lens.destroy)
  return lens
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  frames = new Map()
  frameId = 0
  observers = []
  destroyers = []
  decode = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn()
      observe = vi.fn()
      constructor(callback: () => void) {
        observers.push({ notify: callback, disconnect: this.disconnect })
      }
    }
  )
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decode = decode
    }
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,AA=='
  )
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/130')
})
afterEach(() => {
  destroyers.forEach(destroy => destroy())
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('decorative rainbow-rim optics', () => {
  it('waits for a measured size and decoded map, then adapts refraction on resize', async () => {
    const { target, size } = targetWithSize(0, 0)
    await attach(target)
    flushFrame()
    expect(document.querySelector('filter')).toBeNull()
    expect(target.hasAttribute('data-rim-optics')).toBe(false)
    size.width = 150
    size.height = 30
    observers[0]?.notify()
    flushFrame()
    expect(target.style.filter).toBe('')
    await decodedFrame()
    expect(target.hasAttribute('data-rim-optics')).toBe(true)
    expect(target.style.clipPath).toContain('round 15px')
    expect(
      Number(document.querySelector('feDisplacementMap')?.getAttribute('scale'))
    ).toBeCloseTo(0.15)
    size.height = 40
    observers[0]?.notify()
    flushFrame()
    await decodedFrame()
    expect(target.style.clipPath).toContain('round 20px')
    expect(
      Number(document.querySelector('feDisplacementMap')?.getAttribute('scale'))
    ).toBeCloseTo(0.2)
    size.width = 0
    observers[0]?.notify()
    flushFrame()
    expect(target.style.filter).toBe('')
    expect(target.hasAttribute('data-rim-optics')).toBe(false)
  })

  it('does not apply stale asynchronous image work after disposal', async () => {
    let finish: (() => void) | undefined
    decode.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve
      })
    )
    const { target } = targetWithSize()
    target.style.filter = 'contrast(1.1)'
    target.style.clipPath = 'inset(1px)'
    const child = document.createElement('span')
    target.appendChild(child)
    const lens = await attach(target)
    flushFrame()
    expect(document.querySelector('filter')).not.toBeNull()
    lens.destroy()
    finish?.()
    await decodedFrame()
    vi.runAllTimers()
    flushFrame()
    expect(target.style.filter).toBe('contrast(1.1)')
    expect(target.style.clipPath).toBe('inset(1px)')
    expect(target.firstChild).toBe(child)
    expect(target.hasAttribute('data-rim-optics')).toBe(false)
    expect(document.querySelector('svg')).toBeNull()
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('isolates instances while sharing bounded map generation and removing the last SVG root', async () => {
    const first = targetWithSize().target
    const second = targetWithSize().target
    const a = await attach(first)
    const b = await attach(second)
    flushFrame()
    await decodedFrame()
    expect(first.style.filter).not.toBe(second.style.filter)
    expect(document.querySelectorAll('filter')).toHaveLength(2)
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledOnce()
    a.destroy()
    expect(document.querySelectorAll('filter')).toHaveLength(1)
    expect(second.hasAttribute('data-rim-optics')).toBe(true)
    b.destroy()
    expect(document.querySelector('svg')).toBeNull()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back without changing owned content when canvas or image decoding fails', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null)
    const { target } = targetWithSize()
    await attach(target)
    expect(() => flushFrame()).not.toThrow()
    expect(target.style.filter).toBe('')
    expect(document.querySelector('svg')).toBeNull()
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce()

    decode.mockRejectedValueOnce(new Error('Image unavailable'))
    const other = targetWithSize().target
    await attach(other)
    flushFrame()
    await decodedFrame()
    expect(other.hasAttribute('data-rim-optics')).toBe(false)
    expect(other.style.filter).toBe('')
    expect(document.querySelector('svg')).toBeNull()
    expect(observers[1]?.disconnect).toHaveBeenCalledOnce()
  })

  it('uses WebKit per-axis correction and cancels delayed repaint callbacks at disposal', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'AppleWebKit/605.1.15 Version/18 Safari/605.1.15'
    )
    const { target } = targetWithSize(100, 30)
    const lens = await attach(target)
    flushFrame()
    await decodedFrame()
    expect(
      Number(document.querySelector('feDisplacementMap')?.getAttribute('scale'))
    ).toBeCloseTo(0.75)
    expect(
      document.querySelector('[result="bend"]')?.getAttribute('values')
    ).toContain('0.3 0 0 0 0.35')
    const firstFilter = target.style.filter
    vi.advanceTimersByTime(60)
    flushFrame()
    expect(target.style.filter).not.toBe(firstFilter)
    lens.destroy()
    expect(vi.getTimerCount()).toBe(0)
    expect(frames.size).toBe(0)
    expect(document.querySelector('svg')).toBeNull()
  })
})
