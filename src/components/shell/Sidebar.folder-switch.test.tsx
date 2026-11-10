import { usePerformanceRoleStore } from '@/store/performance-role-store'
import {
  act,
  fireEvent,
  render,
  screen,
  selectFolderInPicker,
  waitFor,
  within,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { useSettingsStore } from '@/store/settings-store'
import { Sidebar } from './Sidebar'
import { MonitorHarness as MonitorView } from '@/test/desktop-harness'

beforeEach(() => {
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
})

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  useSessionStore.getState().resetSession()
  useCreationStore.setState({ active: false, modePhase: 'idle' })
  useProjectStore.setState({
    currentProject: null,
    recentProjectPaths: ['/one', '/two', '/tool'],
    utilityPaths: ['/tool'],
    activeFolderId: null,
    lastUserFolderId: null,
    renameTarget: null,
    pendingPreflightPath: null,
    projectFolders: [
      { id: 'a', name: 'Opening', projectPaths: ['/one'] },
      { id: 'b', name: 'Finale', projectPaths: ['/two'] },
      { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: ['/tool'] },
    ],
  })
})
afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('folder tab integration (#153)', () => {
  it('offers Home, every custom folder and Utilities in the same tablist', () => {
    useProjectStore.getState().restoreProjectIndex(
      [],
      Array.from({ length: 40 }, (_, i) => ({
        id: `f${i}`,
        name: `Set ${i}`,
        projectPaths: [],
      }))
    )
    render(<Sidebar variant="static" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(42) // Home, 40 folders, Utilities.
    expect(screen.getByRole('tablist')).toContainElement(
      screen.getByRole('tab', { name: 'Set 39' })
    )
    expect(tabs[0]).toHaveAccessibleName('Home')
    expect(tabs.at(-1)).toHaveAccessibleName('Utilities')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('folder and tools browsing keep the applied monitor and pending audio untouched', async () => {
    const manifest: Manifest = {
      schemaVersion: 1,
      id: 'opening',
      name: 'Opening',
      version: '1.0.0',
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
        synthdefs: [],
        scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
        standaloneTarget: null,
      },
    }
    useProjectStore.setState({
      currentProject: { path: '/one', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/one',
      sessionLanIp: '192.168.1.10',
      audioMode: 'external',
      oscTargetInput: '192.168.1.20:3333',
      pendingChanges: true,
      health: {
        status: 'ready',
        projectId: 'opening',
        audioMode: 'internal',
        audio: { status: 'running', target: null, error: null },
        scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
      },
    })
    render(<MonitorView />)
    const frame = screen.getByTitle('Project monitor')
    const address = frame.getAttribute('src')
    fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
    await selectFolderInPicker('Finale')
    await selectFolderInPicker('Utilities')
    await selectFolderInPicker('Finale')
    expect(screen.getByTitle('Project monitor')).toBe(frame)
    expect(frame).toHaveAttribute('src', address)
    expect(useSessionStore.getState()).toMatchObject({
      sessionProjectPath: '/one',
      pendingChanges: true,
      audioMode: 'external',
      oscTargetInput: '192.168.1.20:3333',
    })
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.setMasterVolume).not.toHaveBeenCalled()
  })

  it('folder tabs retain the user view behind Utilities', async () => {
    render(<Sidebar variant="static" />)
    await selectFolderInPicker('Finale')
    await selectFolderInPicker('Utilities')
    expect(useProjectStore.getState().activeFolderId).toBe(UTILITIES_FOLDER_ID)
    expect(useProjectStore.getState().lastUserFolderId).toBe('b')
    await selectFolderInPicker('Finale')
    expect(useProjectStore.getState().activeFolderId).toBe('b')
  })

  it('returns keyboard focus to a usable folder tab after canceling or confirming deletion', async () => {
    const user = userEvent.setup()
    render(<Sidebar variant="static" />)
    const home = screen.getByRole('tab', { name: 'Home' })
    const finale = screen.getByRole('tab', { name: 'Finale' })
    act(() => finale.focus())
    await user.keyboard('{ContextMenu}')
    await user.click(
      within(await screen.findByRole('menu')).getByTestId('menu-delete-folder')
    )
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(finale).toHaveFocus())

    await user.keyboard('{ContextMenu}')
    await user.click(
      within(await screen.findByRole('menu')).getByTestId('menu-delete-folder')
    )
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(home).toHaveFocus())
    expect(screen.getByRole('tab', { name: 'Home' })).toBe(home)
    expect(
      screen.queryByRole('tab', { name: 'Finale' })
    ).not.toBeInTheDocument()
    expect(useProjectStore.getState().activeFolderId).toBeNull()
  })

  it('localizes Home and Utilities tabs while keeping custom names', async () => {
    useProjectStore.getState().setActiveFolderId('a')
    await i18n.changeLanguage('zh-CN')
    render(<Sidebar variant="static" />)
    await selectFolderInPicker('工具')
    expect(screen.getByRole('tab', { name: '主页' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Opening' })).toBeInTheDocument()
    await selectFolderInPicker('Opening')
    expect(screen.getByRole('heading', { name: 'Opening' })).toBeVisible()
    expect(useProjectStore.getState().projectFolders.at(-1)?.name).toBe(
      'Utilities'
    )
  })

  it.each(['pond', 'sand', 'stage', 'brutal'] as const)(
    'keeps folder controls accessible in %s',
    theme => {
      useSettingsStore.setState({ colorThemeSetting: theme })
      render(<Sidebar variant="static" />)
      expect(screen.getByRole('tab', { name: 'Home' })).toBeEnabled()
      expect(screen.getByRole('tab', { name: 'Utilities' })).toBeEnabled()
      expect(screen.getByTestId('project-list-scroll')).not.toContainElement(
        screen.getByTestId('folder-switch')
      )
    }
  )
})
