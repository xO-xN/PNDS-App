import {
  fireEvent,
  render,
  screen,
  selectFolderInPicker,
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

describe('folder dropdown integration (#153)', () => {
  it('offers all custom folders in a bounded dropdown, with Utilities outside it', async () => {
    useProjectStore.getState().restoreProjectIndex(
      [],
      Array.from({ length: 40 }, (_, i) => ({
        id: `f${i}`,
        name: `Set ${i}`,
        projectPaths: [],
      }))
    )
    render(<Sidebar variant="static" />)
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    expect(screen.getAllByRole('option')).toHaveLength(42) // Home, 40 folders, New.
    expect(screen.getByRole('listbox')).toHaveClass(
      'max-h-[min(16rem,var(--radix-select-content-available-height))]'
    )
    expect(screen.getByRole('option', { name: 'Set 39' })).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Return to Finale' })
    )
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

  it('folder picking remembers the user view behind Utilities', async () => {
    render(<Sidebar variant="static" />)
    await selectFolderInPicker('Finale')
    await userEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    expect(useProjectStore.getState().activeFolderId).toBe(UTILITIES_FOLDER_ID)
    const back = screen.getByRole('button', { name: 'Return to Finale' })
    await userEvent.click(back)
    expect(useProjectStore.getState().activeFolderId).toBe('b')
  })

  it('localizes the tool and return controls while keeping custom names', async () => {
    useProjectStore.getState().setActiveFolderId('a')
    await i18n.changeLanguage('zh-CN')
    render(<Sidebar variant="static" />)
    await userEvent.click(screen.getByRole('button', { name: '工具' }))
    expect(
      screen.getByRole('button', { name: '返回Opening' })
    ).toBeInTheDocument()
    expect(useProjectStore.getState().projectFolders.at(-1)?.name).toBe(
      'Utilities'
    )
  })

  it.each(['pond', 'sand', 'stage', 'brutal'] as const)(
    'keeps folder controls accessible in %s',
    theme => {
      useSettingsStore.setState({ colorThemeSetting: theme })
      render(<Sidebar variant="static" />)
      expect(
        screen.getByRole('combobox', { name: 'Performance folder' })
      ).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Utilities' })).toBeEnabled()
      expect(screen.getByTestId('project-list-scroll')).not.toContainElement(
        screen.getByTestId('folder-switch')
      )
    }
  )
})
