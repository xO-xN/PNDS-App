import { beforeEach, expect, it, vi } from 'vitest'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useProjectionStore } from '@/store/projection-store'
import { attachProjectionPresence } from './projection-presence'

const callbacks = vi.hoisted(
  (): {
    window: (exists: boolean) => void
    focus: () => void
  } => ({ window: () => undefined, focus: () => undefined })
)
vi.mock('@/lib/events', () => ({
  onProjectionWindow: (callback: (exists: boolean) => void) => {
    callbacks.window = callback
    return () => undefined
  },
  onWindowFocus: (callback: () => void) => {
    callbacks.focus = callback
    return () => undefined
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  useProjectionStore.setState({ windowExists: false, known: false })
})

it('restores existing and closed windows on focus, and rejects probes superseded by native events', async () => {
  let settle: (window: WebviewWindow | null) => void = () => undefined
  vi.mocked(WebviewWindow.getByLabel).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        settle = resolve
      })
  )
  const dispose = attachProjectionPresence()
  callbacks.window(true)
  settle(null)
  await Promise.resolve()
  expect(useProjectionStore.getState().windowExists).toBe(true)
  vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(null)
  callbacks.focus()
  await Promise.resolve()
  expect(useProjectionStore.getState()).toMatchObject({
    windowExists: false,
    known: true,
  })
  dispose()
  vi.mocked(WebviewWindow.getByLabel).mockResolvedValue({} as WebviewWindow)
  callbacks.focus()
  await Promise.resolve()
  expect(useProjectionStore.getState().windowExists).toBe(false)
})
