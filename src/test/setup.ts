import '@testing-library/jest-dom'
import { vi, afterEach } from 'vitest'

const realSetTimeout = globalThis.setTimeout

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
// jsdom has no Element.scrollTo at all; the sidebar's reveal scroll only
// needs the call to exist (the scroll tests swap in a recorder).
Element.prototype.scrollTo ??= function (this: Element) {
  // no scroll layout in jsdom
}
// CodeMirror measures text ranges. jsdom has no text layout; these stubs
// support workflow tests and do not certify geometry or native IME behavior.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

// Radix modal layers (context menu, dialogs) set `pointer-events: none` on
// document.body while open and restore it on unmount — an abrupt test
// cleanup can leave the style behind and break userEvent in later tests.
// Registered before RTL's cleanup hook, this runs last under Vitest's reverse
// afterEach order. Let Radix's deferred focus teardown finish in this DOM realm.
// Capture the real timer before tests install fake timers; do not advance theirs.
afterEach(async () => {
  document.body.style.pointerEvents = ''
  await new Promise<void>(resolve => realSetTimeout(resolve, 0))
})

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
  emit: vi.fn().mockResolvedValue(undefined),
  emitTo: vi.fn().mockResolvedValue(undefined),
}))

// v1.2.0 (issue #16): window-level drag-and-drop wiring in App.tsx — no
// native drop events in jsdom; tests that exercise routing use the
// handleDroppedPaths unit tests instead. WebviewWindow.getByLabel backs
// App.tsx's projection-existence boot probe (#130) — default: no window.
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {
      // Mock unlisten function
    }),
  })),
  WebviewWindow: Object.assign(vi.fn(), {
    getByLabel: vi.fn().mockResolvedValue(null),
  }),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}))

