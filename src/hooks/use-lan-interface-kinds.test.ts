import { beforeEach, expect, it, vi } from 'vitest'
import { act, renderHook } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useLanInterfaceKinds } from './use-lan-interface-kinds'

beforeEach(() => {
  vi.mocked(commands.getLanInterfaceKinds)
    .mockReset()
    .mockResolvedValue({
      status: 'ok',
      data: { '192.0.2.1': 'wifi', '192.0.2.2': 'ethernet' },
    })
})

it('batches menu addresses and rechecks types when the menu is reopened', async () => {
  const { result } = renderHook(() =>
    useLanInterfaceKinds(['192.0.2.1', '192.0.2.2'])
  )
  await act(() => Promise.resolve())
  expect(commands.getLanInterfaceKinds).toHaveBeenCalledWith([
    '192.0.2.1',
    '192.0.2.2',
  ])
  expect(result.current.kinds).toEqual({
    '192.0.2.1': 'wifi',
    '192.0.2.2': 'ethernet',
  })
  vi.mocked(commands.getLanInterfaceKinds).mockResolvedValue({
    status: 'ok',
    data: { '192.0.2.1': 'ethernet' },
  })
  await act(async () => result.current.refresh())
  expect(result.current.kinds['192.0.2.1']).toBe('ethernet')
})

it('discards late metadata for the previous list and preserves the new list on failure', async () => {
  let finish:
    | ((
        result: Awaited<ReturnType<typeof commands.getLanInterfaceKinds>>
      ) => void)
    | undefined
  vi.mocked(commands.getLanInterfaceKinds).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  const { result, rerender } = renderHook(
    ({ addresses }) => useLanInterfaceKinds(addresses),
    {
      initialProps: { addresses: ['192.0.2.1'] },
    }
  )
  rerender({ addresses: ['192.0.2.2'] })
  await act(() => Promise.resolve())
  expect(result.current.kinds['192.0.2.2']).toBe('ethernet')
  await act(async () =>
    finish?.({ status: 'ok', data: { '192.0.2.1': 'wifi' } })
  )
  expect(result.current.kinds['192.0.2.2']).toBe('ethernet')
  vi.mocked(commands.getLanInterfaceKinds).mockRejectedValue(
    new Error('Unavailable')
  )
  await act(async () => result.current.refresh())
  expect(result.current.kinds).toEqual({})
})
