import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { act, cleanup, render, screen, waitFor } from '@/test/test-utils'
import {
  commands,
  type AppPreferences,
  type Manifest,
} from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import App from './App'

const BUNDLE = '/downloads/score.pnds'
const INSTALLED = '/bundles/score-1.0.0'
const manifest: Manifest = {
  schemaVersion: 1,
  id: 'score',
  name: 'Cold-start score',
  version: '1.0.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'none',
    supportedModes: ['none'],
    synthdefs: [],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

let preferences: AppPreferences
let pending: string[]

beforeEach(() => {
  vi.clearAllMocks()
  useProjectStore.setState(useProjectStore.getInitialState())
  useCreationStore.setState(useCreationStore.getInitialState())
  useSessionStore.setState(useSessionStore.getInitialState())
  preferences = {
    theme: 'system',
    language: 'en',
    recentProjects: ['/existing'],
    projectManifestNames: { '/existing': 'Existing score' },
  }
  pending = [BUNDLE]
  vi.mocked(listen).mockResolvedValue(() => undefined)
  vi.mocked(commands.loadPreferences).mockImplementation(async () => ({
    status: 'ok',
    data: preferences,
  }))
  vi.mocked(commands.savePreferences).mockImplementation(async next => {
    preferences = next
    return { status: 'ok', data: null }
  })
  vi.mocked(commands.builtinUtilities).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  vi.mocked(commands.takePendingBundleOpens).mockImplementation(async () => {
    const paths = pending
    pending = []
    return { status: 'ok', data: paths }
  })
  vi.mocked(commands.installBundle).mockResolvedValue({
    status: 'ok',
    data: INSTALLED,
  })
  vi.mocked(commands.preflightProject).mockResolvedValue({
    status: 'ok',
    data: manifest,
  })
})

afterEach(async () => {
  cleanup()
  await new Promise(resolve => setTimeout(resolve, 0))
})

describe('cold-start document opens', () => {
  it('restores the Library before importing and selecting without loading, including effect replay', async () => {
    const ready = deferred<undefined>()
    vi.mocked(commands.loadPreferences).mockImplementation(async () => {
      await ready.promise
      return { status: 'ok', data: preferences }
    })
    render(
      <StrictMode>
        <App />
      </StrictMode>
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(commands.takePendingBundleOpens).not.toHaveBeenCalled()
    expect(commands.installBundle).not.toHaveBeenCalled()

    await act(async () => ready.resolve(undefined))
    await waitFor(() => {
      expect(useProjectStore.getState().currentProject?.path).toBe(INSTALLED)
      expect(preferences.recentProjects).toEqual(['/existing', INSTALLED])
    })
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      '/existing',
      INSTALLED,
    ])
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(useProjectStore.getState().manifestProjectNames).toMatchObject({
      '/existing': 'Existing score',
      [INSTALLED]: manifest.name,
    })
    expect(useCreationStore.getState().active).toBe(false)
    expect(useSessionStore.getState().sessionStatus).toBe('idle')
    expect(commands.installBundle).toHaveBeenCalledTimes(1)
    expect(commands.preflightProject).toHaveBeenCalledWith(INSTALLED)
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.startCreationProject).not.toHaveBeenCalled()
    expect(screen.getByTestId('current-project-card')).toHaveAttribute(
      'data-selected-card'
    )
  })

  it('waits for the actual document listener registration before its initial drain', async () => {
    const registered = deferred<() => void>()
    vi.mocked(listen).mockImplementation(event =>
      event === 'open-bundle-event'
        ? registered.promise
        : Promise.resolve(() => undefined)
    )
    render(<App />)

    await waitFor(() =>
      expect(listen).toHaveBeenCalledWith(
        'open-bundle-event',
        expect.any(Function)
      )
    )
    expect(commands.takePendingBundleOpens).not.toHaveBeenCalled()
    await act(async () => registered.resolve(() => undefined))
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe(INSTALLED)
    )
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('does not import after unmount while the Library is still restoring', async () => {
    const ready = deferred<undefined>()
    vi.mocked(commands.loadPreferences).mockImplementation(async () => {
      await ready.promise
      return { status: 'ok', data: preferences }
    })
    const view = render(<App />)
    view.unmount()
    await act(async () => ready.resolve(undefined))

    expect(commands.installBundle).not.toHaveBeenCalled()
    expect(useProjectStore.getState().recentProjectPaths).toEqual([])
  })

  it('keeps requests queued until the built-in Library entries are restored', async () => {
    const utilities =
      deferred<Awaited<ReturnType<typeof commands.builtinUtilities>>>()
    vi.mocked(commands.builtinUtilities).mockReturnValue(utilities.promise)
    render(<App />)

    await waitFor(() => expect(commands.builtinUtilities).toHaveBeenCalled())
    expect(commands.takePendingBundleOpens).not.toHaveBeenCalled()
    await act(async () => utilities.resolve({ status: 'ok', data: [] }))
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe(INSTALLED)
    )
  })

  it('still imports and selects when built-in Library setup rejects', async () => {
    vi.mocked(commands.builtinUtilities).mockRejectedValueOnce(
      new Error('IPC unavailable')
    )
    render(<App />)

    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe(INSTALLED)
    )
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      '/existing',
      INSTALLED,
    ])
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('cleans up a listener that registers after unmount without draining', async () => {
    const registered = deferred<() => void>()
    const off = vi.fn()
    vi.mocked(listen).mockImplementation(event =>
      event === 'open-bundle-event'
        ? registered.promise
        : Promise.resolve(() => undefined)
    )
    const view = render(<App />)
    await waitFor(() =>
      expect(listen).toHaveBeenCalledWith(
        'open-bundle-event',
        expect.any(Function)
      )
    )
    view.unmount()
    await act(async () => registered.resolve(off))

    expect(off).toHaveBeenCalledTimes(1)
    expect(commands.takePendingBundleOpens).not.toHaveBeenCalled()
    expect(commands.installBundle).not.toHaveBeenCalled()
  })

  it('reveals an already installed bundle in its existing folder without duplicating it', async () => {
    preferences.recentProjects = ['/existing', INSTALLED]
    preferences.projectFolders = [
      { id: 'set', name: 'My set', projectPaths: [INSTALLED] },
    ]
    render(<App />)

    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe(INSTALLED)
    )
    expect(useProjectStore.getState().activeFolderId).toBe('set')
    expect(screen.getByTestId('current-project-card')).toHaveAttribute(
      'data-selected-card'
    )
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      '/existing',
      INSTALLED,
    ])
    expect(useProjectStore.getState().projectFolders).toEqual(
      preferences.projectFolders
    )
    expect(commands.startProject).not.toHaveBeenCalled()
  })
})
