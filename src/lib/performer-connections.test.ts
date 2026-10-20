import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { commands } from './tauri-bindings'
import { setupPerformerConnections } from './performer-connections'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationPerformersStore } from '@/store/creation-performers-store'

let dispose: (() => void) | undefined
const report = {
  generation: '1',
  passed: true,
  checks: [],
  performers: {
    schemaVersion: 1,
    clients: [{ id: 'phone', label: 'Phone', testClient: null }],
  },
  savedChangesVerified: false,
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(commands.inspectCreationRuntime)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: report })
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'a',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
    runId: 1,
  })
})
afterEach(() => {
  dispose?.()
  vi.useRealTimers()
})

it('shows real joins, removes disconnected phones, and distinguishes unsupported from zero', async () => {
  dispose = setupPerformerConnections()
  await vi.advanceTimersByTimeAsync(0)
  expect(
    useCreationPerformersStore.getState().connections?.clients[0]?.id
  ).toBe('phone')
  expect(commands.inspectCreationRuntime).toHaveBeenCalledWith('a', false)
  vi.mocked(commands.inspectCreationRuntime).mockResolvedValueOnce({
    status: 'ok',
    data: { ...report, performers: { schemaVersion: 1, clients: [] } },
  })
  await vi.advanceTimersByTimeAsync(2000)
  expect(useCreationPerformersStore.getState()).toMatchObject({
    connectionStatus: 'available',
    connections: { clients: [] },
  })
  vi.mocked(commands.inspectCreationRuntime).mockResolvedValueOnce({
    status: 'ok',
    data: { ...report, performers: null },
  })
  await vi.advanceTimersByTimeAsync(2000)
  expect(useCreationPerformersStore.getState()).toMatchObject({
    connectionStatus: 'unsupported',
    connections: null,
  })
  vi.mocked(commands.inspectCreationRuntime).mockRejectedValueOnce(
    new Error('offline')
  )
  await vi.advanceTimersByTimeAsync(2000)
  expect(useCreationPerformersStore.getState()).toMatchObject({
    connectionStatus: 'unavailable',
    connections: null,
  })
})

it('discards a late roster after a run change and clears rows when stopped', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.inspectCreationRuntime>>
  ) => void
  vi.mocked(commands.inspectCreationRuntime).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  dispose = setupPerformerConnections()
  useSessionStore.setState({ runId: 2 })
  await vi.advanceTimersByTimeAsync(0)
  vi.mocked(commands.inspectCreationRuntime).mockResolvedValue({
    status: 'ok',
    data: { ...report, performers: null },
  })
  useSessionStore.setState({ runId: 3 })
  await vi.advanceTimersByTimeAsync(0)
  finish({ status: 'ok', data: report })
  await vi.advanceTimersByTimeAsync(0)
  expect(useCreationPerformersStore.getState()).toMatchObject({
    connectionStatus: 'unsupported',
    connections: null,
  })
  useSessionStore.setState({ sessionStatus: 'idle' })
  expect(useCreationPerformersStore.getState()).toMatchObject({
    connectionStatus: 'standby',
    connections: null,
  })
  const calls = vi.mocked(commands.inspectCreationRuntime).mock.calls.length
  await vi.advanceTimersByTimeAsync(5000)
  expect(commands.inspectCreationRuntime).toHaveBeenCalledTimes(calls)
})
