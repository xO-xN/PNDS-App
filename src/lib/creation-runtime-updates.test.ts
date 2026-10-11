import { beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationChangesStore } from '@/store/creation-changes-store'
import { useSessionStore } from '@/store/session-store'
import { refreshMonitorFromDisk } from './creation-runtime-updates'

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
  useCreationChangesStore.getState().changed(['public/index.html', 'server.js'])
  await refreshMonitorFromDisk()
  expect(useSessionStore.getState().monitorLoaded).toBe(false)
  expect(useSessionStore.getState().monitorReloadNonce).toBe(1)
  expect(useCreationChangesStore.getState().pending.refresh).toBeGreaterThan(0)
  useSessionStore.getState().markMonitorLoaded()
  expect(useCreationChangesStore.getState().pending.refresh).toBe(0)
  expect(useCreationChangesStore.getState().pending.restart).toBeGreaterThan(0)
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('retains page changes arriving during navigation and rejects an old navigation after a project switch', async () => {
  useCreationChangesStore.getState().changed(['public/index.html'])
  await refreshMonitorFromDisk()
  useCreationChangesStore.getState().changed(['public/page.js'])
  useSessionStore.getState().markMonitorLoaded()
  expect(useCreationChangesStore.getState().pending.refresh).toBeGreaterThan(0)
  await refreshMonitorFromDisk()
  const previous = useCreationStore.getState().workspace
  if (!previous) throw new Error('Expected creation workspace')
  useCreationStore.setState({
    workspace: {
      ...previous,
      project: { ...previous.project, identity: 'next' },
    },
  })
  useCreationChangesStore.getState().changed(['public/new.html'])
  useSessionStore.getState().markMonitorLoaded()
  expect(useCreationChangesStore.getState().pending.refresh).toBeGreaterThan(0)
})
