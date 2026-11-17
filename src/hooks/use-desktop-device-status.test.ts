import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, renderHook } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useDesktopDeviceStatus } from './use-desktop-device-status'

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(commands.getDesktopDeviceStatus)
    .mockReset()
    .mockResolvedValue({
      status: 'ok',
      data: { audio: 'headphones', network: 'wifi' },
    })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('refreshes device changes, skips hidden windows, and cleans up polling', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const { result, unmount } = renderHook(() =>
    useDesktopDeviceStatus(null, '192.168.1.2', true)
  )
  await act(() => Promise.resolve())
  expect(result.current).toEqual({ audio: 'headphones', network: 'wifi' })
  expect(commands.getDesktopDeviceStatus).toHaveBeenCalledWith(
    null,
    '192.168.1.2',
    true
  )
  vi.mocked(commands.getDesktopDeviceStatus).mockResolvedValue({
    status: 'ok',
    data: { audio: 'speaker', network: 'ethernet' },
  })
  await act(() => vi.advanceTimersByTimeAsync(3000))
  expect(result.current).toEqual({ audio: 'speaker', network: 'ethernet' })
  hidden.mockReturnValue(true)
  const calls = vi.mocked(commands.getDesktopDeviceStatus).mock.calls.length
  await act(() => vi.advanceTimersByTimeAsync(6000))
  expect(commands.getDesktopDeviceStatus).toHaveBeenCalledTimes(calls)
  hidden.mockReturnValue(false)
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(commands.getDesktopDeviceStatus).toHaveBeenCalledTimes(calls + 1)
  unmount()
  await act(() => vi.advanceTimersByTimeAsync(6000))
  expect(commands.getDesktopDeviceStatus).toHaveBeenCalledTimes(calls + 1)
})

it('rejects late results from a previous route and falls back on read failure', async () => {
  let finish:
    | ((
        value: Awaited<ReturnType<typeof commands.getDesktopDeviceStatus>>
      ) => void)
    | undefined
  vi.mocked(commands.getDesktopDeviceStatus)
    .mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    .mockResolvedValue({
      status: 'ok',
      data: { audio: 'interface', network: 'ethernet' },
    })
  const { result, rerender } = renderHook(
    ({ device, ip }) => useDesktopDeviceStatus(device, ip, true),
    { initialProps: { device: 'Old output', ip: '192.168.1.2' } }
  )
  rerender({ device: 'Applied output', ip: '192.168.2.2' })
  expect(result.current).toEqual({ audio: 'unknown', network: 'unknown' })
  await act(() => Promise.resolve())
  expect(result.current).toEqual({ audio: 'interface', network: 'ethernet' })
  await act(async () =>
    finish?.({ status: 'ok', data: { audio: 'headphones', network: 'wifi' } })
  )
  expect(result.current).toEqual({ audio: 'interface', network: 'ethernet' })
  vi.mocked(commands.getDesktopDeviceStatus).mockRejectedValue(
    new Error('Unavailable')
  )
  await act(() => vi.advanceTimersByTimeAsync(3000))
  expect(result.current).toEqual({ audio: 'unknown', network: 'unknown' })
})
