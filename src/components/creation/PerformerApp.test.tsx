import { PERFORMER_CONFIG, PERFORMER_PAGE, PERFORMER_READY } from '@/lib/events'
import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { listen, emitTo } from '@tauri-apps/api/event'
import { commands } from '@/lib/tauri-bindings'
import { fitPerformerWindow } from '@/lib/performer-window-size'
import { PerformerApp } from './PerformerApp'
import type { PerformerConfig } from '@/lib/performer-protocol'

vi.mock('@/lib/performer-window-size', () => ({
  fitPerformerWindow: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'performer-test' }),
}))
const first: PerformerConfig = {
  label: 'performer-test',
  number: 1,
  identity: 'workspace-a',
  runId: 1,
  revision: 1,
  navigation: 1,
  url: 'http://127.0.0.1:6868/?_r=1',
  device: 'phone',
  orientation: 'portrait',
  theme: 'pond',
  locale: 'en',
  mouseTouch: true,
}
let receive: (value: PerformerConfig) => Promise<void>
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fitPerformerWindow).mockResolvedValue(undefined)
  vi.mocked(commands.preparePerformerWindow).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* No jsdom layout. */
      }
      disconnect() {
        /* No observer to disconnect. */
      }
    }
  )
  vi.mocked(listen).mockImplementation(async (name, callback) => {
    if (name === PERFORMER_CONFIG)
      receive = async value => {
        await (
          callback as (event: { payload: PerformerConfig }) => Promise<void>
        )({ payload: value })
      }
    return () => undefined
  })
})

it('prepares native JavaScript dialogs before allowing the real performer page to load', async () => {
  let prepared!: (value: { status: 'ok'; data: null }) => void
  vi.mocked(commands.preparePerformerWindow).mockReturnValueOnce(
    new Promise(resolve => {
      prepared = resolve
    })
  )
  render(<PerformerApp />)
  await waitFor(() =>
    expect(commands.preparePerformerWindow).toHaveBeenCalledWith(
      first.label,
      'OK',
      'Cancel'
    )
  )
  expect(emitTo).not.toHaveBeenCalled()
  await act(async () => prepared({ status: 'ok', data: null }))
  await waitFor(() =>
    expect(emitTo).toHaveBeenCalledWith('main', PERFORMER_READY, {
      label: first.label,
    })
  )
})

