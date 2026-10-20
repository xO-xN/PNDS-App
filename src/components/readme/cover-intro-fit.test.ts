import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachCoverIntroFit } from './cover-intro-fit'

const disposers: (() => void)[] = []
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture(height: number) {
  let resize: () => void = () => undefined
  const fonts = Object.assign(new EventTarget(), {
    ready: new Promise<void>(() => undefined),
  })
  const stage = document.createElement('div')
  const region = document.createElement('section')
  const column = document.createElement('div')
  const copy = document.createElement('div')
  const body = document.createElement('div')
  body.dataset.coverMarkdown = ''
  body.textContent = 'Full authored introduction, preserved at every size.'
  copy.append(body)
  column.append(copy)
  region.append(column)
  stage.append(region)
  document.body.append(stage)
  const dimensions = { height, width: 600 }
  Object.defineProperty(stage, 'clientHeight', { get: () => 1000 })
  Object.defineProperty(region, 'clientHeight', {
    get: () => dimensions.height,
  })
  Object.defineProperty(column, 'clientHeight', { get: () => 80 })
  Object.defineProperty(column, 'clientWidth', { get: () => dimensions.width })
  const heights: number[] = []
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      const prose = this.querySelector<HTMLElement>('[data-cover-markdown]')
      const size = Number.parseFloat(prose?.style.fontSize ?? '')
      if (!Number.isFinite(size)) return 0
      expect(this).not.toBe(copy)
      expect(this.style.visibility).toBe('hidden')
      expect(this.isConnected).toBe(true)
      const measured =
        32 + (size * 10 * 600) / Number.parseFloat(this.style.inlineSize)
      heights.push(measured)
      return measured
    }
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  const original = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  const dispose = attachCoverIntroFit({ stage, region, column, copy, body })
  disposers.push(() => {
    dispose()
    if (original) Object.defineProperty(document, 'fonts', original)
    else Reflect.deleteProperty(document, 'fonts')
  })
  return {
    stage,
    column,
    copy,
    body,
    dimensions,
    heights,
    fonts,
    resize: () => resize(),
    dispose,
  }
}

describe('cover introduction fitting', () => {
  it('keeps the largest readable prose within the label and safe-area height', () => {
    const f = fixture(240)
    const size = Number.parseFloat(f.body.style.fontSize)
    expect(32 + size * 10).toBeLessThanOrEqual(238)
    expect(size).toBeGreaterThan(20.5)
    expect(f.column.children).toHaveLength(1)
    f.dimensions.height = 400
    f.resize()
    expect(f.body.style.fontSize).toBe('26.5px')
    f.dimensions.width = 300
    f.fonts.dispatchEvent(new Event('loadingdone'))
    expect(Number.parseFloat(f.body.style.fontSize)).toBeLessThan(26.5)
    expect(f.column.children).toHaveLength(1)
  })
  it('retains all content at the readable floor for the native scrolling fallback', () => {
    const f = fixture(120)
    expect(f.body.style.fontSize).toBe('19px')
    expect(f.body).toHaveTextContent(
      'Full authored introduction, preserved at every size.'
    )
    expect(f.column.children).toHaveLength(1)
  })
  it('releases owned styles and ignores already-queued callbacks after disposal', () => {
    const f = fixture(240)
    const measurements = f.heights.length
    f.dispose()
    f.resize()
    f.fonts.dispatchEvent(new Event('loadingdone'))
    expect(f.body.style.fontSize).toBe('')
    expect(f.heights).toHaveLength(measurements)
  })
})
