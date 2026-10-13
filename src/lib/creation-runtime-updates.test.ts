import { beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { refreshMonitorFromDisk } from './creation-runtime-updates'
import { registerCreationParticipant } from './creation-lifecycle'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'pages',
        root: '/pages',
        name: 'Pages',
        source: 'folder',
      },
      files: [],
    },
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/pages',
    monitorReloadNonce: 0,
    monitorLoaded: true,
  })
})

it('refreshes saved pages through the existing reveal gate without saving drafts or restarting processes', async () => {
  useCreationFilesStore.getState().changed(['public/index.html', 'server.js'])
  await refreshMonitorFromDisk()
  expect(useSessionStore.getState().monitorLoaded).toBe(false)
  expect(useSessionStore.getState().monitorReloadNonce).toBe(1)
  expect(useCreationFilesStore.getState().pending.refresh).toBeGreaterThan(0)
  useSessionStore.getState().markMonitorLoaded()
  expect(useCreationFilesStore.getState().pending.refresh).toBe(0)
  expect(useCreationFilesStore.getState().pending.restart).toBeGreaterThan(0)
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('retains page changes arriving during navigation and rejects an old navigation after a project switch', async () => {
  useCreationFilesStore.getState().changed(['public/index.html'])
  await refreshMonitorFromDisk()
  useCreationFilesStore.getState().changed(['public/page.js'])
  useSessionStore.getState().markMonitorLoaded()
  expect(useCreationFilesStore.getState().pending.refresh).toBeGreaterThan(0)
  await refreshMonitorFromDisk()
  const previous = useCreationStore.getState().workspace
  if (!previous) throw new Error('Expected creation workspace')
  useCreationStore.setState({
    workspace: {
      ...previous,
      project: { ...previous.project, identity: 'next' },
    },
  })
  useCreationFilesStore.getState().changed(['public/new.html'])
  useSessionStore.getState().markMonitorLoaded()
  expect(useCreationFilesStore.getState().pending.refresh).toBeGreaterThan(0)
})

it('attempts all registered test pages and retains refresh prompts when any page fails', async () => {
  useCreationFilesStore.getState().changed(['public/index.html'])
  const failed = vi.fn().mockRejectedValue(new Error('client 1 failed'))
  const second = vi.fn().mockResolvedValue(undefined)
  const offFirst = registerCreationParticipant({ refreshPages: failed })
  const offSecond = registerCreationParticipant({ refreshPages: second })
  try {
    await expect(refreshMonitorFromDisk()).rejects.toThrow('client 1 failed')
    expect(second).toHaveBeenCalledWith({
      identity: 'pages',
      runId: useSessionStore.getState().runId,
      nonce: 1,
    })
    useSessionStore.getState().markMonitorLoaded()
    expect(useCreationFilesStore.getState().pending.refresh).toBeGreaterThan(0)
  } finally {
    offFirst()
    offSecond()
  }
})
