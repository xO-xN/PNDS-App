import { beforeEach, expect, it, vi } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import {
  commands,
  type Result,
  type TerminalVisibilitySnapshot,
} from '@/lib/tauri-bindings'
import { observeTerminalHostVisibility } from './project-terminal-visibility'

beforeEach(() => vi.clearAllMocks())

it('registers native visibility before reading its initial snapshot', async () => {
  const off = vi.fn()
  let finishRegistration!: (off: () => void) => void
  vi.mocked(listen).mockReturnValueOnce(
    new Promise(resolve => {
      finishRegistration = resolve
    })
  )
  const changed = vi.fn()
  const observing = observeTerminalHostVisibility(changed)
  expect(commands.getProjectTerminalVisibility).not.toHaveBeenCalled()
  finishRegistration(off)
  const stop = await observing
  expect(changed).toHaveBeenCalledExactlyOnceWith(true)
  stop()
  expect(off).toHaveBeenCalledOnce()
})

function publish(snapshot: TerminalVisibilitySnapshot) {
  const registration = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'project-terminal-visibility-event')
  const callback = registration?.[1]
  if (!callback) throw new Error('Missing terminal visibility registration')
  ;(
    callback as (event: {
      payload: { snapshot: TerminalVisibilitySnapshot }
    }) => void
  )({ payload: { snapshot } })
}

it('keeps a newer native hide event when the initial snapshot arrives late and stops after disposal', async () => {
  let finishSnapshot!: (
    result: Result<TerminalVisibilitySnapshot, string>
  ) => void
  vi.mocked(commands.getProjectTerminalVisibility).mockReturnValueOnce(
    new Promise(resolve => {
      finishSnapshot = resolve
    })
  )
  const off = vi.fn()
  vi.mocked(listen).mockResolvedValueOnce(off)
  const changed = vi.fn()
  const observing = observeTerminalHostVisibility(changed)
  await vi.waitFor(() =>
    expect(commands.getProjectTerminalVisibility).toHaveBeenCalledOnce()
  )
  publish({ revision: 2, visible: false })
  finishSnapshot({ status: 'ok', data: { revision: 1, visible: true } })
  const stop = await observing
  expect(changed.mock.calls).toEqual([[false]])
  publish({ revision: 1, visible: true })
  publish({ revision: 3, visible: true })
  expect(changed.mock.calls).toEqual([[false], [true]])
  stop()
  stop()
  publish({ revision: 4, visible: false })
  expect(changed.mock.calls).toEqual([[false], [true]])
  expect(off).toHaveBeenCalledOnce()
})

it('releases its native subscription if the initial visibility read fails', async () => {
  const off = vi.fn()
  vi.mocked(listen).mockResolvedValueOnce(off)
  vi.mocked(commands.getProjectTerminalVisibility).mockResolvedValueOnce({
    status: 'error',
    error: 'Native window unavailable',
  })
  const changed = vi.fn()
  await expect(observeTerminalHostVisibility(changed)).rejects.toThrow(
    'Native window unavailable'
  )
  publish({ revision: 2, visible: true })
  expect(changed).not.toHaveBeenCalled()
  expect(off).toHaveBeenCalledOnce()
})