// v1.2.0 (issue #16): folder picker (developer pack browse) and clipboard
// copies (sha256/path) — cancelled / no-op by default; tests override.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
  // #154: the unsaved-drafts discard gate — default keeps the drafts.
  confirm: vi.fn().mockResolvedValue(false),
  message: vi.fn().mockResolvedValue('Cancel'),
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
vi.mock('@/lib/tauri-bindings', async () => {
  // The generated `events` object routes through the (mocked) event API,
  // so tests keep capturing handlers by event name.
  const { listen, emit } = await import('@tauri-apps/api/event')
  const makeEvent = (name: string) => ({
    listen: (cb: (event: { payload: unknown }) => void) =>
      listen(name, cb as never),
    emit: (payload?: unknown) => emit(name, payload),
  })
  const idleSnapshot = {
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
    projectionStarted: false,
    httpsEntry: { status: 'off', url: null, error: null },
  }
  const idleRuntime = {
    generation: '0',
    projectRoot: null,
    snapshot: idleSnapshot,
  }
  const assistantInventory = vi.fn().mockResolvedValue({
    status: 'ok',
    data: { files: [], fingerprint: 'empty' },
  })
  return {
    events: {
      projectTerminalVisibilityEvent: makeEvent(
        'project-terminal-visibility-event'
      ),
      clientSnapshotEvent: makeEvent('client-snapshot-event'),
      clientViewInputEvent: makeEvent('client-view-input-event'),
      sidebarTrackpadEvent: makeEvent('sidebar-trackpad-event'),
      creationAudioAnalyzerEvent: makeEvent('creation-audio-analyzer-event'),
      creationAudioPreviewDisconnected: makeEvent(
        'creation-audio-preview-disconnected'
      ),
      projectMediaViewEvent: makeEvent('project-media-view-event'),
      helpReadyEvent: makeEvent('help-ready-event'),
      openBundleEvent: makeEvent('open-bundle-event'),
      sessionSnapshotEvent: makeEvent('session-snapshot-event'),
      recordingSnapshotEvent: makeEvent('recording-snapshot-event'),
      setlistExportProgressEvent: makeEvent('setlist-export-progress-event'),
      windowFocusEvent: makeEvent('window-focus-event'),
      modelConfigurationChangedEvent: makeEvent(
        'model-configuration-changed-event'
      ),
      assistantTextEvent: makeEvent('assistant-text-event'),
      windowStateEvent: makeEvent('window-state-event'),
      projectionWindowEvent: makeEvent('projection-window-event'),
      performerDestroyedEvent: makeEvent('performer-destroyed-event'),
      performerVisibilityEvent: makeEvent('performer-visibility-event'),
    },
    commands: {
      getCreationGitMerge: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      getProjectTerminalVisibility: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { revision: 1, visible: true },
      }),
      getProjectTerminalTaskContext: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          projectRoot: '/test-project',
          documentationRoot:
            '/Applications/PNDS.app/Contents/Resources/help/en',
          checkerPath: '/Applications/PNDS.app/Contents/MacOS/pnds',
        },
      }),
      writeProjectTerminalTask: vi.fn().mockResolvedValue({
        status: 'ok',
        data: '/test-project/.pnds-creation/terminal-task-test.md',
      }),
      openProjectTerminal: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'Terminal not mocked' }),
      getProjectTerminal: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      readProjectTerminal: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'Terminal not mocked' }),
      writeProjectTerminal: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      resizeProjectTerminal: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      closeProjectTerminal: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      showCreationConsole: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      toggleCreationConsole: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: true }),
      closeCreationConsole: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      getRecordingState: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          revision: 0,
          operationId: null,
          recordId: null,
          projectPath: null,
          status: 'idle',
          elapsedMs: 0,
          durationMs: null,
          error: null,
          supported: false,
        },
      }),
      listPerformanceRecords: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      beginPerformanceRecording: vi.fn(),
      stopPerformanceRecording: vi.fn(),
      importPerformanceRecord: vi.fn(),
      revealPerformanceRecordings: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      exportPerformanceRecord: vi.fn(),
      deletePerformanceRecord: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      deleteRecordingPass: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      inspectClientHost: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'Host not mocked' }),
      inspectClientNode: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'participation.errors.unavailable', detail: null },
      }),
      getClientLanNodes: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      syncClientLan: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      cancelClientEntry: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          revision: 0,
          phase: 'confirm',
          pageUrl: null,
          host: null,
          activeHost: null,
          address: null,
          expectedHostId: null,
          error: null,
        },
      }),
      joinClientPerformance: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'Host not mocked' }),
      joinClientNode: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'participation.errors.unavailable', detail: null },
      }),
      refreshClientPerformance: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'Host not mocked' }),
      getClientParticipation: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          revision: 0,
          phase: 'idle',
          address: null,
          host: null,
          activeHost: null,
          expectedHostId: null,
          pageUrl: null,
          error: null,
        },
      }),
      syncProjectMediaView: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      closeProjectMediaView: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      postProjectMediaMessage: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      syncClientScoreView: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      leaveClientPerformance: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          revision: 100,
          phase: 'idle',
          address: null,
          host: null,
          activeHost: null,
          expectedHostId: null,
          pageUrl: null,
          error: null,
        },
      }),
      saveCreationAssistantResume: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      loadCreationAssistantResume: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      clearCreationAssistantResume: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      getCreationParameterContract: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      bindCreationParameters: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'invalidProject',
          detail: 'Parameter binding not mocked',
        },
      }),
      authorizeCreationPreview: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'testValidation', detail: 'Preview not mocked' },
      }),
      getCreationLibraries: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'testValidation',
          detail: 'Shared library catalog not mocked',
        },
      }),
      adoptCreationLibrary: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'testValidation',
          detail: 'Shared library adoption not mocked',
        },
      }),
      getCreationModules: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'invalidProject',
          detail: 'getCreationModules not mocked',
        },
      }),
      addCreationModule: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'invalidProject',
          detail: 'addCreationModule not mocked',
        },
      }),
      beginMainPerformanceKeyHandoff: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: 1 }),
      setMainPerformanceKeyOwner: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      setMainControlsVisible: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      startCreationProject: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'invalidProject',
          detail: 'startCreationProject not mocked',
        },
      }),
      getCreationManifest: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'invalidProject',
          detail: 'getCreationManifest not mocked',
        },
      }),
      preflightCreationProject: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'invalidProject',
          detail: 'preflightCreationProject not mocked',
        },
      }),
      closeCreationProjection: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      closeCreationPerformerWindows: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      setCreationPerformerVisibility: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      preparePerformerWindow: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      creationPerformerPinned: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: false }),
      inspectCreationRuntime: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          generation: '0',
          passed: true,
          checks: [],
          performers: null,
          savedChangesVerified: false,
        },
      }),
      getCreationRuntime: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: idleRuntime }),
      commitCreationProject: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: idleRuntime }),
      prepareCreationProject: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'invalidProject',
          detail: 'prepareCreationProject not mocked',
        },
      }),
      openCreationProject: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'invalidProject',
          detail: 'openCreationProject not mocked',
        },
      }),
      getCreationGitTaskPending: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: false }),
      getCreationGitComparison: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          token: 'comparison',
          before: { commit: null, message: null, saved: false },
          after: { commit: null, message: null, saved: true },
          files: [],
        },
      }),
      readCreationGitComparisonFile: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          token: 'comparison',
          path: 'server.js',
          hunks: [],
          added: 0,
          deleted: 0,
          reason: null,
        },
      }),
      renameCreationGitVersion: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: 'Renamed version' }),
      getCreationGitVersions: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          head: null,
          branches: [],
          versions: [],
          nextOffset: null,
          limited: false,
        },
      }),
      readCreationGitVersionFile: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'Version file not mocked' },
      }),
      getCreationGitVersionPaths: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      confirmCreationGitVersion: vi.fn(),
      githubAuthStatus: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { configured: false, account: null, installationUrl: null },
      }),
      githubBeginAuth: vi.fn(),
      githubPollAuth: vi.fn(),
      githubDisconnect: vi.fn(),
      githubListRepositories: vi.fn(),
      githubListBranches: vi.fn(),
      githubSyncStatus: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          supported: true,
          templateBackupEligible: false,
          templateBackupPending: null,
          templateBackupPublished: false,
          templateBackupRecovered: false,
          branch: null,
          head: null,
          origin: null,
          repository: null,
          accountId: null,
          autoBackup: false,
          autoBackupPaused: false,
          firstBackupConfirmed: false,
          pending: false,
          relation: 'unborn',
          remoteHead: null,
          stale: false,
          issue: null,
        },
      }),
      githubNewRepositoryOwners: vi.fn(),
      githubUploadNewProject: vi.fn(),
      githubUploadSavedRoute: vi.fn(),
      githubPrepareInitialUpload: vi.fn(),
      githubConfirmInitialUpload: vi.fn(),
      githubDiscardInitialUpload: vi.fn(),
      githubVerifyTemplateBackup: vi.fn(),
      githubPrepareTemplateBackup: vi.fn(),
      githubPushTemplateBackup: vi.fn(),
      githubBindRepository: vi.fn(),
      githubUnbindRepository: vi.fn(),
      githubSetAutoBackup: vi.fn(),
      githubPreparePush: vi.fn(),
      githubPush: vi.fn(),
      githubUpdate: vi.fn(),
      githubCloneRepository: vi.fn(),
      endCreationGitAssistantTask: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      previewCreationGitSwitch: vi.fn(),
      previewCreationGitBranchSwitch: vi.fn(),
      confirmCreationGitSwitch: vi.fn(),
      getCreationGitHistory: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { head: null, commits: [], limited: false },
      }),
      readCreationGitHistoryFile: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'History not mocked' },
      }),
      loadCreationGitHistoryText: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'History load not mocked' },
      }),
      previewCreationGitRecord: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'previewCreationGitRecord not mocked' },
      }),
      getCreationGitRecordFiles: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'getCreationGitRecordFiles not mocked' },
      }),
      confirmCreationGitRecord: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'confirmCreationGitRecord not mocked' },
      }),
      createBlankProject: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'createBlankProject not mocked' },
      }),
      describeCreationProjects: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      diagnoseCreationProject: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'diagnoseCreationProject not mocked' },
      }),
      creationDiagnosticIsStale: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: false }),
      startCreationCheck: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: 'controlled-check-1' }),
      getCreationCheck: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'getCreationCheck not mocked' },
      }),
      cancelCreationCheck: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      creationCheckIsStale: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: false }),
      getCreationGitStatus: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          state: 'notRepository',
          branch: null,
          head: null,
          changes: [],
          detail: null,
        },
      }),
      readCreationGitDiff: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'readCreationGitDiff not mocked' },
      }),
      listCreationFiles: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      listCreationMaterials: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      getCreationPendingIntegration: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      completeCreationPendingIntegration: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'testValidation',
          detail: 'No fixture integration proof',
        },
      }),
      restoreCreationPendingIntegration: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'missing', detail: 'No fixture integration' },
      }),
      saveCreationPendingDocument: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'storage' }),
      renameCreationPendingDocument: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'storage' }),
      deleteCreationPendingDocument: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'storage' }),
      deleteCreationPendingMedia: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'storage' }),
      revealCreationPendingDocument: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'storage' }),
      dragCreationPendingDocument: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      readCreationPendingDocument: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'missing' }),
      importCreationResource: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'storage' }),
      listCreationPendingMedia: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      startPendingAudioPreview: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'playback' }),
      controlPendingAudioPreview: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'cancelled' }),
      stopPendingAudioPreview: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      readCreationPendingImage: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'missing' }),
      addCreationMaterial: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'storage' }),
      readCreationMaterial: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'missing' }),
      removeCreationMaterial: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: 'storage' }),
      removeCreationAssistantFile: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'removeCreationAssistantFile not mocked' },
      }),
      pollCreationChanges: vi.fn().mockImplementation(async () => {
        const { useCreationStore } = await import('@/store/creation-store')
        return {
          status: 'ok',
          data: {
            files: useCreationStore.getState().workspace?.files ?? [],
            changed: [],
            revision: 0,
          },
        }
      }),
      readCreationFile: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'missing', detail: 'readCreationFile not mocked' },
      }),
      // #154: write commands default to failure — a forgotten mock must
      // never read as a successful save or rename.
      saveCreationFileChange: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'saveCreationFileChange not mocked' },
      }),
      undoCreationFileChange: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'undoCreationFileChange not mocked' },
      }),
      saveCreationFile: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'saveCreationFile not mocked' },
      }),
      createCreationDirectory: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'createCreationDirectory not mocked' },
      }),
      createCreationFile: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'createCreationFile not mocked' },
      }),
      beginHandoffOperation: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: 'operation' }),
      handoffOperationProgress: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          phase: 'reading',
          cancellable: true,
          path: null,
          bytesRead: 0,
          bytesTotal: 0,
          files: 0,
        },
      }),
      cancelHandoffOperation: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          phase: 'cancelled',
          cancellable: false,
          path: null,
          bytesRead: 0,
          bytesTotal: 0,
          files: 0,
        },
      }),
      previewCreationHandoff: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'previewCreationHandoff not mocked' },
      }),
      previewCreationHandoffUpdate: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'io',
          detail: 'previewCreationHandoffUpdate not mocked',
        },
      }),
      confirmCreationHandoff: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'confirmCreationHandoff not mocked' },
      }),
      compareHandoffBaseline: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'compareHandoffBaseline not mocked' },
      }),
      handoffComparisonIsStale: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: false }),
      listHandoffBaselines: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { baselines: [], usedBytes: 0, limitBytes: 268435456 },
      }),
      retryHandoffBaseline: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'retryHandoffBaseline not mocked' },
      }),
      deleteHandoffBaseline: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'deleteHandoffBaseline not mocked' },
      }),
      readCreationHandoff: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: { text: '', version: null } }),
      appendCreationHandoff: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'appendCreationHandoff not mocked' },
      }),
      renameCreationFile: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'io', detail: 'renameCreationFile not mocked' },
      }),
      dragCreationFile: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      previewCreationGitRestore: vi.fn(),
      confirmCreationGitRestore: vi.fn(),
      openCreationScd: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      revealCreationPath: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      closeCreationProject: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      loadPreferences: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: { theme: 'system' } }),
      savePreferences: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      getModelCredentialStatus: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: { hasKey: false } }),
      listCreationAssistantTasks: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      getCreationAssistantQuestions: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      askCreationAssistantQuestion: vi.fn(),
      answerCreationAssistantQuestion: vi.fn(),
      cancelCreationAssistantQuestion: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      getCreationAssistantResourcePlans: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      proposeCreationAssistantResources: vi
        .fn()
        .mockImplementation((_identity, taskId) =>
          Promise.resolve({
            status: 'ok',
            data: { id: taskId, mode: 'edit', files: [] },
          })
        ),
      decideCreationAssistantResources: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'testValidation',
          detail: 'Resource decision not mocked',
        },
      }),
      adoptCreationAssistantModule: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'testValidation',
          detail: 'Module adoption not mocked',
        },
      }),
      beginCreationAssistantTask: vi
        .fn()
        .mockImplementation((_identity, mode) =>
          Promise.resolve({
            status: 'ok',
            data: { id: 'task-test', mode, files: [] },
          })
        ),
      endCreationAssistantTask: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      getAssistantBuildState: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { needed: false, reason: null, receipt: null },
      }),
      compileAssistantSynthdefs: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'testValidation', detail: 'No compilation fixture' },
      }),
      cancelAssistantOperation: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      writeCreationAssistantFile: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'testValidation', detail: 'No write fixture' },
      }),
      createCreationAssistantDirectory: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'testValidation', detail: 'No directory fixture' },
      }),
      adoptCreationAssistantMaterial: vi.fn().mockResolvedValue({
        status: 'error',
        error: {
          code: 'testValidation',
          detail: 'No material adoption fixture',
        },
      }),
      adoptCreationAssistantLibrary: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'testValidation', detail: 'No library fixture' },
      }),
      undoCreationAssistantTask: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'testValidation', detail: 'No undo fixture' },
      }),
      startAssistantCheck: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: 'test-check' }),
      startAssistantTests: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: 'project-tests' }),
      assistantProjectInventory: assistantInventory,
      assistantProjectOverview: vi.fn(async (identity: string) => {
        const result = await assistantInventory(identity)
        return result.status === 'ok'
          ? {
              status: 'ok',
              data: {
                snapshot: result.data,
                manifestStatus: 'unreadable',
                contentPaths: [],
                evidence: [],
              },
            }
          : result
      }),
      assistantProjectRead: vi.fn().mockResolvedValue({
        status: 'error',
        error: { code: 'missing', detail: 'missing' },
      }),
      assistantProjectSearch: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { pages: [], skipped: [], searchedFiles: 0, remainingFiles: 0 },
      }),
      beginAssistantRequest: vi.fn().mockResolvedValue({
        status: 'error',
        error: { type: 'invalidConfig' },
      }),
      assistantModelTurn: vi
        .fn()
        .mockResolvedValue({ status: 'error', error: { type: 'protocol' } }),
      measureAssistantContext: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          characters: 100,
          utf8Bytes: 100,
          estimatedTokens: null,
          admissionEstimate: 100,
          tokenizer: 'unknown',
          capacity: null,
          effectiveInput: null,
          outputReserve: 4096,
          safetyMargin: 256,
          parts: [],
          exceeded: null,
        },
      }),
      cancelAssistantRequest: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      loadAssistantHistory: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          epoch: 'history-initial',
          projectKey: 'a'.repeat(64),
          appVersion: '0.0.0-test',
          messages: [],
        },
      }),
      saveAssistantHistory: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      clearAssistantHistory: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          epoch: 'history-cleared',
          projectKey: 'a'.repeat(64),
          appVersion: '0.0.0-test',
          messages: [],
        },
      }),
      saveModelCredential: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      removeModelCredential: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      testModelConnection: vi.fn().mockResolvedValue({
        status: 'error',
        error: { type: 'protocol' },
      }),
      // #139: HTTPS certificate material — load/clear default to the
      // quiet states (nothing stored); the import default fails loudly
      // (a forgotten mock must not read as a successful import).
      loadHttpsCertificate: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      importHttpsCertificate: vi.fn().mockResolvedValue({
        status: 'error',
        error: 'importHttpsCertificate not mocked',
      }),
      clearHttpsCertificate: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: false }),
      // #174: DNS service — status defaults to "not registered and the
      // daemon is down"; enable defaults to failure (a forgotten mock
      // must not read as a successful registration).
      dnsServiceStatus: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          registration: 'notRegistered',
          daemon: false,
          plistPresent: false,
          listeners: null,
          upstreams: [],
          mapping: null,
          knownDomains: [],
          stats: null,
        },
      }),
      dnsServiceEnable: vi.fn().mockResolvedValue({
        status: 'error',
        error: 'dnsServiceEnable not mocked',
      }),
      dnsServiceDisable: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      // #174: pushing config to a running daemon — quiet ok by default
      // (a down daemon is a normal, warn-logged fact in the component).
      dnsServiceApplyConfig: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      dnsServiceOpenSystemSettings: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      sendNativeNotification: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      preflightProject: vi.fn().mockResolvedValue({
        status: 'error',
        error: 'preflightProject not mocked',
      }),
      // v1.5.0 (#125): project README — default: none (the empty state);
      // routing tests override this with fixture markdown.
      readProjectReadme: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      // v1.5.0 (README cover page): the band's cover image — default:
      // none (the band renders text-only).
      readProjectCover: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      cleanupOrphanedProcesses: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: 0 }),
      startProject: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      stopProject: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      stopProjectGeneration: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: true }),
      syncHostEntry: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          status: 'unbound',
          url: null,
          error: null,
          portChanged: false,
        },
      }),
      getHostEntryQr: vi.fn().mockResolvedValue({
        status: 'ok',
        data: 'data:image/png;base64,ZW50cnk=',
      }),
      getCreationPerformerQr: vi.fn().mockResolvedValue({
        status: 'ok',
        data: 'data:image/png;base64,dGVzdA==',
      }),
      getHostEntry: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          status: 'unbound',
          url: null,
          error: null,
          portChanged: false,
        },
      }),
      getSessionState: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: idleSnapshot }),
      setCreationAudioAnalyzer: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      getCreationAudioStats: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      // v1.5.0 (#130): the projection start gate — default: no-op ok.
      toggleProjectionStart: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      togglePerformerQr: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      hidePerformerQr: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      listLanAddresses: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: ['192.168.1.10'] }),
      getDesktopDeviceStatus: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { audio: 'unknown', network: 'unknown' },
      }),
      getLanInterfaceKinds: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: {} }),
      listOutputDevices: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          devices: [
            {
              name: 'Mac mini Speakers',
              isDefault: true,
              maxOutputChannels: 2,
            },
            { name: 'BlackHole 16ch', isDefault: false, maxOutputChannels: 16 },
            { name: 'BlackHole 2ch', isDefault: false, maxOutputChannels: 2 },
          ],
          sampleRate: 48000,
        },
      }),
      setMasterVolume: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      // Issue #21: Settings Audio section — default: the fixed fallback list
      // (the backend only errors at the transport level; its own enumeration
      // failure already degrades to this list).
      listSupportedSampleRates: vi
        .fn()
        .mockResolvedValue([44100, 48000, 88200, 96000]),
      getWindowState: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          fullscreen: false,
          showCustomTrafficLights: true,
          generation: 0,
        },
      }),
      toggleFullscreen: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          fullscreen: true,
          showCustomTrafficLights: false,
          generation: 1,
        },
      }),
      // #41: the default (square=false) keeps windowed corners rounded.
      setWindowCornersSquare: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      closeWindowWithFade: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      fadeInWindow: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      // v1.3.0 (#56): ⌘W dispatch — default: the main window is front.
      focusedWindowLabel: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: 'main' }),
      markQuitting: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      quitApp: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      // Default: no built-in utility staged (Utilities seeding is a no-op;
      // tests that exercise it override this mock).
      builtinUtilities: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      // v1.3.0 (issue #53): help corpus — default: no documents; the help
      // window's tests (T8) override this with fixture documents.
      helpCorpus: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
      // v1.2.0 (issue #13): Settings About section reveal buttons
      openAppDataDir: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      openAppLogDir: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
      // v1.4.2 (#110): WebKit baseline gate — default: a supported
      // Safari, so the gate stays closed in every test that doesn't
      // override it.
      systemSafariVersion: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: '26.6.2' }),
      // v1.2.0 (issue #14): port occupancy — default: both ports free.
      getProjectPorts: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { performerPort: 6868, monitorPort: 6869 },
      }),
      checkPortStatus: vi.fn().mockImplementation((port: number) =>
        Promise.resolve({
          status: 'ok',
          data: {
            port,
            occupant: null,
            managedByApp: false,
            runningProject: null,
          },
        })
      ),
      releasePort: vi.fn().mockImplementation((port: number) =>
        Promise.resolve({
          status: 'ok',
          data: {
            outcome: 'released',
            status: {
              port,
              occupant: null,
              managedByApp: false,
              runningProject: null,
            },
          },
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
      // v1.4.0 (#59): setlist export — default: nothing described (the
      // happy path is per-test), export lands in a scratch directory.
      getSetlistExportInfo: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      exportSetlist: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { outputDir: '/tmp/setlist-export' },
      }),
      // v1.4.0 (#63): setlist import — default: no set.json (routing falls
      // through to the normal open flow; import tests override).
      readSetlist: vi.fn().mockResolvedValue({
        status: 'error',
        error: 'No set.json',
      }),
      takePendingBundleOpens: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: [] }),
      pickProjectOrBundle: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      // #161: trusted creation compile — default report satisfies fixture references.
      compileCreationSynthdefs: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          sclangPath: '/Applications/SuperCollider.app/Contents/MacOS/sclang',
          produced: ['demo.scsyndef'],
          references: [
            {
              path: 'supercollider/synthdefs/demo.scsyndef',
              status: 'verified',
              detail: null,
            },
          ],
          output: 'wrote demo.scsyndef',
          error: null,
        },
      }),
    },
    expectOk: vi.fn(
      (result: { status: string; data?: unknown; error?: unknown }) => {
        if (result.status === 'ok') return result.data
        throw new Error(String(result.error))
      }
    ),
  }
})
