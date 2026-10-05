import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commands,
  type AppPreferences,
  type AudioMode,
  type Manifest,
} from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { openProject, runPreflight } from './open-project'
import { selectProject, setActiveFolderView } from './project-select'
import { canStartNow } from './session-flow'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function manifest(id: string, mode: AudioMode): Manifest {
  return {
    schemaVersion: 1,
    id,
    name: `Project ${id}`,
    version: '1.0.0',
    description: null,
    scoreServer: {
      entry: 'server.js',
      workingDirectory: '.',
      performerPort: 6868,
      monitorPort: 6869,
    },
    audio: {
      defaultMode: mode,
      supportedModes: ['internal', 'external', 'none'],
      synthdefs: [],
      scsynth: null,
      standaloneTarget: null,
    },
  }
}

const a = manifest('a', 'external')
const b = manifest('b', 'none')
const prefs: AppPreferences = {
  theme: 'system',
  language: null,
  oscTargets: { a: '127.0.0.1:1111', b: '127.0.0.1:2222' },
}
type PreflightResult = Awaited<ReturnType<typeof commands.preflightProject>>
type PreferencesResult = Awaited<ReturnType<typeof commands.loadPreferences>>
type LanResult = Awaited<ReturnType<typeof commands.listLanAddresses>>
type SnapshotResult = Awaited<ReturnType<typeof commands.getSessionState>>

function expectB() {
  expect(useProjectStore.getState()).toMatchObject({
    currentProject: { path: '/b', manifest: b },
    pendingPreflightPath: null,
    preflightStatus: 'ready',
    preflightError: null,
    failedPreflightPath: null,
  })
  expect(useSessionStore.getState()).toMatchObject({
    audioMode: 'none',
    oscTargetInput: '127.0.0.1:2222',
    lanAddresses: ['192.168.1.20'],
    lanIp: '192.168.1.20',
  })
}

