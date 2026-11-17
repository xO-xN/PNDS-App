import userEvent from '@testing-library/user-event'
import { PERFORMER_CONFIG, PERFORMER_PAGE, PERFORMER_READY } from '@/lib/events'
import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { listen, emitTo } from '@tauri-apps/api/event'
import { commands } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
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
  generation: 'runtime-a',
  revision: 1,
  navigation: 1,
  url: 'http://127.0.0.1:6868/?_r=1',
  device: 'phone',
  orientation: 'portrait',
  theme: 'pond',
  locale: 'en',
  mouseTouch: true,
}
function nativeNavigation(config: PerformerConfig): string {
  return `${config.label}:${config.identity}:${config.generation ?? ''}:${config.runId}:${config.navigation}`
}
function nativePageEvent(
  kind: 'loaded' | 'message' | 'error',
  config = first,
  data: unknown = null
): void {
  const listeners = vi
    .mocked(listen)
    .mock.calls.filter(([name]) => name === 'project-media-view-event')
  if (!listeners.length) throw new Error('Native project listener missing')
  for (const [, callback] of listeners)
    (callback as (event: { payload: unknown }) => void)({
      payload: {
        label: config.label,
        navigation: nativeNavigation(config),
        kind,
        data,
      },
    })
}

let receive: (value: PerformerConfig) => Promise<void>
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  vi.mocked(commands.creationPerformerPinned).mockResolvedValue({
    status: 'ok',
    data: false,
  })
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

it('pins the native shell without replacing its native performer document, and retains native state on failure', async () => {
  render(<PerformerApp />)
  await waitFor(() =>
    expect(commands.creationPerformerPinned).toHaveBeenCalledWith(
      'performer-test',
      null
    )
  )
  await act(() => receive(first))
  const frame = screen.getByTitle('Performer page #1')
  const button = screen.getByRole('button', { name: 'Keep on top' })
  await waitFor(() => expect(button).toBeEnabled())
  vi.mocked(commands.creationPerformerPinned).mockResolvedValueOnce({
    status: 'ok',
    data: true,
  })
  fireEvent.click(button)
  await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
  expect(commands.creationPerformerPinned).toHaveBeenLastCalledWith(
    'performer-test',
    true
  )
  expect(screen.getByTitle('Performer page #1')).toBe(frame)
  vi.mocked(commands.creationPerformerPinned).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'Native pin failed' },
  })
  fireEvent.click(button)
  await screen.findByText(/Native pin failed/)
  expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTitle('Performer page #1')).toBe(frame)
})

it.each([
  [
    'en',
    'Connection status: see App performer list',
    'Page loading does not confirm a performer connection',
  ],
  ['zh-CN', '连接状态见 App 演奏端列表', '页面加载不代表已加入演奏'],
])(
  'explains the connection boundary in %s without reporting a disconnection',
  async (locale, label, hint) => {
    render(<PerformerApp />)
    await waitFor(() => expect(emitTo).toHaveBeenCalled())
    await act(async () => receive({ ...first, locale }))
    await userEvent.hover(screen.getByText(label))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(hint)
    expect(screen.getByText(label)).not.toHaveAttribute('title')
  }
)

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
  expect(frame).toHaveAttribute('data-page-navigation', nativeNavigation(first))
  expect(frame).toHaveStyle({ width: '390px', height: '844px' })
  const post = vi.mocked(commands.postProjectMediaMessage)
  await act(async () => nativePageEvent('loaded'))
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
  expect(commands.fadeInWindow).toHaveBeenCalledTimes(1)
  expect(frame).toHaveStyle({ width: '1180px', height: '820px' })
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      nativeNavigation(first),
      expect.objectContaining({ type: 'pnds:theme', theme: 'brutal' })
    )
  )
  expect(post).toHaveBeenCalledWith(nativeNavigation(first), {
    type: 'pnds:test-touch',
    version: 1,
    enabled: true,
  })
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
  expect(frame).toHaveAttribute('data-page-navigation', nativeNavigation(first))
  expect(post).toHaveBeenCalledWith(
    nativeNavigation(first),
    expect.objectContaining({ type: 'pnds:locale', locale: 'zh-CN' })
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
  await act(async () => nativePageEvent('loaded'))
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
  expect(frame).toHaveAttribute('data-page-navigation', nativeNavigation(first))
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
  await act(async () => nativePageEvent('loaded'))
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
    expect(frame).toHaveAttribute(
      'data-page-navigation',
      nativeNavigation(first)
    )
  } finally {
    vi.useRealTimers()
  }
})

