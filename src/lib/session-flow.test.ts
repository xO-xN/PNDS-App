import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  canStart,
  nodeGateBlocksStart,
  start,
  restart,
  startReplacing,
} from './session-flow'
import type { Manifest, SessionSnapshot } from '@/lib/tauri-bindings'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: ['supercollider/synthdefs/inarticulate-iii.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

const base = {
  currentProject: { path: '/p', manifest },
  preflightStatus: 'ready',
  lanIp: '192.168.1.10',
  audioMode: 'internal',
  oscTargetInput: '127.0.0.1:3333',
}

/** A backend snapshot for the given status; only the fields the store reads. */
function snapshot(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    status: 'starting',
    projectName: 'Inarticulate III',
    projectPath: '/p',
    audioMode: 'internal',
    lanIp: '192.168.1.10',
    oscTarget: null,
    health: null,
    error: null,
    outputTail: [],
    volume: 80,
    startupStage: 1,
    channelPlan: null,
    outputDevice: null,
    ...over,
  }
}

const readyHealth = {
  status: 'ready',
  projectId: 'inarticulate-iii',
  audioMode: 'internal',
  audio: { status: 'ready', target: '127.0.0.1:57110', error: null },
  scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
}

describe('session-flow Retry (§9.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: { path: '/p', manifest },
      recentProjectPaths: ['/p'],
      preflightStatus: 'ready',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
    useSessionStore.setState({
      lanIp: '192.168.1.10',
      lanAddresses: ['192.168.1.10'],
      audioMode: 'internal',
    })
    vi.mocked(commands.startProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    vi.mocked(commands.stopProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
  })

  it('canStart accepts idle and error states, rejects starting/ready', () => {
    expect(canStart({ ...base, sessionStatus: 'idle' })).toBe(true)
    expect(canStart({ ...base, sessionStatus: 'error' })).toBe(true)
    expect(canStart({ ...base, sessionStatus: 'starting' })).toBe(false)
    expect(canStart({ ...base, sessionStatus: 'ready' })).toBe(false)
    expect(canStart({ ...base, sessionStatus: 'stopping' })).toBe(false)
  })

  it('drives idle -> starting -> ready', async () => {
    await start()
    expect(commands.startProject).toHaveBeenCalledTimes(1)

    const store = useSessionStore.getState()
    store.applySnapshot(snapshot({ status: 'starting' }))
    expect(useSessionStore.getState().sessionStatus).toBe('starting')

    store.applySnapshot(
      snapshot({ status: 'ready', health: readyHealth, startupStage: 4 })
    )
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
    expect(useSessionStore.getState().sessionError).toBeNull()
  })

  it('drives error -> starting -> ready without an intervening stop', async () => {
    useSessionStore.setState({ sessionStatus: 'error', sessionError: 'boom' })

    await start()

    expect(commands.startProject).toHaveBeenCalledTimes(1)
    expect(commands.stopProject).not.toHaveBeenCalled()

    const store = useSessionStore.getState()
    store.applySnapshot(snapshot({ status: 'starting' }))
    expect(useSessionStore.getState().sessionStatus).toBe('starting')
    expect(useSessionStore.getState().sessionError).toBeNull()

    store.applySnapshot(
      snapshot({ status: 'ready', health: readyHealth, startupStage: 4 })
    )
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
  })

  it('retries from error without calling the public stop flow (§9.3)', async () => {
    useSessionStore.setState({ sessionStatus: 'error', sessionError: 'boom' })

    await start()

    expect(commands.startProject).toHaveBeenCalledTimes(1)
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('a failed retry surfaces the new error, replacing the old one', async () => {
    useSessionStore.setState({ sessionStatus: 'error', sessionError: 'old' })
    vi.mocked(commands.startProject).mockResolvedValue({
      status: 'error',
      error: 'Port 6868 is already in use',
    })

    await start()

    expect(useSessionStore.getState().sessionStatus).toBe('error')
    expect(useSessionStore.getState().sessionError).toBe(
      'Port 6868 is already in use'
    )
  })

  it('a retry that fails asynchronously still shows the new error', async () => {
    useSessionStore.setState({ sessionStatus: 'error', sessionError: 'old' })

    await start()
    // The backend accepted the start, then the supervisor failed.
    useSessionStore.getState().applySnapshot(snapshot({ status: 'starting' }))
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'error',
        error: 'Timed out waiting for the project to report ready (30s).',
        startupStage: 0,
      })
    )

    expect(useSessionStore.getState().sessionStatus).toBe('error')
    expect(useSessionStore.getState().sessionError).toBe(
      'Timed out waiting for the project to report ready (30s).'
    )
  })

  it('a double-click on Retry starts exactly one session', async () => {
    useSessionStore.setState({ sessionStatus: 'error', sessionError: 'boom' })
    let release: (() => void) | undefined
    vi.mocked(commands.startProject).mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve({ status: 'ok', data: null })
        })
    )

    // Both clicks land before the backend publishes `starting`, so the
    // gating state alone would still say "startable".
    const first = start()
    const second = start()
    release?.()
    await Promise.all([first, second])

    expect(commands.startProject).toHaveBeenCalledTimes(1)
  })

  it('the in-flight latch is released, so a later retry still works', async () => {
    useSessionStore.setState({ sessionStatus: 'error', sessionError: 'boom' })
    await start()
    useSessionStore.setState({ sessionStatus: 'error', sessionError: 'again' })
    await start()

    expect(commands.startProject).toHaveBeenCalledTimes(2)
  })

  it('opens a new loading session (runId) on every entry into starting', async () => {
    const store = useSessionStore.getState()
    const initial = useSessionStore.getState().runId

    store.applySnapshot(snapshot({ status: 'starting' }))
    const firstRun = useSessionStore.getState().runId
    expect(firstRun).toBe(initial + 1)

    // Intermediate starting snapshots must NOT restart the animation.
    store.applySnapshot(snapshot({ status: 'starting', startupStage: 2 }))
    store.applySnapshot(snapshot({ status: 'starting', startupStage: 3 }))
    expect(useSessionStore.getState().runId).toBe(firstRun)

    // Failure, then Retry: a brand-new loading session.
    store.applySnapshot(snapshot({ status: 'error', error: 'boom' }))
    expect(useSessionStore.getState().runId).toBe(firstRun)
    store.applySnapshot(snapshot({ status: 'starting' }))
    expect(useSessionStore.getState().runId).toBe(firstRun + 1)
  })

  it('does not restart the loading session while dissolving into ready', () => {
    const store = useSessionStore.getState()
    store.applySnapshot(snapshot({ status: 'starting' }))
    const runId = useSessionStore.getState().runId
    store.applySnapshot(
      snapshot({ status: 'ready', health: readyHealth, startupStage: 4 })
    )
    expect(useSessionStore.getState().runId).toBe(runId)
  })

  it('a stale error snapshot cannot un-ready a running session', () => {
    // The backend drops superseded generations, so a late error for the
    // failed run never reaches the store; what does arrive is ordered.
    const store = useSessionStore.getState()
    store.applySnapshot(snapshot({ status: 'starting' }))
    store.applySnapshot(
      snapshot({ status: 'ready', health: readyHealth, startupStage: 4 })
    )
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
    expect(useSessionStore.getState().sessionError).toBeNull()
    expect(useSessionStore.getState().outputTail).toEqual([])
  })

  it('restart still stops first (§8.3) — only Retry skips the stop', async () => {
    useSessionStore.setState({ sessionStatus: 'ready' })
    await restart()
    expect(commands.stopProject).toHaveBeenCalledTimes(1)
    expect(commands.startProject).toHaveBeenCalledTimes(1)
  })
})

