import { useRef } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarEntrance } from './use-sidebar-entrance'

interface EntranceCall {
  element: Element
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null
  options: KeyframeAnimationOptions | number | undefined
  cancel: ReturnType<typeof vi.fn>
}

const animateDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
)
let calls: EntranceCall[]
let media: MediaQueryList

function pinGeometry(element: HTMLElement, top: number, height: number) {
  element.getBoundingClientRect = () =>
    ({
      x: 20,
      y: top,
      left: 20,
      right: 280,
      top,
      bottom: top + height,
      width: 260,
      height,
      toJSON: () => ({}),
    }) as DOMRect
  Object.defineProperties(element, {
    offsetTop: { configurable: true, value: top - 100 },
    offsetHeight: { configurable: true, value: height },
    clientHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: 260 },
  })
}

function Harness({
  paths = ['a', 'b', 'c'],
  viewKey = 'home',
  visible = true,
  selectedPath = 'b',
  disabled = false,
  tops,
  onPointerDown,
}: {
  paths?: string[]
  viewKey?: string | null
  visible?: boolean
  selectedPath?: string | null
  disabled?: boolean
  tops?: number[]
  onPointerDown?: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  useSidebarEntrance({
    contentRef,
    viewportRef,
    pillRef,
    viewKey,
    visible,
    selectedPath,
    pathsKey: JSON.stringify(paths),
    disabled,
  })
  return (
    <div
      data-testid="viewport"
      ref={element => {
        viewportRef.current = element
        if (element) pinGeometry(element, 100, 488)
      }}
    >
      <div ref={contentRef}>
        <div
          ref={pillRef}
          data-testid="pill"
          style={{ transform: 'translateY(61px)' }}
        />
        {paths.map((path, index) => (
          <div
            key={path}
            data-project-path={path}
            data-testid={`row-${path}`}
            onPointerDown={onPointerDown}
            style={{ transform: 'translateY(17px)' }}
            ref={element => {
              if (element)
                pinGeometry(element, tops?.[index] ?? 100 + index * 61, 57)
            }}
          >
            {path}
          </div>
        ))}
      </div>
    </div>
  )
}

function rows() {
  return calls.filter(call => call.element.hasAttribute('data-project-path'))
}

function timing(call: EntranceCall) {
  if (typeof call.options !== 'object')
    throw new Error('Entrance animation must provide explicit timing')
  return call.options
}

async function expectWave(count = 3) {
  await waitFor(() => expect(rows()).toHaveLength(count))
}

beforeEach(() => {
  calls = []
  media = Object.assign(new EventTarget(), {
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }) as MediaQueryList
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media)
  )
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: KeyframeAnimationOptions | number
    ) {
      const cancel = vi.fn()
      calls.push({ element: this, keyframes, options, cancel })
      return {
        cancel,
        onfinish: null,
        finished: Promise.resolve(),
        playState: 'running',
      } as unknown as Animation
    },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (animateDescriptor)
    Object.defineProperty(Element.prototype, 'animate', animateDescriptor)
  else Reflect.deleteProperty(Element.prototype, 'animate')
})

