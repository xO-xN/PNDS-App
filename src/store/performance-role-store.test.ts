import { beforeEach, expect, it, vi } from 'vitest'
import { commands, type AppPreferences } from '@/lib/tauri-bindings'
import { updatePreferences } from '@/lib/preferences'
import { usePerformanceRoleStore } from './performance-role-store'

let disk: AppPreferences

beforeEach(() => {
  vi.clearAllMocks()
  usePerformanceRoleStore.setState(usePerformanceRoleStore.getInitialState())
  disk = {
    theme: 'system',
    colorTheme: 'pond',
    language: 'en',
    lastPerformanceRole: 'host',
    nodeName: 'Stage Mac',
    recentProjects: ['/score'],
  }
  vi.mocked(commands.loadPreferences)
    .mockReset()
    .mockImplementation(async () => ({
      status: 'ok',
      data: { ...disk },
    }))
  vi.mocked(commands.savePreferences)
    .mockReset()
    .mockImplementation(async preferences => {
      disk = { ...preferences }
      return { status: 'ok', data: null }
    })
})

it.each([undefined, null, 'host', 'unknown', 'HOST', true, { role: 'client' }])(
  'restores Host for a missing or invalid saved role: %j',
  saved => {
    usePerformanceRoleStore.getState().restoreRolePreference(saved)
    expect(usePerformanceRoleStore.getState()).toMatchObject({
      role: 'host',
      lastRole: 'host',
      preferencesRestored: true,
    })
    expect(commands.savePreferences).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  }
)

it('restores Client as presentation only, without creating a connection or saving a new choice', () => {
  usePerformanceRoleStore.getState().restoreRolePreference('client')
  expect(usePerformanceRoleStore.getState()).toMatchObject({
    role: 'client',
    lastRole: 'client',
    preferencesRestored: true,
  })
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  expect(commands.refreshClientPerformance).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.savePreferences).not.toHaveBeenCalled()
})

it.each(['host', 'client'] as const)(
  'keeps the current native %s role when its saved preference arrives later',
  role => {
    usePerformanceRoleStore.getState().selectRole(role)
    usePerformanceRoleStore
      .getState()
      .restoreRolePreference(role === 'host' ? 'client' : 'host')
    expect(usePerformanceRoleStore.getState().role).toBe(role)
    expect(commands.savePreferences).not.toHaveBeenCalled()
  }
)

it('ignores a late initial read after an explicit selection and hydrates only once', async () => {
  const saved = usePerformanceRoleStore.getState().commitRole('client')
  expect(usePerformanceRoleStore.getState()).toMatchObject({
    role: 'client',
    lastRole: 'client',
    preferencesRestored: true,
  })
  usePerformanceRoleStore.getState().restoreRolePreference('host')
  await expect(saved).resolves.toBe(true)
  expect(usePerformanceRoleStore.getState().lastRole).toBe('client')
  expect(disk.lastPerformanceRole).toBe('client')
})

it('remembers a choice while Creation is active and restores it on returning to Performance', () => {
  usePerformanceRoleStore.getState().restoreRolePreference('client', false)
  expect(usePerformanceRoleStore.getState().role).toBeNull()
  expect(usePerformanceRoleStore.getState().lastRole).toBe('client')
  usePerformanceRoleStore.getState().enterPerformance()
  expect(usePerformanceRoleStore.getState().role).toBe('client')
  usePerformanceRoleStore.getState().resetRole()
  expect(usePerformanceRoleStore.getState()).toMatchObject({
    role: null,
    lastRole: 'client',
    preferencesRestored: true,
    roleMenuOpen: false,
    roleSwitchPending: false,
  })
  usePerformanceRoleStore.getState().enterPerformance()
  expect(usePerformanceRoleStore.getState().role).toBe('client')
  expect(commands.savePreferences).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('waits for the saved role after a Creation round trip during initial loading', () => {
  usePerformanceRoleStore.getState().resetRole()
  usePerformanceRoleStore.getState().enterPerformance()
  expect(usePerformanceRoleStore.getState().role).toBeNull()
  usePerformanceRoleStore.getState().restoreRolePreference('client')
  expect(usePerformanceRoleStore.getState()).toMatchObject({
    role: 'client',
    lastRole: 'client',
    preferencesRestored: true,
  })
  expect(commands.savePreferences).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('serializes role choices with other preference writes and persists the final choice', async () => {
  const first = usePerformanceRoleStore.getState().commitRole('client')
  const settings = updatePreferences({ language: 'zh-CN', sampleRate: 96000 })
  const second = usePerformanceRoleStore.getState().commitRole('host')
  expect(usePerformanceRoleStore.getState().role).toBe('host')
  await expect(Promise.all([first, settings, second])).resolves.toEqual([
    true,
    true,
    true,
  ])
  expect(disk).toMatchObject({
    lastPerformanceRole: 'host',
    language: 'zh-CN',
    sampleRate: 96000,
    nodeName: 'Stage Mac',
    recentProjects: ['/score'],
  })
  expect(
    vi
      .mocked(commands.savePreferences)
      .mock.calls.map(([value]) => value.lastPerformanceRole)
  ).toEqual(['client', 'client', 'host'])
})

it.each(['load', 'save'] as const)(
  'keeps the applied role when its %s fails and does not smuggle the failed choice into a later save',
  async failure => {
    if (failure === 'load')
      vi.mocked(commands.loadPreferences).mockResolvedValueOnce({
        status: 'error',
        error: 'unreadable',
      })
    else
      vi.mocked(commands.savePreferences).mockResolvedValueOnce({
        status: 'error',
        error: 'disk full',
      })
    await expect(
      usePerformanceRoleStore.getState().commitRole('client')
    ).resolves.toBe(false)
    expect(usePerformanceRoleStore.getState()).toMatchObject({
      role: 'client',
      lastRole: 'client',
      preferencesRestored: true,
    })
    expect(disk.lastPerformanceRole).toBe('host')
    await expect(updatePreferences({ sampleRate: 44100 })).resolves.toBe(true)
    expect(disk).toMatchObject({
      lastPerformanceRole: 'host',
      sampleRate: 44100,
    })
  }
)