/**
 * v1.2.3 (#39/T4): loading a different project over a live session —
 * canStart relaxes its session gate for a non-running selection, and
 * startReplacing stops the old session then starts the selected project
 * with its pending config.
 */
describe('startReplacing (confirm-and-replace switch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: { path: '/b', manifest },
      recentProjectPaths: ['/a', '/b'],
      preflightStatus: 'ready',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
    // A runs; the selection is B with its own pending config.
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/a',
      projectName: 'Project A',
      lanIp: '192.168.1.10',
      lanAddresses: ['192.168.1.10'],
      audioMode: 'external',
      oscTargetInput: '127.0.0.1:3333',
    })
  })

  it('canStart allows a non-running selection over a ready session', () => {
    expect(
      canStart({
        ...base,
        sessionStatus: 'ready',
        selectionIsRunningCard: false,
      })
    ).toBe(true)
    // The running card itself still follows the idle/error gate.
    expect(canStart({ ...base, sessionStatus: 'ready' })).toBe(false)
  })

  it('stops the old session, then starts the selection with its config', async () => {
    const order: string[] = []
    vi.mocked(commands.stopProject).mockImplementation(async () => {
      order.push('stop')
      return { status: 'ok', data: null }
    })
    vi.mocked(commands.startProject).mockImplementation(async () => {
      order.push('start')
      return { status: 'ok', data: null }
    })

    await startReplacing()

    expect(order).toEqual(['stop', 'start'])
    expect(commands.startProject).toHaveBeenCalledWith(
      '/b',
      'external',
      '192.168.1.10',
      '127.0.0.1:3333'
    )
    // The selection survives the switch — stopAndReset is not used.
    expect(useProjectStore.getState().currentProject?.path).toBe('/b')
  })

  it('is latched — a second call while in flight does nothing', async () => {
    let release: (value: { status: 'ok'; data: null }) => void = () => undefined
    vi.mocked(commands.stopProject).mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve({ status: 'ok', data: null })
        })
    )
    const first = startReplacing()
    await startReplacing() // in flight — must not queue a second stop
    release({ status: 'ok', data: null })
    await first
    expect(commands.stopProject).toHaveBeenCalledTimes(1)
  })

  it('refuses without a loadable selection', async () => {
    useProjectStore.setState({ preflightStatus: 'error' })
    await startReplacing()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })
})

