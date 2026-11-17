import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  mockBoundingClientRect,
  render,
  screen,
} from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { PerformerQrPanel } from './PerformerQrPanel'

let resized: (() => void) | null = null
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private update: () => void) {}
      observe(element: Element) {
        if (element.classList.contains('performer-qr-layer'))
          resized = this.update
      }
      disconnect() {
        /* No native observer in jsdom. */
      }
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resized = null
})

function mount() {
  const view = render(
    <PerformerQrPanel
      image="data:image/png;base64,aW1hZ2U="
      name="Running score"
      url="https://stage.example:8443/join?room=one"
    />
  )
  const panel = screen.getByTestId('performer-qr-overlay')
  const layer = view.container.querySelector('.performer-qr-layer')
  if (!layer) throw Error('The floating panel needs a viewport')
  mockBoundingClientRect(layer, { left: 0, top: 0, width: 800, height: 600 })
  act(() => resized?.())
  return { panel, layer }
}
function geometry(panel: HTMLElement) {
  return {
    x: parseFloat(panel.style.insetInlineStart),
    y: parseFloat(panel.style.insetBlockStart),
    size: parseFloat(panel.style.width),
  }
}
function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  pointerId = 1
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    pointerId: { value: pointerId },
    clientX: { value: x },
    clientY: { value: y },
  })
  fireEvent(target, event)
}

it('moves only from the top and restores cancelled or interrupted drags', () => {
  const { panel } = mount()
  const header = screen.getByTestId('qr-panel-drag')
  const capture = vi.spyOn(header, 'setPointerCapture')
  pointer(header, 'pointerdown', 250, 150)
  pointer(header, 'pointermove', -1000, 2000)
  expect(capture).toHaveBeenCalledWith(1)
  expect(geometry(panel)).toEqual({ x: 12, y: 228, size: 360 })
  pointer(header, 'pointermove', 0, 0, 2)
  expect(geometry(panel).y).toBe(228)
  pointer(header, 'pointerup', -1000, 2000)
  pointer(header, 'pointerdown', 0, 0)
  pointer(header, 'pointermove', 64, -32)
  pointer(header, 'pointercancel', 64, -32)
  expect(geometry(panel)).toEqual({ x: 12, y: 228, size: 360 })
  pointer(header, 'pointerdown', 0, 0)
  pointer(header, 'pointermove', 64, -32)
  pointer(header, 'lostpointercapture', 64, -32)
  expect(geometry(panel)).toEqual({ x: 12, y: 228, size: 360 })
})

it.each([
  ['nw', -64, -64, { x: 156, y: 56, size: 424 }],
  ['ne', 64, -64, { x: 220, y: 56, size: 424 }],
  ['sw', -64, 64, { x: 156, y: 120, size: 424 }],
  ['se', 64, 64, { x: 220, y: 120, size: 424 }],
] as const)(
  'resizes from the %s corner while keeping the opposite corner anchored',
  (corner, dx, dy, expected) => {
    const { panel } = mount()
    const handle = screen.getByTestId(`qr-resize-${corner}`)
    pointer(handle, 'pointerdown', 0, 0)
    pointer(handle, 'pointermove', dx, dy)
    pointer(handle, 'pointerup', dx, dy)
    expect(geometry(panel)).toEqual(expected)
  }
)

it('limits corner resizing and keeps the whole panel reachable after the viewport shrinks', () => {
  const { panel, layer } = mount()
  const corner = screen.getByTestId('qr-resize-se')
  pointer(corner, 'pointerdown', 0, 0)
  pointer(corner, 'pointermove', 2000, 2000)
  pointer(corner, 'pointerup', 2000, 2000)
  expect(geometry(panel)).toEqual({ x: 220, y: 120, size: 468 })
  pointer(corner, 'pointerdown', 0, 0)
  pointer(corner, 'pointermove', -2000, -2000)
  pointer(corner, 'pointerup', -2000, -2000)
  expect(geometry(panel)).toEqual({ x: 220, y: 120, size: 220 })
  mockBoundingClientRect(layer, { left: 0, top: 0, width: 220, height: 200 })
  act(() => resized?.())
  expect(geometry(panel)).toEqual({ x: 32, y: 12, size: 176 })
})

it('has no extra controls, image dragging, wheel resizing or keyboard actions', () => {
  const { panel } = mount()
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  const image = screen.getByRole('img')
  expect(image).toHaveAttribute('draggable', 'false')
  pointer(image, 'pointerdown', 0, 0)
  pointer(image, 'pointermove', 100, 100)
  pointer(image, 'pointerup', 100, 100)
  fireEvent.click(screen.getByTestId('qr-panel-drag'))
  const wheel = new WheelEvent('wheel', {
    deltaY: -500,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  act(() => panel.dispatchEvent(wheel))
  expect(wheel.defaultPrevented).toBe(false)
  fireEvent.keyDown(panel, { key: 'ArrowRight' })
  fireEvent.keyDown(panel, { key: 'Escape' })
  expect(geometry(panel)).toEqual({ x: 220, y: 120, size: 360 })
  expect(commands.togglePerformerQr).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