describe('useSidebarEntrance', () => {
  it('presents each folder once, without replaying selection or list updates', async () => {
    const view = render(<Harness />)
    await expectWave()
    const firstWave = [...calls]

    view.rerender(<Harness selectedPath="a" />)
    expect(firstWave.every(call => call.cancel.mock.calls.length > 0)).toBe(
      true
    )
    expect(rows()).toHaveLength(3)

    view.rerender(<Harness paths={['a', 'b', 'c', 'd']} selectedPath="a" />)
    expect(rows()).toHaveLength(3)
    view.rerender(<Harness paths={['a', 'b', 'c', 'd']} viewKey="folder" />)
    await expectWave(7)
    view.rerender(<Harness viewKey="home" />)
    await expectWave(10)
  })

  it('waits for visible nonempty content and does not replay on hover reopen', async () => {
    const view = render(<Harness paths={[]} visible={false} />)
    view.rerender(<Harness visible={false} />)
    expect(calls).toHaveLength(0)
    view.rerender(<Harness />)
    await expectWave()
    view.rerender(<Harness visible={false} />)
    view.rerender(<Harness />)
    expect(rows()).toHaveLength(3)

    view.rerender(<Harness viewKey="empty-folder" paths={[]} />)
    view.rerender(<Harness viewKey="empty-folder" paths={['later']} />)
    await expectWave(4)
    view.rerender(<Harness viewKey="deferred-folder" visible={false} />)
    expect(rows()).toHaveLength(4)
    view.rerender(<Harness viewKey="deferred-folder" />)
    await expectWave(7)
  })

  it('staggers visible rows, synchronizes the pill and preserves drag transforms', async () => {
    const paths = Array.from({ length: 10 }, (_, index) => `p${index}`)
    const tops = paths.map((_, index) => (index - 1) * 61 + 100)
    render(<Harness paths={paths} tops={tops} selectedPath="p3" />)
    await expectWave(8)
    expect(
      rows().map(call => call.element.getAttribute('data-project-path'))
    ).toEqual(paths.slice(1, 9))
    expect(rows().map(call => timing(call).delay)).toEqual([
      0, 50, 100, 150, 200, 250, 250, 250,
    ])
    const selected = rows().find(
      call => call.element.getAttribute('data-project-path') === 'p3'
    )
    const pill = calls.find(call => call.element === screen.getByTestId('pill'))
    if (!selected || !pill) throw new Error('Expected selected row and pill')
    expect(timing(pill).delay).toBe(timing(selected).delay)
    for (const call of rows()) {
      expect(timing(call)).toMatchObject({ duration: 620, fill: 'backwards' })
      const frames = Array.isArray(call.keyframes)
        ? call.keyframes
        : [call.keyframes]
      expect(frames.some(frame => frame && 'transform' in frame)).toBe(false)
      expect(frames.some(frame => frame && 'translate' in frame)).toBe(true)
      expect(frames.some(frame => frame && 'scale' in frame)).toBe(true)
    }
    expect(timing(pill)).toMatchObject({ duration: 620, fill: 'backwards' })
    expect(pill.keyframes).toEqual([
      expect.objectContaining({
        transform: 'translateY(61px) translateY(12px) scale(0.88)',
      }),
      expect.objectContaining({ transform: 'translateY(61px)' }),
    ])
    expect(screen.getByTestId('pill').style.transform).toBe('translateY(61px)')
    fireEvent.scroll(screen.getByTestId('viewport'))
    expect(calls.every(call => call.cancel.mock.calls.length === 0)).toBe(true)
    expect(screen.getByTestId('row-p3').style.transform).toBe(
      'translateY(17px)'
    )
  })

  it('settles before pointer handling and on keyboard, wheel, scroll or resize', async () => {
    for (const input of ['pointer', 'keyboard', 'wheel', 'scroll', 'resize']) {
      calls = []
      const measure = vi.fn(() => {
        expect(calls.every(call => call.cancel.mock.calls.length > 0)).toBe(
          true
        )
      })
      const view = render(<Harness onPointerDown={measure} />)
      await expectWave()
      const row = screen.getByTestId('row-a')
      const viewport = screen.getByTestId('viewport')
      if (input === 'pointer') fireEvent.pointerDown(row)
      if (input === 'keyboard') fireEvent.keyDown(row, { key: 'ArrowDown' })
      if (input === 'wheel') fireEvent.wheel(viewport)
      if (input === 'scroll') {
        viewport.scrollTop = 30
        fireEvent.scroll(viewport)
      }
      if (input === 'resize') fireEvent(window, new Event('resize'))
      expect(calls.every(call => call.cancel.mock.calls.length > 0)).toBe(true)
      if (input === 'pointer') expect(measure).toHaveBeenCalledOnce()
      view.unmount()
    }
  })

  it('skips reduced motion and disabled themes, and settles a live preference change', async () => {
    Object.defineProperty(media, 'matches', { configurable: true, value: true })
    const reduced = render(<Harness />)
    expect(calls).toHaveLength(0)
    reduced.unmount()
    Object.defineProperty(media, 'matches', {
      configurable: true,
      value: false,
    })
    const disabled = render(<Harness disabled />)
    expect(calls).toHaveLength(0)
    disabled.unmount()
    render(<Harness />)
    await expectWave()
    Object.defineProperty(media, 'matches', { configurable: true, value: true })
    act(() => {
      const event = new Event('change')
      Object.defineProperty(event, 'matches', { value: true })
      media.dispatchEvent(event)
    })
    expect(calls.every(call => call.cancel.mock.calls.length > 0)).toBe(true)
  })

  it('cancels its animations and removes input and preference listeners on unmount', async () => {
    const removeMediaListener = vi.spyOn(media, 'removeEventListener')
    const view = render(<Harness />)
    await expectWave()
    const viewport = screen.getByTestId('viewport')
    view.unmount()
    expect(calls.every(call => call.cancel.mock.calls.length > 0)).toBe(true)
    const cancellations = calls.map(call => call.cancel.mock.calls.length)
    fireEvent.scroll(viewport)
    fireEvent(window, new Event('resize'))
    media.dispatchEvent(new Event('change'))
    expect(calls.map(call => call.cancel.mock.calls.length)).toEqual(
      cancellations
    )
    expect(removeMediaListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    )
  })
})
