import { PERFORMER_CONFIG, PERFORMER_PAGE, PERFORMER_READY } from '@/lib/events'
import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { listen, emitTo } from '@tauri-apps/api/event'
import { commands } from '@/lib/tauri-bindings'
import { PerformerApp } from './PerformerApp'
import type { PerformerConfig } from '@/lib/performer-protocol'

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
}
let receive: (value: PerformerConfig) => Promise<void>
beforeEach(() => {
  vi.clearAllMocks()
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

it('keeps the real page and input in place while resizing, follows bridges, and ignores older configurations', async () => {
  render(<PerformerApp />)
  await waitFor(() =>
    expect(emitTo).toHaveBeenCalledWith('main', PERFORMER_READY, {
      label: first.label,
    })
  )
  await act(async () => receive(first))
  const frame = await screen.findByTitle('Performer page #1')
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
  expect(frame).toHaveStyle({ width: '1024px', height: '768px' })
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'pnds:theme', theme: 'brutal' }),
    'http://127.0.0.1:6868'
  )
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'pnds:locale', locale: 'zh-CN' }),
    'http://127.0.0.1:6868'
  )
  await act(async () => receive(first))
  expect(frame).toHaveStyle({ width: '1024px', height: '768px' })
  expect(commands.startProject).not.toHaveBeenCalled()
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
