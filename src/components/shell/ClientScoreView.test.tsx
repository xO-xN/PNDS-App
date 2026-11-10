import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useSettingsStore } from '@/store/settings-store'
import { ClientScoreView } from './ClientScoreView'
import { listen } from '@tauri-apps/api/event'
import { useClientParticipationStore } from '@/store/client-participation-store'
import { useKeyboardStore } from '@/store/keyboard-store'

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsStore.setState({ settingsOpen: false })
  useKeyboardStore.setState({ commandKeyPressed: false })
})

it('retains the page while hiding its native surface for a sidebar or modal overlay', async () => {
  render(
    <ClientScoreView pageUrl="http://pnds-test.localhost:5000/?pndsClientPass=1" />
  )
  mockBoundingClientRect(screen.getByTitle('Performance score'), {
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  })
  fireEvent.resize(window)
  await waitFor(() =>
    expect(commands.syncClientScoreView).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({ width: 900 })
    )
  )
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  act(() => document.body.append(dialog))
  await waitFor(() =>
    expect(commands.syncClientScoreView).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Number),
      null
    )
  )
  act(() => dialog.remove())
  await waitFor(() =>
    expect(commands.syncClientScoreView).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({ width: 900 })
    )
  )
  const sidebar = document.createElement('div')
  sidebar.setAttribute('data-sidebar-motion', '')
  sidebar.style.opacity = '1'
  act(() => document.body.append(sidebar))
  await waitFor(() =>
    expect(commands.syncClientScoreView).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Number),
      null
    )
  )
  act(() => {
    sidebar.setAttribute('inert', '')
    sidebar.style.opacity = '0'
    fireEvent.transitionEnd(sidebar)
  })
  await waitFor(() =>
    expect(commands.syncClientScoreView).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({ width: 900 })
    )
  )
  sidebar.remove()
})

it('routes native Command and edge entry into existing host controls without giving the score a command bridge', async () => {
  const pageUrl = 'http://pnds-test.localhost:5000/?pndsClientPass=1'
  useClientParticipationStore.setState(state => ({
    snapshot: { ...state.snapshot, pageUrl },
  }))
  const enter = vi.fn()
  render(
    <>
      <div data-sidebar-hover-zone="" onMouseEnter={enter} />
      <ClientScoreView pageUrl={pageUrl} />
    </>
  )
  const callback = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'client-view-input-event')?.[1]
  expect(callback).toBeDefined()
  act(() => callback?.({ payload: { command: true, edge: null } } as never))
  expect(useKeyboardStore.getState().commandKeyPressed).toBe(true)
  act(() => callback?.({ payload: { command: false, edge: 'left' } } as never))
  expect(useKeyboardStore.getState().commandKeyPressed).toBe(false)
  expect(enter).toHaveBeenCalledOnce()
  act(() => callback?.({ payload: { command: null, edge: 'right' } } as never))
  expect(enter).toHaveBeenCalledOnce()
  document.documentElement.style.direction = 'rtl'
  try {
    act(() =>
      callback?.({ payload: { command: null, edge: 'right' } } as never)
    )
    expect(enter).toHaveBeenCalledTimes(2)
    act(() => callback?.({ payload: { command: null, edge: 'left' } } as never))
    expect(enter).toHaveBeenCalledTimes(2)
  } finally {
    document.documentElement.style.removeProperty('direction')
  }
})

it('reports a current native display failure and retries without discarding the joined page', async () => {
  const pageUrl = 'http://pnds-test.localhost:5000/?pndsClientPass=1'
  useClientParticipationStore.setState(state => ({
    snapshot: { ...state.snapshot, pageUrl },
  }))
  vi.mocked(commands.syncClientScoreView).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'participation.errors.scoreView', detail: null },
  })
  const user = userEvent.setup()
  render(<ClientScoreView pageUrl={pageUrl} />)
  mockBoundingClientRect(screen.getByTitle('Performance score'), {
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  })
  fireEvent.resize(window)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your saved page data is kept'
  )
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  )
  expect(useClientParticipationStore.getState().snapshot.pageUrl).toBe(pageUrl)
  expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
})

it('does not apply a late old-page failure or hide to a new confirmed join', async () => {
  const old = 'http://pnds-test.localhost:5000/?pndsClientPass=1'
  const next = 'http://pnds-test.localhost:5000/?pndsClientPass=2'
  useClientParticipationStore.setState(state => ({
    snapshot: { ...state.snapshot, pageUrl: old },
  }))
  let finish!: (
    value: Awaited<ReturnType<typeof commands.syncClientScoreView>>
  ) => void
  vi.mocked(commands.syncClientScoreView).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const mounted = render(<ClientScoreView pageUrl={old} />)
  const surface = screen.getByTitle('Performance score')
  mockBoundingClientRect(surface, { left: 0, top: 0, width: 900, height: 600 })
  fireEvent.resize(window)
  await waitFor(() => expect(commands.syncClientScoreView).toHaveBeenCalled())
  act(() =>
    useClientParticipationStore.setState(state => ({
      snapshot: { ...state.snapshot, pageUrl: next },
    }))
  )
  mounted.rerender(<ClientScoreView pageUrl={next} />)
  fireEvent.resize(window)
  await act(async () =>
    finish({
      status: 'error',
      error: { code: 'participation.errors.scoreView', detail: null },
    })
  )
  await waitFor(() =>
    expect(commands.syncClientScoreView).toHaveBeenLastCalledWith(
      next,
      expect.any(Number),
      expect.objectContaining({ width: 900 })
    )
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  const afterNew = vi
    .mocked(commands.syncClientScoreView)
    .mock.calls.findIndex(([url]) => url === next)
  expect(
    vi
      .mocked(commands.syncClientScoreView)
      .mock.calls.slice(afterNew)
      .every(([url]) => url === next)
  ).toBe(true)
})

it('presents only the current native page inside its measured bounds and yields to host settings', async () => {
  render(
    <ClientScoreView pageUrl="http://pnds-test.localhost:5000/?pndsClientPass=1" />
  )
  const surface = screen.getByTitle('Performance score')
  mockBoundingClientRect(surface, { left: 0, top: 0, width: 900, height: 600 })
  fireEvent.resize(window)
  await waitFor(() =>
    expect(commands.syncClientScoreView).toHaveBeenLastCalledWith(
      'http://pnds-test.localhost:5000/?pndsClientPass=1',
      expect.any(Number),
      {
        x: 0,
        y: 0,
        width: 900,
        height: 600,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }
    )
  )
  expect(surface.tagName).toBe('DIV')
  act(() => useSettingsStore.setState({ settingsOpen: true }))
  await waitFor(() =>
    expect(commands.syncClientScoreView).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Number),
      null
    )
  )
  act(() => useSettingsStore.setState({ settingsOpen: false }))
  await waitFor(() =>
    expect(commands.syncClientScoreView).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({ width: 900 })
    )
  )
})