describe('preflight request ownership through the shared open flow', () => {
  beforeEach(async () => {
    // Drain preference writes from structural commits before injecting
    // deferred reads into the next flow.
    await new Promise(resolve => setTimeout(resolve, 0))
    vi.clearAllMocks()
    vi.mocked(commands.preflightProject).mockImplementation(async path => ({
      status: 'ok',
      data: path === '/a' ? a : b,
    }))
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: prefs,
    })
    vi.mocked(commands.listLanAddresses).mockResolvedValue({
      status: 'ok',
      data: ['192.168.1.20'],
    })
    useProjectStore.getState().clearProject()
    useProjectStore.setState({
      recentProjectPaths: ['/a', '/b'],
      projectFolders: [],
      activeFolderId: null,
      utilityPaths: [],
      manifestProjectNames: { '/a': a.name, '/b': b.name },
      preflightErrors: {},
    })
    useSessionStore.getState().resetSession()
    useSessionStore.setState({
      lanIp: null,
      lanAddresses: [],
      lanAddressesLoaded: false,
    })
    vi.spyOn(logger, 'warn')
  })

  afterEach(() => vi.restoreAllMocks())

  it.each(['success', 'error', 'rejection'] as const)(
    'discards a late %s after a newer project and all its settings are ready',
    async outcome => {
      const late = deferred<PreflightResult>()
      vi.mocked(commands.preflightProject).mockReturnValueOnce(late.promise)
      const first = openProject('/a')
      await openProject('/b')
      expectB()

      if (outcome === 'rejection') late.reject(new Error('old IPC failure'))
      else
        late.resolve(
          outcome === 'success'
            ? { status: 'ok', data: a }
            : { status: 'error', error: 'old invalid manifest' }
        )
      await first

      expectB()
      expect(useProjectStore.getState().preflightErrors).toEqual({})
      expect(logger.warn).not.toHaveBeenCalled()
      expect(commands.loadPreferences).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps the newest pending highlight when an older request settles first', async () => {
    const old = deferred<PreflightResult>()
    const latest = deferred<PreflightResult>()
    vi.mocked(commands.preflightProject)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise)
    const first = openProject('/a')
    const second = openProject('/b')
    old.resolve({ status: 'error', error: 'old failure' })
    await first
    expect(useProjectStore.getState()).toMatchObject({
      pendingPreflightPath: '/b',
      preflightStatus: 'checking',
      preflightError: null,
    })
    latest.resolve({ status: 'ok', data: b })
    await second
    expectB()
  })

  it('distinguishes A → B → A requests even though the first and last paths match', async () => {
    const oldA = deferred<PreflightResult>()
    const oldB = deferred<PreflightResult>()
    const latestA = deferred<PreflightResult>()
    vi.mocked(commands.preflightProject)
      .mockReturnValueOnce(oldA.promise)
      .mockReturnValueOnce(oldB.promise)
      .mockReturnValueOnce(latestA.promise)
    const first = openProject('/a')
    const second = openProject('/b')
    const third = openProject('/a')
    oldA.resolve({ status: 'ok', data: manifest('old-a', 'internal') })
    await first
    expect(useProjectStore.getState()).toMatchObject({
      currentProject: null,
      pendingPreflightPath: '/a',
      preflightStatus: 'checking',
    })
    latestA.resolve({ status: 'ok', data: a })
    await third
    oldB.resolve({ status: 'error', error: 'old B failure' })
    await second
    expect(useProjectStore.getState().currentProject).toEqual({
      path: '/a',
      manifest: a,
    })
    expect(useSessionStore.getState()).toMatchObject({
      audioMode: 'external',
      oscTargetInput: '127.0.0.1:1111',
    })
    expect(useProjectStore.getState().manifestProjectNames['/a']).toBe(a.name)
  })

  it('discards a late preference read without restoring old OSC input or starting a LAN read', async () => {
    const late = deferred<PreferencesResult>()
    vi.mocked(commands.loadPreferences).mockReturnValueOnce(late.promise)
    const first = runPreflight('/a')
    await vi.waitFor(() =>
      expect(commands.loadPreferences).toHaveBeenCalledTimes(1)
    )
    await runPreflight('/b')
    late.resolve({ status: 'ok', data: prefs })
    await first
    expectB()
    expect(commands.listLanAddresses).toHaveBeenCalledTimes(1)
  })

  it('discards a late LAN enumeration that would replace the current network choice', async () => {
    const late = deferred<LanResult>()
    vi.mocked(commands.listLanAddresses).mockReturnValueOnce(late.promise)
    const first = runPreflight('/a')
    await vi.waitFor(() =>
      expect(commands.listLanAddresses).toHaveBeenCalledTimes(1)
    )
    await runPreflight('/b')
    late.resolve({ status: 'ok', data: ['10.0.0.9'] })
    await first
    expectB()
  })

  it.each(['snapshot', 'preferences'] as const)(
    'discards late %s while reselecting the running card',
    async stage => {
      useProjectStore.setState({ currentProject: { path: '/b', manifest: b } })
      useSessionStore.setState({
        sessionStatus: 'ready',
        sessionProjectPath: '/a',
        projectName: a.name,
      })
      const lateSnapshot = deferred<SnapshotResult>()
      const latePrefs = deferred<PreferencesResult>()
      const snapshot: SnapshotResult = {
        status: 'ok',
        data: {
          status: 'ready',
          projectName: a.name,
          projectPath: '/a',
          audioMode: 'internal',
          lanIp: '10.0.0.9',
          hostAddress: '10.0.0.9',
          oscTarget: null,
          health: null,
          error: null,
          outputTail: [],
          volume: 10,
          projectionStarted: true,
          startupStage: 0,
          channelPlan: null,
          outputDevice: null,
          httpsEntry: { status: 'off', url: null, error: null },
          dnsMapping: { status: 'off', domain: null, ip: null, error: null },
        },
      }
      vi.mocked(commands.getSessionState).mockReturnValueOnce(
        stage === 'snapshot' ? lateSnapshot.promise : Promise.resolve(snapshot)
      )
      if (stage === 'preferences')
        vi.mocked(commands.loadPreferences).mockReturnValueOnce(
          latePrefs.promise
        )
      const first = runPreflight('/a')
      await vi.waitFor(() =>
        expect(
          stage === 'snapshot'
            ? commands.getSessionState
            : commands.loadPreferences
        ).toHaveBeenCalledTimes(1)
      )
      await runPreflight('/b')
      if (stage === 'snapshot') lateSnapshot.resolve(snapshot)
      else latePrefs.resolve({ status: 'ok', data: prefs })
      await first
      expectB()
      expect(useSessionStore.getState()).toMatchObject({
        sessionStatus: 'ready',
        sessionProjectPath: '/a',
        volume: 80,
        projectionStarted: false,
      })
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
    }
  )

  it.each([
    'clear',
    'remove-and-readd',
    'clear-history',
    'replace-index',
    'folder-view',
  ] as const)('invalidates an outstanding request on %s', async action => {
    const late = deferred<PreflightResult>()
    vi.mocked(commands.preflightProject).mockReturnValueOnce(late.promise)
    const first = openProject('/a')
    const project = useProjectStore.getState()
    if (action === 'clear') project.clearProject()
    else if (action === 'remove-and-readd') {
      project.removeRecentProject('/a')
      project.addRecentProject('/a')
    } else if (action === 'clear-history') project.clearRecentProjects()
    else if (action === 'replace-index') project.replaceProjectIndex(['/b'], [])
    else setActiveFolderView('another-folder')
    const config = useSessionStore.getState()
    late.resolve({ status: 'ok', data: a })
    await first
    expect(useProjectStore.getState()).toMatchObject({
      currentProject: null,
      pendingPreflightPath: null,
      preflightStatus: 'idle',
    })
    expect(useSessionStore.getState()).toBe(config)
  })

  it('cancels seeding when the selection is cleared during preference loading', async () => {
    const late = deferred<PreferencesResult>()
    vi.mocked(commands.loadPreferences).mockReturnValueOnce(late.promise)
    const first = runPreflight('/a')
    await vi.waitFor(() =>
      expect(commands.loadPreferences).toHaveBeenCalledTimes(1)
    )
    useProjectStore.getState().clearProject()
    const config = useSessionStore.getState()
    late.resolve({ status: 'ok', data: prefs })
    await first
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useSessionStore.getState()).toBe(config)
    expect(commands.listLanAddresses).not.toHaveBeenCalled()
  })

  it('allows selecting the previously ready card while a different card is pending', async () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest: a },
      preflightStatus: 'ready',
    })
    const late = deferred<PreflightResult>()
    vi.mocked(commands.preflightProject).mockReturnValueOnce(late.promise)
    selectProject('/b')
    selectProject('/a')
    await vi.waitFor(() =>
      expect(useProjectStore.getState().pendingPreflightPath).toBeNull()
    )
    expect(useProjectStore.getState().currentProject?.path).toBe('/a')
    late.resolve({ status: 'ok', data: b })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(useProjectStore.getState().currentProject?.path).toBe('/a')
    expect(commands.preflightProject).toHaveBeenCalledTimes(2)
  })

  it.each(['returned error', 'rejected invoke'])(
    'settles a current %s as a readable card error, then allows a retry',
    async failure => {
      if (failure === 'returned error')
        vi.mocked(commands.preflightProject).mockResolvedValueOnce({
          status: 'error',
          error: 'IPC unavailable',
        })
      else
        vi.mocked(commands.preflightProject).mockRejectedValueOnce(
          new Error('IPC unavailable')
        )
      await openProject('/a')
      expect(useProjectStore.getState()).toMatchObject({
        pendingPreflightPath: null,
        preflightStatus: 'error',
        preflightError: 'IPC unavailable',
        failedPreflightPath: '/a',
      })
      expect(logger.warn).toHaveBeenCalledOnce()
      expect(commands.loadPreferences).not.toHaveBeenCalled()
      await openProject('/b')
      expectB()
    }
  )

  it('keeps Load disabled until the current request has prepared its complete configuration', async () => {
    const late = deferred<PreferencesResult>()
    vi.mocked(commands.loadPreferences).mockReturnValueOnce(late.promise)
    useSessionStore.getState().setLanIp('192.168.1.20')
    const first = openProject('/a')
    await vi.waitFor(() =>
      expect(commands.loadPreferences).toHaveBeenCalledTimes(1)
    )
    expect(useProjectStore.getState()).toMatchObject({
      pendingPreflightPath: '/a',
      preflightStatus: 'checking',
      currentProject: null,
    })
    expect(canStartNow()).toBe(false)
    late.resolve({ status: 'ok', data: prefs })
    await first
    expect(canStartNow()).toBe(true)
    expect(useSessionStore.getState()).toMatchObject({
      audioMode: 'external',
      oscTargetInput: '127.0.0.1:1111',
    })
  })

  it('retains a previously prepared selection and its mode if the pending card is removed', async () => {
    await openProject('/a')
    const late = deferred<PreflightResult>()
    vi.mocked(commands.preflightProject).mockReturnValueOnce(late.promise)
    const second = openProject('/b')
    useProjectStore.getState().removeRecentProject('/b')
    late.resolve({ status: 'ok', data: b })
    await second
    expect(useProjectStore.getState()).toMatchObject({
      currentProject: { path: '/a', manifest: a },
      preflightStatus: 'ready',
      pendingPreflightPath: null,
    })
    expect(useSessionStore.getState()).toMatchObject({
      audioMode: 'external',
      oscTargetInput: '127.0.0.1:1111',
    })
    expect(canStartNow()).toBe(true)
  })

  it('treats a rejected LAN enumeration as best-effort without stranding the pending request', async () => {
    useSessionStore.getState().setLanIp('192.168.1.20')
    vi.mocked(commands.listLanAddresses).mockRejectedValueOnce(
      new Error('LAN IPC unavailable')
    )
    await openProject('/b')
    expect(useProjectStore.getState()).toMatchObject({
      currentProject: { path: '/b', manifest: b },
      preflightStatus: 'ready',
      pendingPreflightPath: null,
    })
    expect(useSessionStore.getState()).toMatchObject({
      audioMode: 'none',
      oscTargetInput: '127.0.0.1:2222',
      lanIp: '192.168.1.20',
    })
    expect(logger.warn).toHaveBeenCalledOnce()
  })
})