it('keeps the real page and input in place while resizing, follows bridges, and ignores older configurations', async () => {
  render(<PerformerApp />)
  await waitFor(() =>
    expect(emitTo).toHaveBeenCalledWith('main', PERFORMER_READY, {
      label: first.label,
    })
  )
  await act(async () => receive(first))
  const frame = await screen.findByTitle('Performer page #1')
  expect(fitPerformerWindow).toHaveBeenCalledWith(
    { width: 390, height: 844 },
    expect.any(Function),
    expect.any(Function)
  )
  expect(frame).toHaveAttribute('src', first.url)
  expect(frame).toHaveStyle({ width: '390px', height: '844px' })
  const content = (frame as HTMLIFrameElement).contentWindow
  if (!content) throw new Error('Missing performer frame')
  const post = vi.spyOn(content, 'postMessage')
  fireEvent.load(frame)
  expect(emitTo).toHaveBeenCalledWith('main', PERFORMER_PAGE, {
    label: first.label,
    identity: first.identity,
    runId: 1,
    navigation: 1,
    loaded: true,
  })
  await act(async () =>
    receive({
      ...first,
      revision: 2,
      device: 'tablet',
      orientation: 'landscape',
      theme: 'brutal',
      locale: 'zh-CN',
    })
  )
  expect(screen.getByTitle('performer 页面 #1')).toBe(frame)
  expect(fitPerformerWindow).toHaveBeenLastCalledWith(
    { width: 1180, height: 820 },
    expect.any(Function),
    expect.any(Function)
  )
  expect(frame).toHaveStyle({ width: '1180px', height: '820px' })
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'pnds:theme', theme: 'brutal' }),
    'http://127.0.0.1:6868'
  )
  expect(post).toHaveBeenCalledWith(
    { type: 'pnds:test-touch', version: 1, enabled: true },
    'http://127.0.0.1:6868'
  )
  fireEvent.click(screen.getByRole('checkbox', { name: '鼠标模拟单点触摸' }))
  expect(emitTo).toHaveBeenCalledWith(
    'main',
    'pnds:performer-options',
    expect.objectContaining({
      label: first.label,
      identity: first.identity,
      runId: 1,
      navigation: 1,
      revision: 2,
      options: { mouseTouch: false },
    })
  )
  expect(frame).toHaveAttribute('src', first.url)
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'pnds:locale', locale: 'zh-CN' }),
    'http://127.0.0.1:6868'
  )
  await act(async () => receive(first))
  expect(frame).toHaveStyle({ width: '1180px', height: '820px' })
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('changes device and orientation from the shell toolbar without navigating or restarting the project', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  const frame = await screen.findByTitle('Performer page #1')
  fireEvent.load(frame)
  fireEvent.click(screen.getByRole('button', { name: 'Tablet' }))
  expect(emitTo).toHaveBeenCalledWith('main', 'pnds:performer-options', {
    label: first.label,
    identity: first.identity,
    runId: 1,
    navigation: 1,
    revision: 1,
    options: { device: 'tablet' },
  })
  await act(async () => receive({ ...first, revision: 2, device: 'tablet' }))
  expect(screen.getByRole('button', { name: 'Tablet' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(frame).toHaveStyle({ width: '820px', height: '1180px' })
  fireEvent.click(screen.getByRole('button', { name: 'Landscape' }))
  expect(emitTo).toHaveBeenCalledWith(
    'main',
    'pnds:performer-options',
    expect.objectContaining({
      revision: 2,
      options: { orientation: 'landscape' },
    })
  )
  await act(async () =>
    receive({
      ...first,
      revision: 3,
      device: 'tablet',
      orientation: 'landscape',
    })
  )
  expect(screen.getByTitle('Performer page #1')).toBe(frame)
  expect(frame).toHaveAttribute('src', first.url)
  expect(frame).toHaveStyle({ width: '1180px', height: '820px' })
  expect(
    screen.getByRole('checkbox', { name: 'Mouse simulates one touch' })
  ).toBeChecked()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('releases an unacknowledged options request and allows retry without replacing the performer page', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  const frame = await screen.findByTitle('Performer page #1')
  fireEvent.load(frame)
  vi.useFakeTimers()
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Tablet' }))
    expect(screen.getByRole('button', { name: 'Tablet' })).toBeDisabled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByRole('button', { name: 'Tablet' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Window settings were not acknowledged. Try again.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tablet' }))
    await act(async () => receive({ ...first, revision: 2, device: 'tablet' }))
    expect(screen.getByRole('button', { name: 'Tablet' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTitle('Performer page #1')).toBe(frame)
    expect(frame).toHaveAttribute('src', first.url)
  } finally {
    vi.useRealTimers()
  }
})

it('ignores a late send failure after the timed-out request has been replaced', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  fireEvent.load(await screen.findByTitle('Performer page #1'))
  let failOld!: (error: Error) => void
  vi.mocked(emitTo).mockReturnValueOnce(
    new Promise<void>((_, reject) => {
      failOld = reject
    })
  )
  vi.useFakeTimers()
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Tablet' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }))
    await act(async () => failOld(new Error('Old request failed')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Landscape' })).toBeDisabled()
    await act(async () =>
      receive({ ...first, revision: 2, orientation: 'landscape' })
    )
    expect(screen.getByRole('button', { name: 'Landscape' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Landscape' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  } finally {
    vi.useRealTimers()
  }
})

it('shows an options-send failure and allows the next request', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  vi.mocked(emitTo).mockRejectedValueOnce(new Error('Window event unavailable'))
  fireEvent.click(screen.getByRole('button', { name: 'Tablet' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Window event unavailable'
  )
  expect(screen.getByRole('button', { name: 'Tablet' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Tablet' }))
  await act(async () => receive({ ...first, revision: 2, device: 'tablet' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('fits the newest initial configuration even when an older same-size fit is still pending', async () => {
  let finishOld!: () => void
  vi.mocked(fitPerformerWindow).mockReturnValueOnce(
    new Promise(resolve => {
      finishOld = resolve
    })
  )
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  let older!: Promise<void>
  await act(async () => {
    older = receive(first)
  })
  await waitFor(() => expect(fitPerformerWindow).toHaveBeenCalledTimes(1))
  await act(async () => receive({ ...first, revision: 2, theme: 'brutal' }))
  expect(fitPerformerWindow).toHaveBeenCalledTimes(2)
  const frame = await screen.findByTitle('Performer page #1')
  await act(async () => {
    finishOld()
    await older
  })
  expect(screen.getByTitle('Performer page #1')).toBe(frame)
  expect(document.documentElement).toHaveAttribute('data-color-theme', 'brutal')
})

it('keeps the real page usable after an automatic window fit fails and retries on a device change', async () => {
  vi.mocked(fitPerformerWindow).mockRejectedValueOnce(
    new Error('Native window sizing failed')
  )
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  const frame = await screen.findByTitle('Performer page #1')
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Native window sizing failed'
  )
  expect(commands.fadeInWindow).toHaveBeenCalledWith(first.label)
  await act(async () => receive({ ...first, revision: 2, device: 'tablet' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByTitle('Performer page #1')).toBe(frame)
})

it('reveals a readable preparation failure without loading an unprepared project page', async () => {
  vi.mocked(commands.preparePerformerWindow).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'Native dialog setup failed' },
  })
  render(<PerformerApp />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Native dialog setup failed'
  )
  expect(commands.fadeInWindow).toHaveBeenCalledWith(first.label)
  expect(screen.queryByTitle('Performer page #1')).not.toBeInTheDocument()
  expect(emitTo).not.toHaveBeenCalledWith(
    'main',
    PERFORMER_READY,
    expect.anything()
  )
})

it('replaces only the navigation and rejects a late load from the previous run', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  const oldFrame = await screen.findByTitle('Performer page #1')
  const next = {
    ...first,
    runId: 2,
    revision: 2,
    navigation: 2,
    url: 'http://127.0.0.1:6968/?_r=2',
  }
  await act(async () => receive(next))
  const nextFrame = await screen.findByTitle('Performer page #1')
  expect(nextFrame).not.toBe(oldFrame)
  expect(nextFrame).toHaveAttribute('src', next.url)
  vi.mocked(emitTo).mockClear()
  fireEvent.load(oldFrame)
  expect(emitTo).not.toHaveBeenCalled()
  fireEvent.load(nextFrame)
  expect(emitTo).toHaveBeenCalledWith(
    'main',
    PERFORMER_PAGE,
    expect.objectContaining({ runId: 2, navigation: 2, loaded: true })
  )
})
