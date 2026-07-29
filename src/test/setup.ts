import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock matchMedia for tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock Tauri APIs for tests
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {
    // Mock unlisten function
  }),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}))

// Mock typed Tauri bindings (tauri-specta generated)
vi.mock('@/lib/tauri-bindings', () => ({
  commands: {
    loadPreferences: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: { theme: 'system' } }),
    savePreferences: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    sendNativeNotification: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: null }),
    preflightProject: vi.fn().mockResolvedValue({
      status: 'error',
      error: 'preflightProject not mocked',
    }),
    cleanupOrphanedProcesses: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: 0 }),
    startProject: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    stopProject: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    getSessionState: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        status: 'idle',
        projectName: null,
        projectPath: null,
        audioMode: null,
        lanIp: null,
        oscTarget: null,
        health: null,
        error: null,
        outputTail: [],
        volume: 80,
      },
    }),
    listLanAddresses: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: ['192.168.1.10'] }),
    listOutputDevices: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        devices: ['Mac mini Speakers', 'BlackHole 16ch', 'BlackHole 2ch'],
        default: 'Mac mini Speakers',
      },
    }),
    setMasterVolume: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
  },
  unwrapResult: vi.fn((result: { status: string; data?: unknown }) => {
    if (result.status === 'ok') return result.data
    throw result
  }),
}))