it('ignores a late send failure after the timed-out request has been replaced', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  await act(async () => nativePageEvent('loaded'))
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

it('acknowledges teardown only after its native document has confirmed closure', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  const frame = await screen.findByTitle('Performer page #1')
  await act(async () => nativePageEvent('loaded'))
  let finishClose!: (value: { status: 'ok'; data: null }) => void
  vi.mocked(commands.closeProjectMediaView).mockReturnValueOnce(
    new Promise(resolve => {
      finishClose = resolve
    })
  )
  vi.mocked(emitTo).mockClear()
  await act(async () =>
    receive({ ...first, revision: 2, url: null, disposing: true })
  )
  expect(screen.getByTitle('Performer page #1')).toBe(frame)
  await waitFor(() =>
    expect(commands.closeProjectMediaView).toHaveBeenCalledWith(
      nativeNavigation(first),
      expect.any(Number)
    )
  )
  expect(emitTo).not.toHaveBeenCalledWith(
    'main',
    'pnds:performer-released',
    expect.anything()
  )
  await act(async () => finishClose({ status: 'ok', data: null }))
  expect(emitTo).toHaveBeenCalledWith('main', 'pnds:performer-released', {
    label: first.label,
    identity: first.identity,
    runId: first.runId,
    navigation: first.navigation,
    revision: 2,
  })
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
  expect(nextFrame).toHaveAttribute(
    'data-page-navigation',
    nativeNavigation(next)
  )
  vi.mocked(emitTo).mockClear()
  await act(async () => nativePageEvent('loaded', first))
  expect(emitTo).not.toHaveBeenCalled()
  await act(async () => nativePageEvent('loaded', next))
  expect(emitTo).toHaveBeenCalledWith(
    'main',
    PERFORMER_PAGE,
    expect.objectContaining({ runId: 2, navigation: 2, loaded: true })
  )
})

it('opens the performer as a native first-party document without embedding an HTTP iframe', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  const page = await screen.findByTitle('Performer page #1')
  expect(page.tagName).toBe('DIV')
  expect(document.querySelector('iframe')).not.toBeInTheDocument()
})

it('passes the observed runtime generation to native creation without refreshing its authority', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  await waitFor(() =>
    expect(commands.syncProjectMediaView).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'performer', generation: 'runtime-a' }),
      expect.any(Number),
      null
    )
  )
})

it('retains the reveal gate for a new native generation at the same URL and ignores the old load', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  await act(async () => nativePageEvent('loaded', first))
  expect(screen.queryByText('Loading page')).not.toBeInTheDocument()
  const replacement = { ...first, generation: 'runtime-b', revision: 2 }
  await act(async () => receive(replacement))
  expect(screen.getByText('Loading page')).toBeInTheDocument()
  await act(async () => nativePageEvent('loaded', first))
  expect(screen.getByText('Loading page')).toBeInTheDocument()
  await act(async () => nativePageEvent('loaded', replacement))
  expect(screen.queryByText('Loading page')).not.toBeInTheDocument()
})

it('explains a device-sharing failure in this window and clears it after a manual retry succeeds', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  const page = await screen.findByTitle('Performer page #1')
  await act(async () =>
    nativePageEvent('message', first, {
      type: 'pnds:media-error',
      name: 'NotReadableError',
    })
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The selected input is unavailable or in use'
  )
  expect(commands.closeProjectMediaView).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  await act(async () =>
    nativePageEvent('message', first, {
      type: 'pnds:media-active',
    })
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByTitle('Performer page #1')).toBe(page)
})

it('keeps media errors and successful retries within the current window and document', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  await act(async () =>
    nativePageEvent(
      'message',
      { ...first, label: 'performer-other' },
      {
        type: 'pnds:media-error',
        name: 'NotAllowedError',
      }
    )
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  const next = {
    ...first,
    revision: 2,
    navigation: 2,
    url: 'http://127.0.0.1:6868/?_r=2',
  }
  await act(async () => receive(next))
  await act(async () =>
    nativePageEvent('message', first, {
      type: 'pnds:media-error',
      name: 'NotAllowedError',
    })
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await act(async () =>
    nativePageEvent('message', next, {
      type: 'pnds:media-error',
      name: 'NotAllowedError',
    })
  )
  expect(screen.getByRole('alert')).toHaveTextContent('permission was denied')
  await act(async () =>
    nativePageEvent('message', first, { type: 'pnds:media-active' })
  )
  expect(screen.getByRole('alert')).toHaveTextContent('permission was denied')
  await act(async () =>
    nativePageEvent('message', next, { type: 'pnds:media-active' })
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('does not acknowledge a failed native document close as a successful release', async () => {
  render(<PerformerApp />)
  await waitFor(() => expect(emitTo).toHaveBeenCalled())
  await act(async () => receive(first))
  await act(async () => nativePageEvent('loaded'))
  vi.mocked(commands.closeProjectMediaView).mockResolvedValueOnce({
    status: 'error',
    error: 'Native close failed',
  })
  vi.mocked(emitTo).mockClear()
  await act(async () =>
    receive({ ...first, revision: 2, url: null, disposing: true })
  )
  await screen.findByRole('alert')
  expect(emitTo).not.toHaveBeenCalledWith(
    'main',
    'pnds:performer-released',
    expect.anything()
  )
  expect(commands.closeCreationPerformerWindows).not.toHaveBeenCalled()
})
