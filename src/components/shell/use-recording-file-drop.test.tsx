import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import type { DragDropEvent } from '@tauri-apps/api/webview'
import type { EventCallback } from '@tauri-apps/api/event'
import { logger } from '@/lib/logger'
import { useRecordingFileDrop } from './use-recording-file-drop'

const { listen } = vi.hoisted(() => ({ listen: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ onDragDropEvent: listen }),
}))

const paths = ['/finder/first.pndsrecord', '/finder/second.JSON']
const position = new PhysicalPosition(150, 250)
let handlers: EventCallback<DragDropEvent>[]
let unlisten: Mock<() => void>
const elementFromPoint = vi.fn<typeof document.elementFromPoint>()
const originalHitTest = Object.getOwnPropertyDescriptor(
  document,
  'elementFromPoint'
)

beforeEach(() => {
  vi.clearAllMocks()
  handlers = []
  unlisten = vi.fn<() => void>()
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: elementFromPoint,
  })
  listen.mockImplementation((handler: EventCallback<DragDropEvent>) => {
    handlers.push(handler)
    return Promise.resolve(unlisten)
  })
})

afterEach(() => {
  if (originalHitTest)
    Object.defineProperty(document, 'elementFromPoint', originalHitTest)
  else Reflect.deleteProperty(document, 'elementFromPoint')
})

function options() {
  const element = document.createElement('div')
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 200, 300, 220)
  )
  elementFromPoint.mockReturnValue(element)
  return {
    enabled: true,
    projectPath: '/score' as string | undefined,
    projectIdentity: 'first-workspace' as string | null,
    target: { current: element as HTMLElement | null },
    onDrop: vi.fn(),
  }
}

function emit(payload: DragDropEvent, index = handlers.length - 1) {
  const handler = handlers[index]
  if (!handler) throw new Error('Expected a registered native listener')
  act(() => handler({ event: 'tauri://drag-drop', id: 1, payload }))
}

it('highlights supported files only inside the panel and imports their native paths once', () => {
  const props = options()
  const { result } = renderHook(() => useRecordingFileDrop(props))
  emit({ type: 'enter', paths, position })
  expect(result.current).toBe(true)
  emit({ type: 'over', position: new PhysicalPosition(400, 250) })
  expect(result.current).toBe(false)
  emit({ type: 'over', position })
  expect(result.current).toBe(true)
  emit({ type: 'drop', paths, position })
  expect(result.current).toBe(false)
  expect(props.onDrop).toHaveBeenCalledExactlyOnceWith(paths)
})

it('uses macOS window points unchanged on a Retina display', () => {
  const original = window.devicePixelRatio
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 2,
  })
  try {
    const props = options()
    const { result } = renderHook(() => useRecordingFileDrop(props))
    emit({ type: 'enter', paths, position })
    expect(result.current).toBe(true)
    expect(elementFromPoint).toHaveBeenCalledWith(150, 250)
    emit({ type: 'drop', paths, position })
    expect(props.onDrop).toHaveBeenCalledExactlyOnceWith(paths)
  } finally {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: original,
    })
  }
})

it('rejects a higher overlay or an absent hit inside the recording rectangle', () => {
  const props = options()
  const { result } = renderHook(() => useRecordingFileDrop(props))
  emit({ type: 'enter', paths, position })
  expect(result.current).toBe(true)
  elementFromPoint.mockReturnValue(document.createElement('div'))
  emit({ type: 'over', position })
  expect(result.current).toBe(false)
  emit({ type: 'drop', paths, position })
  expect(props.onDrop).not.toHaveBeenCalled()
  elementFromPoint.mockReturnValue(null)
  emit({ type: 'drop', paths, position })
  expect(props.onDrop).not.toHaveBeenCalled()
})

it('accepts a child hit and falls back to bounds when hit testing is unavailable', () => {
  const props = options()
  const child = document.createElement('span')
  props.target.current?.append(child)
  elementFromPoint.mockReturnValue(child)
  renderHook(() => useRecordingFileDrop(props))
  emit({ type: 'drop', paths, position })
  expect(props.onDrop).toHaveBeenCalledOnce()
  Reflect.deleteProperty(document, 'elementFromPoint')
  emit({ type: 'drop', paths, position })
  expect(props.onDrop).toHaveBeenCalledTimes(2)
})

it('ignores mixed or unsupported files, empty batches and drops outside the target', () => {
  const props = options()
  const { result } = renderHook(() => useRecordingFileDrop(props))
  emit({ type: 'enter', paths: [...paths, '/finder/score.pnds'], position })
  expect(result.current).toBe(false)
  emit({ type: 'drop', paths: [...paths, '/finder/score.pnds'], position })
  emit({ type: 'drop', paths: ['/finder/record.txt'], position })
  emit({ type: 'drop', paths: [], position })
  emit({ type: 'drop', paths, position: new PhysicalPosition(99, 250) })
  expect(props.onDrop).not.toHaveBeenCalled()
})

