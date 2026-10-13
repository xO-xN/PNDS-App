import { expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { syncNativeWindowControls } from './native-window-controls'

it('serializes native visibility and drops outdated requests after a hide/reveal race', async () => {
  vi.clearAllMocks()
  let finish!: () => void
  vi.mocked(commands.setMainControlsVisible).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = () => resolve({ status: 'ok', data: null })
      })
  )
  const showing = syncNativeWindowControls(true, -20, 0)
  await Promise.resolve()
  const obsoleteHide = syncNativeWindowControls(false, 0, 0)
  const currentHide = syncNativeWindowControls(false, 0, 0)
  finish()
  await Promise.all([showing, obsoleteHide, currentHide])
  expect(vi.mocked(commands.setMainControlsVisible).mock.calls).toEqual([
    [true, -20, 0, 34],
    [false, 0, 0, 34],
  ])
})

it('uses the compact titlebar inset and restores the performance inset on handoff', async () => {
  vi.clearAllMocks()
  await syncNativeWindowControls(true, -12, 1, 18)
  await syncNativeWindowControls(true)
  expect(vi.mocked(commands.setMainControlsVisible).mock.calls).toEqual([
    [true, -12, 1, 18],
    [true, 0, 1, 34],
  ])
})
