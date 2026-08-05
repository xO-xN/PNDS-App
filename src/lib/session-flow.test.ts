import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { canStart, start, restart } from './session-flow'
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
  deviceError: null,
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
      trustedPaths: ['/p'],
      pendingTrustPath: null,
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