it('clears a cancelled drag and does not reuse its eligibility for a later over event', () => {
  const props = options()
  const { result } = renderHook(() => useRecordingFileDrop(props))
  emit({ type: 'enter', paths, position })
  expect(result.current).toBe(true)
  emit({ type: 'leave' })
  expect(result.current).toBe(false)
  emit({ type: 'over', position })
  expect(result.current).toBe(false)
})

it('accepts a valid drop without a preceding enter but ignores a missing or collapsed panel', () => {
  const props = options()
  renderHook(() => useRecordingFileDrop(props))
  emit({ type: 'drop', paths, position })
  expect(props.onDrop).toHaveBeenCalledOnce()
  const element = props.target.current
  if (!element) throw new Error('Expected a drop target')
  vi.mocked(element.getBoundingClientRect).mockReturnValue(new DOMRect())
  emit({ type: 'drop', paths, position })
  props.target.current = null
  emit({ type: 'drop', paths, position })
  expect(props.onDrop).toHaveBeenCalledOnce()
})

it('closes without importing and reopens without a stale highlight', async () => {
  const props = options()
  const { result, rerender } = renderHook(useRecordingFileDrop, {
    initialProps: props,
  })
  emit({ type: 'enter', paths, position })
  expect(result.current).toBe(true)
  rerender({ ...props, enabled: false })
  expect(result.current).toBe(false)
  await waitFor(() => expect(unlisten).toHaveBeenCalledOnce())
  emit({ type: 'drop', paths, position }, 0)
  expect(props.onDrop).not.toHaveBeenCalled()
  rerender(props)
  expect(result.current).toBe(false)
  emit({ type: 'drop', paths, position })
  expect(props.onDrop).toHaveBeenCalledExactlyOnceWith(paths)
})

it.each([
  { projectPath: '/other', projectIdentity: 'first-workspace' },
  { projectPath: '/score', projectIdentity: 'replacement-workspace' },
])(
  'retires native callbacks when ownership changes to $projectPath / $projectIdentity',
  async owner => {
    const props = options()
    const { result, rerender } = renderHook(useRecordingFileDrop, {
      initialProps: props,
    })
    emit({ type: 'enter', paths, position })
    expect(result.current).toBe(true)
    rerender({ ...props, ...owner })
    expect(result.current).toBe(false)
    await waitFor(() => expect(unlisten).toHaveBeenCalledOnce())
    emit({ type: 'drop', paths, position }, 0)
    expect(props.onDrop).not.toHaveBeenCalled()
    emit({ type: 'drop', paths, position })
    expect(props.onDrop).toHaveBeenCalledExactlyOnceWith(paths)
  }
)

it('delivers to the latest callback without resubscribing during a drag', () => {
  const props = options()
  const next = vi.fn()
  const { result, rerender } = renderHook(useRecordingFileDrop, {
    initialProps: props,
  })
  emit({ type: 'enter', paths, position })
  rerender({ ...props, onDrop: next })
  expect(listen).toHaveBeenCalledOnce()
  expect(result.current).toBe(true)
  emit({ type: 'drop', paths, position })
  expect(props.onDrop).not.toHaveBeenCalled()
  expect(next).toHaveBeenCalledExactlyOnceWith(paths)
})

it('does not subscribe while disabled or without a project', () => {
  const props = options()
  const { rerender } = renderHook(useRecordingFileDrop, {
    initialProps: { ...props, enabled: false },
  })
  expect(listen).not.toHaveBeenCalled()
  rerender({ ...props, enabled: true, projectPath: undefined })
  expect(listen).not.toHaveBeenCalled()
})

it('unsubscribes even when native registration resolves after unmount', async () => {
  let finish!: (off: () => void) => void
  listen.mockImplementationOnce((handler: EventCallback<DragDropEvent>) => {
    handlers.push(handler)
    return new Promise<() => void>(resolve => {
      finish = resolve
    })
  })
  const props = options()
  const { unmount } = renderHook(() => useRecordingFileDrop(props))
  unmount()
  emit({ type: 'drop', paths, position })
  expect(props.onDrop).not.toHaveBeenCalled()
  await act(async () => finish(unlisten))
  expect(unlisten).toHaveBeenCalledOnce()
})

it('reports a rejected native registration without leaving an unhandled promise', async () => {
  listen.mockRejectedValueOnce(new Error('Native listener unavailable'))
  const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
  renderHook(() => useRecordingFileDrop(options()))
  await waitFor(() =>
    expect(warning).toHaveBeenCalledWith(
      'Could not listen for recording file drops',
      { error: 'Error: Native listener unavailable' }
    )
  )
  warning.mockRestore()
})
