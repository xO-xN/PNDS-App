import { beforeEach, expect, it, vi } from 'vitest'
import {
  commands,
  type ClientHostInfo,
  type ClientLanNode,
  type ClientNodePreview,
} from '@/lib/tauri-bindings'
import {
  attachClientParticipation,
  selectClientCandidate,
  useClientParticipationStore,
} from './client-participation-store'
import { usePerformanceRoleStore } from './performance-role-store'

const store = useClientParticipationStore
const roles = usePerformanceRoleStore
const idle = store.getInitialState().snapshot
const address = 'http://192.168.1.24:8800/'
const stage: ClientHostInfo = {
  protocolVersion: 1,
  hostId: 'stage',
  nodeName: 'Stage Mac',
  role: 'host',
  performance: {
    projectId: 'piece',
    performanceId: 'first-run',
    projectName: 'Tide',
    performerUrl: address,
    supportsPerformerUrl: true,
  },
}
const preview: ClientNodePreview = { address, host: stage, readme: null }
const stagePeer: ClientLanNode = {
  nodeId: stage.hostId,
  nodeName: stage.nodeName,
  role: 'host',
  address,
  projectName: 'Tide',
  loading: false,
}
const clientPeer: ClientLanNode = {
  nodeId: 'right',
  nodeName: 'Stage Right Mac',
  role: 'client',
  address: null,
  projectName: null,
  loading: false,
}
const unavailable = { code: 'participation.errors.unavailable', detail: null }

beforeEach(() => {
  vi.clearAllMocks()
  store.setState(store.getInitialState())
  roles.setState(roles.getInitialState())
})

it('retains an absent LAN node offline and updates the same row when it returns', () => {
  store.getState().acceptDirectory([stagePeer, clientPeer])
  store.getState().acceptDirectory([clientPeer])

  expect(store.getState().peers).toEqual([clientPeer])
  expect(store.getState().offlinePeers).toEqual([stagePeer])

  const creation: ClientLanNode = {
    ...stagePeer,
    nodeName: 'Creation Mac',
    role: 'creation',
    address: 'http://192.168.1.51:8801/',
    projectName: 'Echo',
  }
  store.getState().acceptDirectory([clientPeer, creation])

  expect(store.getState().peers).toEqual([creation, clientPeer])
  expect(store.getState().offlinePeers).toEqual([])
  expect([...store.getState().sessionPeers.keys()]).toEqual(['stage', 'right'])
})

it('retains a manually verified node through a direct failure and recovery', async () => {
  roles.getState().selectRole('client')
  vi.mocked(commands.inspectClientNode)
    .mockResolvedValueOnce({ status: 'error', error: unavailable })
    .mockResolvedValueOnce({ status: 'ok', data: preview })
    .mockResolvedValueOnce({ status: 'error', error: unavailable })
    .mockResolvedValueOnce({ status: 'ok', data: preview })

  await store.getState().inspect(undefined, address)
  expect(store.getState().sessionPeers.size).toBe(0)

  await store.getState().inspect(undefined, address)
  store.getState().acceptDirectory([])
  expect(store.getState().peers).toEqual([stagePeer])

  await store.getState().refreshDirectPeer(stage.hostId)
  expect(commands.inspectClientNode).toHaveBeenLastCalledWith(
    address,
    stage.hostId,
    expect.any(String),
    'first-run'
  )
  expect(store.getState().peers).toEqual([])
  expect(store.getState().offlinePeers).toEqual([stagePeer])
  expect(selectClientCandidate(store.getState())).toBeNull()
  await store.getState().join(stage)
  expect(commands.joinClientNode).not.toHaveBeenCalled()

  await store.getState().refreshDirectPeer(stage.hostId)
  expect(store.getState().peers).toEqual([stagePeer])
  expect(store.getState().offlinePeers).toEqual([])
  expect(store.getState().sessionPeers.size).toBe(1)
})

it('keeps a fresh announcement when an older direct probe fails later', async () => {
  roles.getState().selectRole('client')
  let fail!: (result: { status: 'error'; error: typeof unavailable }) => void
  const pending = new Promise<{ status: 'error'; error: typeof unavailable }>(
    resolve => {
      fail = resolve
    }
  )
  vi.mocked(commands.inspectClientNode)
    .mockResolvedValueOnce({ status: 'ok', data: preview })
    .mockReturnValueOnce(pending)
  await store.getState().inspect(undefined, address)
  const probing = store.getState().refreshDirectPeer(stage.hostId)

  const relocated = { ...stagePeer, address: 'http://192.168.1.51:8801/' }
  store.getState().acceptDirectory([relocated])
  fail({ status: 'error', error: unavailable })
  await probing

  expect(store.getState().peers).toEqual([relocated])
  expect(store.getState().offlinePeers).toEqual([])
})

it('collects nodes in Host mode, ignores a directory IPC failure, and retains them through role changes', async () => {
  vi.useFakeTimers()
  roles.getState().selectRole('host')
  vi.mocked(commands.getClientLanNodes)
    .mockResolvedValueOnce({ status: 'ok', data: [stagePeer] })
    .mockRejectedValueOnce(new Error('Directory unavailable'))
    .mockResolvedValueOnce({ status: 'ok', data: [] })
  const detach = attachClientParticipation()
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().peers).toEqual([stagePeer])
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.getState().peers).toEqual([stagePeer])
    expect(store.getState().offlinePeers).toEqual([])

    roles.getState().selectRole('client')
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().offlinePeers).toEqual([stagePeer])
    roles.getState().resetRole()
    expect(store.getState().offlinePeers).toEqual([stagePeer])
  } finally {
    detach()
    vi.useRealTimers()
  }
})

it('keeps a joined node in runtime memory after leaving without saving preferences', async () => {
  roles.getState().selectRole('client')
  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: preview,
  })
  vi.mocked(commands.joinClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...idle,
      revision: 1,
      phase: 'open',
      address,
      host: stage,
      activeHost: stage,
      pageUrl: 'http://127.0.0.1:51000/',
    },
  })
  vi.mocked(commands.leaveClientPerformance).mockResolvedValueOnce({
    status: 'ok',
    data: { ...idle, revision: 2 },
  })

  await store.getState().inspect(undefined, address)
  await store.getState().join(stage)
  expect(store.getState().snapshot.phase).toBe('open')
  expect(await store.getState().leave()).toBe(true)

  expect(store.getState().peers).toEqual([stagePeer])
  expect(commands.savePreferences).not.toHaveBeenCalled()
})