/**
 * #58: the「设置节点」gate — a telematic-declared selection with an
 * incomplete App-global node config never starts. Completeness only;
 * undeclared projects are never gated.
 */
describe('「设置节点」gate (#58)', () => {
  const telematicManifest: Manifest = { ...manifest, telematic: true }

  function seedNodeConfig(nodeName: string, hubUrl: string, hubToken: string) {
    useSettingsStore.setState({
      nodeNameSetting: nodeName,
      hubUrlSetting: hubUrl,
      hubTokenSetting: hubToken,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    seedNodeConfig('', '', '')
    useSettingsStore.setState({ hubRooms: {} })
    useProjectStore.setState({
      currentProject: { path: '/p', manifest: telematicManifest },
      recentProjectPaths: ['/p'],
      preflightStatus: 'ready',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
    useSessionStore.setState({
      lanIp: '192.168.1.10',
      lanAddresses: ['192.168.1.10'],
      audioMode: 'internal',
    })
  })

  it('blocks a declared project while any node field is blank', () => {
    expect(nodeGateBlocksStart()).toBe(true)
    seedNodeConfig('Node', '', 'token')
    expect(nodeGateBlocksStart()).toBe(true)
    seedNodeConfig('Node', 'wss://hub', '')
    expect(nodeGateBlocksStart()).toBe(true)
    // Whitespace-only counts as unset, matching the Rust resolver.
    seedNodeConfig('  ', 'wss://hub', 'token')
    expect(nodeGateBlocksStart()).toBe(true)
  })

  it('releases once all three fields are filled; undeclared never blocks', () => {
    seedNodeConfig('Node', 'wss://hub', 'token')
    expect(nodeGateBlocksStart()).toBe(false)
    useProjectStore.setState({
      currentProject: { path: '/p', manifest },
    })
    expect(nodeGateBlocksStart()).toBe(false)
  })

  it('canStart refuses a gated start, whichever card is selected', () => {
    expect(
      canStart({ ...base, sessionStatus: 'idle', nodeGateBlocked: true })
    ).toBe(false)
    expect(
      canStart({
        ...base,
        sessionStatus: 'ready',
        selectionIsRunningCard: false,
        nodeGateBlocked: true,
      })
    ).toBe(false)
    expect(
      canStart({ ...base, sessionStatus: 'idle', nodeGateBlocked: false })
    ).toBe(true)
  })

  it('start() and startReplacing() refuse while gated', async () => {
    await start()
    expect(commands.startProject).not.toHaveBeenCalled()

    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
    })
    await startReplacing()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('restart() refuses while gated — no restart into an unconfigured node', async () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
    })
    await restart()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('start() proceeds once the config is complete', async () => {
    seedNodeConfig('Node', 'wss://hub.example.org:3000', 'token')
    await start()
    expect(commands.startProject).toHaveBeenCalledTimes(1)
  })
})
