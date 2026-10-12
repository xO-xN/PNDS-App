import { beforeEach, expect, it, vi } from 'vitest'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { currentMonitor } from '@tauri-apps/api/window'
import { fitPerformerWindow } from './performer-window-size'

const native = vi.hoisted(() => ({
  innerSize: vi.fn(),
  outerSize: vi.fn(),
  outerPosition: vi.fn(),
  isFullscreen: vi.fn(),
  isMaximized: vi.fn(),
  setSize: vi.fn(),
  setPosition: vi.fn(),
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => native,
}))
vi.mock('@tauri-apps/api/window', async () => {
  const dpi = await import('@tauri-apps/api/dpi')
  return {
    LogicalSize: dpi.LogicalSize,
    LogicalPosition: dpi.LogicalPosition,
    currentMonitor: vi.fn(),
  }
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(currentMonitor).mockResolvedValue({
    name: 'Retina',
    scaleFactor: 2,
    size: new PhysicalSize(2560, 1700),
    position: new PhysicalPosition(0, 0),
    workArea: {
      size: new PhysicalSize(2560, 1600),
      position: new PhysicalPosition(0, 0),
    },
  })
  native.innerSize.mockResolvedValue(new PhysicalSize(1760, 1520))
  native.outerSize.mockResolvedValue(new PhysicalSize(1760, 1576))
  native.outerPosition.mockResolvedValue(new PhysicalPosition(200, 200))
  native.isFullscreen.mockResolvedValue(false)
  native.isMaximized.mockResolvedValue(false)
  native.setSize.mockResolvedValue(undefined)
  native.setPosition.mockResolvedValue(undefined)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
})
it('fits a portrait phone tightly within Retina work area and follows a landscape switch', async () => {
  await fitPerformerWindow(
    { width: 390, height: 844 },
    () => ({ width: 40, height: 100 }),
    () => true
  )
  expect(native.setSize).toHaveBeenLastCalledWith(
    expect.objectContaining({ width: 340, height: 748 })
  )
  expect(native.setPosition).toHaveBeenLastCalledWith(
    expect.objectContaining({ x: 100, y: 12 })
  )
  await fitPerformerWindow(
    { width: 844, height: 390 },
    () => ({ width: 40, height: 100 }),
    () => true
  )
  expect(native.setSize).toHaveBeenLastCalledWith(
    expect.objectContaining({ width: 884, height: 490 })
  )
})

it('remeasures wrapped shell controls and leaves fullscreen windows alone', async () => {
  const insets = vi
    .fn()
    .mockReturnValueOnce({ width: 40, height: 60 })
    .mockReturnValue({ width: 40, height: 100 })
  await fitPerformerWindow({ width: 390, height: 844 }, insets, () => true)
  expect(native.setSize).toHaveBeenLastCalledWith(
    expect.objectContaining({ width: 340, height: 748 })
  )
  native.setSize.mockClear()
  native.isFullscreen.mockResolvedValue(true)
  await fitPerformerWindow({ width: 1180, height: 820 }, insets, () => true)
  expect(native.setSize).not.toHaveBeenCalled()
})
it('does not apply a fit from an obsolete configuration and reports unavailable monitor geometry', async () => {
  await fitPerformerWindow(
    { width: 390, height: 844 },
    () => ({ width: 40, height: 100 }),
    () => false
  )
  expect(native.setSize).not.toHaveBeenCalled()
  vi.mocked(currentMonitor).mockResolvedValue(null)
  await expect(
    fitPerformerWindow(
      { width: 390, height: 844 },
      () => ({ width: 40, height: 100 }),
      () => true
    )
  ).rejects.toThrow('screen work area is unavailable')
  expect(native.setSize).not.toHaveBeenCalled()
})

it.each(['isFullscreen', 'isMaximized'] as const)(
  'stops fitting if the user enters %s after the first resize',
  async method => {
    native.setSize.mockImplementationOnce(async () => {
      native[method].mockResolvedValue(true)
    })
    await fitPerformerWindow(
      { width: 390, height: 844 },
      () => ({ width: 40, height: 100 }),
      () => true
    )
    expect(native.setSize).toHaveBeenCalledTimes(1)
    expect(native.setPosition).not.toHaveBeenCalled()
  }
)
