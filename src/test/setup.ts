import '@testing-library/jest-dom'
import { vi } from 'vitest'

// jsdom lacks pointer-capture APIs that Radix Select relies on.
Element.prototype.hasPointerCapture ??= function (this: Element) {
  return false
}
Element.prototype.setPointerCapture ??= function (this: Element) {
  // jsdom has no pointer-capture state; Radix only needs the call to exist.
}
Element.prototype.releasePointerCapture ??= function (this: Element) {
  // jsdom has no pointer-capture state; Radix only needs the call to exist.
}
Element.prototype.scrollIntoView ??= function (this: Element) {
  // jsdom has no scroll layout; Radix only needs the call to exist.
}

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

// vite.config defines __APP_VERSION__ for the app build; provide one here
// so components under test can render it.
;(globalThis as Record<string, unknown>).__APP_VERSION__ ??= '0.0.0-test'

// Mock Tauri APIs for tests
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {
    // Mock unlisten function
  }),
}))

// v1.2.0 (issue #16): window-level drag-and-drop wiring in App.tsx — no
// native drop events in jsdom; tests that exercise routing use the
// handleDroppedPaths unit tests instead.
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {
      // Mock unlisten function
    }),
  })),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}))

// v1.2.0 (issue #16): folder picker (developer pack browse) and clipboard
// copies (sha256/path) — cancelled / no-op by default; tests override.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}))

// v1.2.0: frontend logger forwards to the log plugin — keep tests IPC-free
vi.mock('@tauri-apps/plugin-log', () => ({
  trace: vi.fn().mockResolvedValue(undefined),
  debug: vi.fn().mockResolvedValue(undefined),
  info: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
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
        devices: [
          { name: 'Mac mini Speakers', isDefault: true, maxOutputChannels: 2 },
          { name: 'BlackHole 16ch', isDefault: false, maxOutputChannels: 16 },
          { name: 'BlackHole 2ch', isDefault: false, maxOutputChannels: 2 },
        ],
        sampleRate: 48000,
      },
    }),
    setMasterVolume: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    getWindowState: vi.fn().mockResolvedValue({
      status: 'ok',
      data: { fullscreen: false, showCustomTrafficLights: true, generation: 0 },
    }),
    toggleFullscreen: vi.fn().mockResolvedValue({
      status: 'ok',
      data: { fullscreen: true, showCustomTrafficLights: false, generation: 1 },
    }),
    closeWindowWithFade: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: null }),
    fadeInWindow: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    markQuitting: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    quitApp: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    // Default: no built-in tools installed (Utilities seeding is a no-op;
    // tests that exercise it override this mock).
    syncBuiltinTools: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
    // v1.2.0 (issue #13): Settings About section reveal buttons
    openAppDataDir: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    openAppLogDir: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    // v1.2.0 (issue #14): port occupancy — default: both ports free.
    checkPortStatus: vi.fn().mockImplementation((port: number) =>
      Promise.resolve({
        status: 'ok',
        data: { port, occupant: null },
      })
    ),
    releasePort: vi.fn().mockImplementation((port: number) =>
      Promise.resolve({
        status: 'ok',
        data: { port, occupant: null },
      })
    ),
    // v1.2.0 (issue #16): .pnds bundles — default: pack probe targets a
    // fresh output, no pending opens, picker cancelled, no managed bundle.
    getBundleOutputInfo: vi.fn().mockResolvedValue({
      status: 'ok',
      data: { outputPath: '/tmp/demo-1.0.0.pnds', exists: false },
    }),
    packProjectBundle: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        outputPath: '/tmp/demo-1.0.0.pnds',
        sha256: 'a'.repeat(64),
      },
    }),
    installBundle: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: '/bundles/demo-1.0.0' }),
    reclaimProjectBundle: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: false }),
    takePendingBundleOpens: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: [] }),
    pickProjectOrBundle: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: null }),
    // v1.2.0 (issue #17): SynthDef compile — default: one artifact that
    // satisfies the fixture manifests.
    compileProjectSynthdefs: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        sclangPath: '/Applications/SuperCollider.app/Contents/MacOS/sclang',
        produced: ['demo.scsyndef'],
        verified: ['supercollider/synthdefs/demo.scsyndef'],
      },
    }),
  },
  unwrapResult: vi.fn((result: { status: string; data?: unknown }) => {
    if (result.status === 'ok') return result.data
    throw result
  }),
}))
