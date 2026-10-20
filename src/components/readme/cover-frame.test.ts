import { afterEach, expect, it, vi } from 'vitest'
import { attachCoverFrame } from './cover-frame'

afterEach(() => vi.unstubAllGlobals())

it('scales the complete fixed canvas inside 4:3, 16:9 and ultrawide viewports with safety gutters', () => {
  const viewport = document.createElement('div')
  const stage = document.createElement('div')
  let width = 1024
  let height = 768
  Object.defineProperty(viewport, 'clientWidth', { get: () => width })
  Object.defineProperty(viewport, 'clientHeight', { get: () => height })
  let resize: () => void = () => undefined
  const disconnect = vi.fn()
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
  const dispose = attachCoverFrame(viewport, stage, 100)
  for (const size of [
    [1024, 768],
    [1920, 1080],
    [3440, 1440],
    [400, 350],
  ]) {
    width = size[0] ?? 0
    height = size[1] ?? 0
    resize()
    const scale = Number(stage.style.getPropertyValue('--cover-scale'))
    expect(1200 * scale).toBeLessThanOrEqual(width - 48 + 0.001)
    expect(800 * scale).toBeLessThanOrEqual(height - 48 + 0.001)
    expect(scale).toBeCloseTo(
      Math.min((width - 48) / 1200, (height - 48) / 800)
    )
  }
  dispose()
  const held = stage.style.cssText
  width = 800
  resize()
  window.dispatchEvent(new Event('resize'))
  expect(stage.style.cssText).toBe(held)
  expect(disconnect).toHaveBeenCalledOnce()
  const releaseZoom = attachCoverFrame(viewport, stage, 110)
  expect(Number(stage.style.getPropertyValue('--cover-scale'))).toBeCloseTo(
    Math.min((width - 48) / 1200, (height - 48) / 800) * 1.1
  )
  releaseZoom()
})
