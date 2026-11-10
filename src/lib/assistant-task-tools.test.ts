import { beforeEach, expect, it, vi } from 'vitest'
import { commands, type ControlledCheckReport } from './tauri-bindings'
import {
  beginAssistantTask,
  type AssistantTaskRunner,
} from './assistant-task-tools'
import type { AssistantCheckCheckpointV1 } from './assistant-task-checks'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { seedCreationDraft } from '@/test/creation-files'
import { useSessionStore } from '@/store/session-store'
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.pollCreationChanges)
    .mockReset()
    .mockImplementation(async () => ({
      status: 'ok',
      data: {
        files: useCreationStore.getState().workspace?.files ?? [],
        changed: [],
        revision: 0,
      },
    }))
  vi.mocked(commands.diagnoseCreationProject).mockResolvedValue({
    status: 'ok',
    data: {
      schemaVersion: 1,
      checkerVersion: 'test',
      projectPath: '/score',
      project: null,
      inputFingerprint: 'static-v1',
      inputs: [],
      checks: [],
      issues: [],
      unverified: ['runtime'],
      staticPassed: true,
    },
  })
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'owner',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useSessionStore.setState({ sessionStatus: 'idle' })
})

it.each(['public', 'public/Pattern.js'])(
  'preserves a draft at %s before private material adoption reaches native publication',
  async path => {
    seedCreationDraft(path, 'saved', 'v1')
    useCreationFilesStore.getState().edit(path, 'creator draft')
    const runner = await beginAssistantTask(
      'owner',
      'edit',
      undefined,
      new AbortController().signal
    )
    expect(
      JSON.parse(
        await runner.execute('adopt_creation_material', {
          id: 'a'.repeat(32),
          version: 'b'.repeat(64),
          path: 'public/Pattern.js',
        })
      )
    ).toMatchObject({ status: 'refused', reason: 'creatorDraft' })
    expect(commands.adoptCreationAssistantMaterial).not.toHaveBeenCalled()
    expect(useCreationFilesStore.getState().drafts[path]?.text).toBe(
      'creator draft'
    )
    await runner.close()
  }
)

it('reports material collisions without directing the model to bypass native protection', async () => {
  vi.mocked(commands.adoptCreationAssistantMaterial).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'targetExists', detail: 'Preserve existing Grid source' },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const refusal = JSON.parse(
    await runner.execute('adopt_creation_material', {
      id: 'a'.repeat(32),
      version: 'b'.repeat(64),
      path: 'Grid.js',
    })
  )
  expect(refusal).toMatchObject({
    status: 'refused',
    reason: 'targetExists',
    origin: 'native',
  })
  expect(refusal.note).toContain('target is protected in this task')
  expect(refusal.note).not.toContain('use the existing-file tool')
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  await runner.close()
})

it('discards a late material adoption receipt after changing workspace', async () => {
  vi.mocked(commands.adoptCreationAssistantMaterial).mockImplementationOnce(
    async () => {
      useCreationStore.setState({ workspace: null })
      return {
        status: 'ok',
        data: {
          id: 'task-test',
          mode: 'edit',
          files: [{ path: 'Grid.js', created: true, undone: false }],
        },
      }
    }
  )
  const onTask = vi.fn()
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal,
    onTask
  )
  onTask.mockClear()
  expect(
    JSON.parse(
      await runner.execute('adopt_creation_material', {
        id: 'a'.repeat(32),
        version: 'b'.repeat(64),
        path: 'Grid.js',
      })
    )
  ).toMatchObject({ status: 'refused', error: 'cancelled' })
  expect(onTask).not.toHaveBeenCalled()
  expect(commands.pollCreationChanges).not.toHaveBeenCalled()
  await runner.close()
})

it('observes an active runtime without acquiring a second execution lease or claiming saved-code verification', async () => {
  const observe = vi.mocked(commands.inspectCreationRuntime).mockResolvedValue({
    status: 'ok',
    data: {
      generation: '7',
      passed: true,
      checks: [],
      performers: null,
      savedChangesVerified: false,
    },
  })
  useSessionStore.setState({ runId: 7, sessionStatus: 'ready' })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const result = JSON.parse(await runner.execute('run_project_check', {}))
  expect(result).toMatchObject({
    status: 'partial',
    runtime: { kind: 'liveObservation', savedChangesVerified: false },
  })
  expect(observe).toHaveBeenCalledWith('owner', true)
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  expect(runner.checks.checkpoint().lastCheckId).toBeUndefined()
  expect(await restoreCheckEvidence(runner, runner.checks.checkpoint())).toBe(
    false
  )
  await runner.close()
})

it('rejects a late live observation when the workspace is replaced', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.inspectCreationRuntime>>
  ) => void
  vi.mocked(commands.inspectCreationRuntime).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  useSessionStore.setState({ runId: 7, sessionStatus: 'ready' })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const checking = runner.execute('run_project_check', {})
  await vi.waitFor(() =>
    expect(commands.inspectCreationRuntime).toHaveBeenCalled()
  )
  useCreationStore.setState({ workspace: null })
  finish({
    status: 'ok',
    data: {
      generation: '7',
      passed: true,
      checks: [],
      performers: null,
      savedChangesVerified: false,
    },
  })
  await checking
  expect(runner.checks.contextEvidence).toBeUndefined()
  await runner.close()
})

it('synchronizes actual saved paths instead of republishing the cumulative task journal', async () => {
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const cumulative = ['manifest.json', 'public/page.js']
  vi.mocked(commands.writeCreationAssistantFile)
    .mockResolvedValueOnce({
      status: 'ok',
      data: {
        ...runner.task,
        files: [{ path: 'manifest.json', created: false, undone: false }],
      },
    })
    .mockResolvedValue({
      status: 'ok',
      data: {
        ...runner.task,
        files: cumulative.map(path => ({
          path,
          created: false,
          undone: false,
        })),
      },
    })
  const revisions = [{ 'manifest.json': 1 }, { 'public/page.js': 2 }, {}]
  vi.mocked(commands.pollCreationChanges).mockImplementation(async () => {
    const changeRevisions = revisions.shift() ?? {}
    return {
      status: 'ok',
      data: {
        files: [],
        changed: Object.keys(changeRevisions),
        revision: 2,
        changeRevisions,
      },
    }
  })
  await runner.execute('write_project_file', {
    path: 'manifest.json',
    version: 'v1',
    text: '{}',
  })
  const manifest =
    useCreationFilesStore.getState().fileRevisions['manifest.json']
  await runner.execute('write_project_file', {
    path: 'public/page.js',
    version: 'v1',
    text: 'saved',
  })
  expect(useCreationFilesStore.getState().fileRevisions['manifest.json']).toBe(
    manifest
  )
  const revision = useCreationFilesStore.getState().revision
  await runner.execute('write_project_file', {
    path: 'public/page.js',
    version: 'v2',
    text: 'saved',
  })
  expect(useCreationFilesStore.getState().revision).toBe(revision)
  expect(runner.task.files).toHaveLength(2)
  await runner.close()
})

it('reports a successful save separately from pending workspace synchronization', async () => {
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'watcher temporarily unavailable' },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const result = JSON.parse(
    await runner.execute('create_project_file', {
      path: 'new.js',
      text: 'saved',
    })
  )
  expect(result).toMatchObject({
    status: 'saved',
    workspaceSync: 'pending',
    synchronizationNote: expect.stringContaining('do not repeat'),
  })
  expect(commands.writeCreationAssistantFile).toHaveBeenCalledOnce()
  expect(useCreationFilesStore.getState().error?.detail).toBe(
    'watcher temporarily unavailable'
  )
  await runner.close()
})

it('runs static and read-only live diagnostics while a performance is active without a second runtime', async () => {
  vi.mocked(commands.diagnoseCreationProject).mockClear()
  useSessionStore.setState({ sessionStatus: 'ready', runId: 1 })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const first = JSON.parse(await runner.execute('run_project_check', {}))
  expect(first).toMatchObject({
    status: 'partial',
    runtime: { status: 'observed', savedChangesVerified: false },
    static: { staticPassed: true },
  })
  await runner.execute('run_project_check', {})
  expect(commands.diagnoseCreationProject).toHaveBeenCalledTimes(2)
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  expect(runner.checks.requiredBeforeReply).toBe(false)
  await runner.close()
})
it('never sends a native write over unsaved creator content, and keeps handoff scoped to its document', async () => {
  seedCreationDraft('server.js', 'before', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'creator text')
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const result = await runner.execute('write_project_file', {
    path: 'server.js',
    version: 'v1',
    text: 'replace',
  })
  expect(JSON.parse(result)).toMatchObject({
    status: 'refused',
    tool: 'write_project_file',
    reason: 'creatorDraft',
    origin: 'app',
    error: 'creatorDraft',
    note: expect.stringContaining('save or discard'),
  })
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  await runner.close()
  const handoff = await beginAssistantTask(
    'owner',
    'discussion',
    undefined,
    new AbortController().signal
  )
  expect(
    JSON.parse(
      await handoff.execute('write_project_file', {
        path: 'new.js',
        version: null,
        text: 'bad',
      })
    ).status
  ).toBe('refused')
  expect(
    JSON.parse(await handoff.execute('run_project_check', {})).status
  ).toBe('refused')
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  await handoff.close()
})

it('lets the native lease decide after a failed session instead of treating the error display as a running process', async () => {
  useSessionStore.setState({ sessionStatus: 'error' })
  vi.mocked(commands.startAssistantCheck).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'runtimeBusy', detail: 'native owns cleanup' },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  expect(
    JSON.parse(await runner.execute('run_project_check', {}))
  ).toMatchObject({ runtime: { reason: 'runtimeBusy' } })
  expect(commands.startAssistantCheck).toHaveBeenCalledOnce()
  await runner.close()
})

it('retains native runtime occupancy across saved edits instead of acquiring the same busy lease again', async () => {
  vi.mocked(commands.startAssistantCheck).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'runtimeBusy', detail: 'another check' },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  expect(
    JSON.parse(await runner.execute('run_project_check', {}))
  ).toMatchObject({ runtime: { reason: 'runtimeBusy' } })
  await runner.execute('create_project_file', {
    path: 'new.js',
    text: 'let size = 1;',
  })
  const diagnostic = checkReport().diagnostics
  if (!diagnostic) throw new Error('Missing diagnostic fixture')
  vi.mocked(commands.diagnoseCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...diagnostic,
      inputFingerprint: 'changed-static-input',
      staticPassed: false,
    },
  })
  expect(
    JSON.parse(await runner.execute('run_project_check', {}))
  ).toMatchObject({
    runtime: { reason: 'runtimeBusy' },
    static: { inputFingerprint: 'changed-static-input', staticPassed: false },
  })
  expect(commands.diagnoseCreationProject).toHaveBeenCalledTimes(2)
  expect(commands.startAssistantCheck).toHaveBeenCalledOnce()
  await runner.close()
})
it('revokes native task permission on cancellation and cannot perform later writes', async () => {
  const controller = new AbortController()
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    controller.signal
  )
  controller.abort()
  await expect(
    runner.execute('write_project_file', {
      path: 'new.js',
      version: null,
      text: 'bad',
    })
  ).rejects.toThrow('cancelled')
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    'owner',
    'task-test'
  )
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
})

it('reports a late native task identity even when cancellation preceded its admission reply', async () => {
  const controller = new AbortController()
  const known = vi.fn()
  let finish!: () => void
  vi.mocked(commands.beginCreationAssistantTask).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = () =>
          resolve({
            status: 'ok',
            data: { id: 'late-task', mode: 'edit', files: [] },
          })
      })
  )
  const starting = beginAssistantTask(
    'owner',
    'edit',
    undefined,
    controller.signal,
    known
  )
  controller.abort()
  finish()
  await expect(starting).rejects.toThrow('cancelled')
  expect(known).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'late-task' })
  )
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    'owner',
    'late-task'
  )
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
})

it('turns explicit creation into an atomic native no-clobber write without a model version', async () => {
  vi.mocked(commands.writeCreationAssistantFile).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'task-test',
      mode: 'edit',
      files: [{ path: 'public/monitor.html', created: true, undone: false }],
    },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  expect(
    JSON.parse(
      await runner.execute('create_project_file', {
        path: 'public/monitor.html',
        text: '<html></html>',
      })
    ).status
  ).toBe('saved')
  expect(commands.writeCreationAssistantFile).toHaveBeenCalledWith(
    'owner',
    'task-test',
    {
      path: 'public/monitor.html',
      version: null,
      text: '<html></html>',
      edits: null,
    }
  )
  await runner.close()
})

it('exposes verified saved literals as edit controls without rewriting the file', async () => {
  vi.mocked(commands.assistantProjectInventory).mockResolvedValueOnce({
    status: 'ok',
    data: {
      fingerprint: 'saved',
      files: [{ path: 'score.js', version: 'v1', bytes: 16, reason: null }],
    },
  })
  vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: {
      kind: 'text',
      version: 'v1',
      text: 'let size = 3;',
    },
  })
  const request = {
    spec: {
      id: 'size',
      path: 'score.js',
      prefix: 'let size = ',
      suffix: ';',
      kind: 'number' as const,
      limits: {
        min: null,
        max: null,
        step: null,
        maxLength: null,
        options: [],
      },
      preview: 'unsupported' as const,
    },
    current: 3,
    suggestedMin: 1,
    suggestedMax: 10,
  }
  vi.mocked(commands.bindCreationParameters).mockResolvedValueOnce({
    status: 'ok',
    data: {
      parameters: [{ request, value: 3 }],
      partial: false,
      contractVersion: null,
    },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  expect(
    JSON.parse(
      await runner.execute('expose_project_parameters', {
        path: 'score.js',
        version: 'v1',
        parameters: [request],
      })
    ).status
  ).toBe('controlsReady')
  expect(runner.controls?.[0]).toMatchObject({
    taskId: 'task-test',
    sourceText: 'let size = 3;',
    text: 'let size = 3;',
  })
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  await runner.close()
})

it('points a mismatched parameter request at its code source and merges separate publications for that saved file', async () => {
  const parameters = ['width', 'height'].map((id, index) => ({
    spec: {
      id,
      path: 'score.js',
      prefix: `const ${id} = `,
      suffix: ';',
      kind: 'number' as const,
      limits: {
        min: null,
        max: null,
        step: null,
        maxLength: null,
        options: [],
      },
      preview: 'unsupported' as const,
    },
    current: index + 2,
    suggestedMin: 0,
    suggestedMax: 10,
  }))
  vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
    status: 'ok',
    data: {
      fingerprint: 'saved',
      files: [
        { path: 'score.js', version: 'v1', bytes: 36, reason: null },
        {
          path: 'pnds.preview.json',
          version: 'contract-v1',
          bytes: 36,
          reason: null,
        },
      ],
    },
  })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: {
      kind: 'text',
      version: 'v1',
      text: 'const width = 2;\nconst height = 3;',
    },
  })
  vi.mocked(commands.bindCreationParameters).mockImplementation(
    async (_identity, _path, _version, _text, requests) => ({
      status: 'ok',
      data: {
        parameters: requests.map(request => ({
          request,
          value: request.current,
        })),
        contractVersion: null,
        partial: false,
      },
    })
  )
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const wrong = JSON.parse(
    await runner.execute('expose_project_parameters', {
      path: 'pnds.preview.json',
      version: 'contract-v1',
      parameters: [parameters[0]],
    })
  )
  expect(wrong).toMatchObject({
    status: 'refused',
    error: 'parameterSourcePathMismatch',
    sourcePaths: ['score.js'],
  })
  expect(commands.bindCreationParameters).not.toHaveBeenCalled()
  for (const parameter of parameters) {
    expect(
      JSON.parse(
        await runner.execute('expose_project_parameters', {
          path: 'score.js',
          version: 'v1',
          parameters: [parameter],
        })
      ).status
    ).toBe('controlsReady')
  }
  expect(runner.controls?.[0]?.parameters.map(p => p.spec.id)).toEqual([
    'width',
    'height',
  ])
  await runner.close()
})

it('automatically exposes declared saved parameters only for files changed in this edit task', async () => {
  const spec = {
    id: 'size',
    path: 'score.js',
    prefix: 'let size = ',
    suffix: ';',
    kind: 'number' as const,
    limits: { min: 1, max: 10, step: 1, maxLength: null, options: [] },
    preview: 'live' as const,
  }
  const source = {
    kind: 'text' as const,
    version: 'saved-v2',
    text: 'let size = 4;',
  }
  vi.mocked(commands.readCreationFile).mockImplementation(
    async (_identity, path) => ({
      status: 'ok',
      data:
        path === 'pnds.preview.json'
          ? {
              kind: 'text',
              version: 'contract-v1',
              text: JSON.stringify({
                schemaVersion: 1,
                parameters: [
                  spec,
                  { ...spec, id: 'other', path: 'unchanged.js' },
                ],
              }),
            }
          : source,
    })
  )
  vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
    status: 'ok',
    data: {
      fingerprint: 'current',
      files: [
        { path: 'score.js', version: 'saved-v2', bytes: 13, reason: null },
      ],
    },
  })
  vi.mocked(commands.bindCreationParameters).mockResolvedValue({
    status: 'ok',
    data: {
      parameters: [
        {
          request: { spec, current: 4, suggestedMin: 1, suggestedMax: 10 },
          value: 4,
        },
      ],
      partial: false,
      contractVersion: 'contract-v1',
    },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  runner.task = {
    ...runner.task,
    files: [{ path: 'score.js', created: false, undone: false }],
  }
  await runner.prepareControls?.()
  expect(runner.controls).toHaveLength(1)
  expect(runner.controls?.[0]).toMatchObject({
    path: 'score.js',
    version: 'saved-v2',
    taskId: 'task-test',
    text: 'let size = 4;',
  })
  expect(commands.bindCreationParameters).toHaveBeenCalledWith(
    'owner',
    'score.js',
    'saved-v2',
    'let size = 4;',
    [{ spec, current: 4, suggestedMin: 1, suggestedMax: 10 }]
  )
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  await runner.close()
})

function checkReport(): ControlledCheckReport {
  return {
    schemaVersion: 1,
    checkerVersion: 'test',
    taskId: 'check-1',
    projectPath: '/score',
    mode: 'none',
    status: 'failed',
    error: 'ReferenceError: missingStart',
    diagnostics: {
      schemaVersion: 1,
      checkerVersion: 'test',
      projectPath: '/score',
      project: null,
      inputFingerprint: 'static-v1',
      inputs: Array.from({ length: 3000 }, (_, i) => ({
        path: `node_modules/package/file-${i}.js`,
        kind: 'file',
        fingerprint: 'hash',
      })),
      checks: [],
      issues: [
        {
          code: 'syntax',
          severity: 'error',
          field: null,
          path: 'server.js',
          reason: 'missingStart is undefined',
        },
      ],
      unverified: [],
      staticPassed: false,
    },
    evidence: {
      sourceRoot: '/score',
      sourceIdentity: 'inode',
      sharedSourceRoot: null,
      projectSha256: 'saved-v1',
      sharedSha256: null,
      projectFiles: [],
      sharedFiles: [],
      productionDependencies: [],
      installedPackages: [],
      sharedLibraries: [],
      git: { head: null, dirty: null, state: 'none', detail: null },
      changedDuringPreparation: false,
      scope: 'saved',
      notes: [],
    },
    freshness: { stale: false, complete: true, reasons: [] },
    environment: {
      nodeBinary: '/offline/node',
      nodeVersion: null,
      outputDevice: null,
      sampleRate: null,
      channelPlan: null,
      oscTarget: null,
    },
    checks: [
      {
        code: 'runtime',
        status: 'failed',
        reason: 'missingStart is undefined',
      },
    ],
    health: null,
    outputTail: ['server.js:42 missingStart()'],
    cleanup: {
      nodeConfirmed: true,
      audioConfirmed: true,
      temporaryFilesRemoved: true,
      errors: [],
    },
    unverified: ['sound', 'pageRendering'],
  }
}

it('returns a small diagnostic summary, reuses fresh checks, and rechecks when input changes', async () => {
  const report = checkReport()
  vi.mocked(commands.startAssistantCheck).mockResolvedValue({
    status: 'ok',
    data: 'check-1',
  })
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: { taskId: 'check-1', identity: 'owner', progress: null, report },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const first = await runner.execute('run_project_check', {})
  expect(first.length).toBeLessThan(16000)
  expect(first).not.toContain('node_modules/package/file-')
  expect(first).toContain('server.js:42 missingStart()')
  expect(first).toContain('missingStart is undefined')
  expect(first).toContain('saved-v1')
  expect(
    JSON.parse(await runner.execute('run_project_check', {}))
  ).toMatchObject({ reused: true, status: 'failed' })
  expect(commands.startAssistantCheck).toHaveBeenCalledOnce()
  expect(commands.diagnoseCreationProject).toHaveBeenCalledOnce()
  vi.mocked(commands.creationCheckIsStale).mockResolvedValueOnce({
    status: 'ok',
    data: true,
  })
  await runner.execute('run_project_check', {})
  expect(commands.startAssistantCheck).toHaveBeenCalledTimes(2)
  expect(commands.diagnoseCreationProject).toHaveBeenCalledTimes(2)
  vi.mocked(commands.writeCreationAssistantFile).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'task-test',
      mode: 'edit',
      files: [{ path: 'new.js', created: true, undone: false }],
    },
  })
  expect(
    JSON.parse(
      await runner.execute('create_project_file', {
        path: 'new.js',
        text: 'saved',
      })
    ).status
  ).toBe('saved')
  await runner.execute('run_project_check', {})
  expect(commands.startAssistantCheck).toHaveBeenCalledTimes(3)
  expect(commands.diagnoseCreationProject).toHaveBeenCalledTimes(3)
  expect(report.diagnostics?.inputs).toHaveLength(3000)
  await runner.close()
})

it('keeps smoke-check success separate from restoring the original artwork, including reused checks', async () => {
  const report = checkReport()
  report.status = 'passed'
  report.error = null
  report.checks = [
    {
      code: 'browserScripts',
      status: 'passed',
      reason: 'No observed script errors.',
    },
  ]
  vi.mocked(commands.startAssistantCheck).mockResolvedValue({
    status: 'ok',
    data: 'check-1',
  })
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: { taskId: 'check-1', identity: 'owner', progress: null, report },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  for (const reused of [false, true]) {
    const summary = JSON.parse(await runner.execute('run_project_check', {}))
    expect(summary.status).toBe('passed')
    expect(summary.reused ?? false).toBe(reused)
    expect(summary.note).toContain(
      'does not establish fidelity to the original artwork'
    )
    expect(summary.unverified).toContain('pageRendering')
  }
  expect(commands.startAssistantCheck).toHaveBeenCalledOnce()
  await runner.close()
})

it('does not reuse a completed check when native freshness cannot be verified', async () => {
  const report = checkReport()
  vi.mocked(commands.startAssistantCheck).mockResolvedValue({
    status: 'ok',
    data: 'check-1',
  })
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: { taskId: 'check-1', identity: 'owner', progress: null, report },
  })
  vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
    status: 'ok',
    data: false,
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  await runner.execute('run_project_check', {})
  vi.mocked(commands.creationCheckIsStale).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'missing', detail: 'check evidence no longer exists' },
  })
  const result = JSON.parse(await runner.execute('run_project_check', {}))
  expect(result.reused).not.toBe(true)
  expect(commands.startAssistantCheck).toHaveBeenCalledTimes(2)
  expect(commands.diagnoseCreationProject).toHaveBeenCalledTimes(2)
  await runner.close()
})

it('publishes a multi-file control group once and only rebinds sources whose saved bytes or declaration changed', async () => {
  let contractVersion = 'contract-v1'
  const versions = new Map([
    ['a.js', 'a-v1'],
    ['b.js', 'b-v1'],
  ])
  const specs = [...versions.keys()].map(path => ({
    id: path,
    path,
    prefix: 'let size = ',
    suffix: ';',
    kind: 'number' as const,
    preview: 'live' as const,
    limits: { min: 1, max: 10, step: 1, maxLength: null, options: [] },
  }))
  vi.mocked(commands.assistantProjectInventory).mockImplementation(
    async () => ({
      status: 'ok',
      data: {
        fingerprint: 'current',
        files: [...versions].map(([path, version]) => ({
          path,
          version,
          bytes: 13,
          reason: null,
        })),
      },
    })
  )
  vi.mocked(commands.readCreationFile).mockImplementation(
    async (_identity, path) => ({
      status: 'ok',
      data:
        path === 'pnds.preview.json'
          ? {
              kind: 'text',
              version: contractVersion,
              text: JSON.stringify({ schemaVersion: 1, parameters: specs }),
            }
          : {
              kind: 'text',
              version: versions.get(path) ?? 'missing',
              text: 'let size = 4;',
            },
    })
  )
  vi.mocked(commands.bindCreationParameters).mockImplementation(
    async (_identity, _path, _version, _text, parameters) => ({
      status: 'ok',
      data: {
        parameters: parameters.map(request => ({
          request,
          value: request.current,
        })),
        partial: false,
        contractVersion,
      },
    })
  )
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  runner.task = {
    ...runner.task,
    files: specs.map(spec => ({
      path: spec.path,
      created: false,
      undone: false,
    })),
  }
  await runner.prepareControls?.()
  expect(runner.controls).toHaveLength(2)
  expect(commands.assistantProjectInventory).toHaveBeenCalledOnce()
  expect(commands.readCreationFile).toHaveBeenCalledTimes(3)
  expect(commands.bindCreationParameters).toHaveBeenCalledTimes(2)
  vi.mocked(commands.readCreationFile).mockClear()
  vi.mocked(commands.bindCreationParameters).mockClear()
  vi.mocked(commands.assistantProjectInventory).mockClear()
  await runner.prepareControls?.()
  expect(commands.assistantProjectInventory).toHaveBeenCalledOnce()
  expect(commands.readCreationFile).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'pnds.preview.json'
  )
  expect(commands.bindCreationParameters).not.toHaveBeenCalled()
  versions.set('a.js', 'a-v2')
  vi.mocked(commands.readCreationFile).mockClear()
  await runner.prepareControls?.()
  expect(commands.readCreationFile).toHaveBeenCalledTimes(2)
  expect(commands.readCreationFile).toHaveBeenCalledWith('owner', 'a.js')
  expect(commands.bindCreationParameters).toHaveBeenCalledOnce()
  expect(
    runner.controls?.find(control => control.path === 'a.js')?.version
  ).toBe('a-v2')
  contractVersion = 'contract-v2'
  vi.mocked(commands.bindCreationParameters).mockClear()
  await runner.prepareControls?.()
  expect(commands.bindCreationParameters).toHaveBeenCalledTimes(2)
  expect(
    runner.controls?.every(
      control => control.binding?.contractVersion === 'contract-v2'
    )
  ).toBe(true)
  await runner.close()
})

async function restoreCheckEvidence(
  runner: AssistantTaskRunner,
  checkpoint: AssistantCheckCheckpointV1
): Promise<boolean> {
  runner.task = {
    ...runner.task,
    files: [{ path: 'score.js', created: false, undone: false }],
  }
  await runner.checks.restore({
    checkpoint: { needsCheck: false, ...checkpoint },
    restarted: true,
    savedInputsChanged: false,
  })
  return !runner.checks.requiredBeforeReply
}

it('verifies a restored completed check receipt without starting another check', async () => {
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    'task-test',
    new AbortController().signal
  )
  vi.mocked(commands.creationCheckIsStale).mockResolvedValueOnce({
    status: 'ok',
    data: false,
  })
  expect(
    await restoreCheckEvidence(runner, {
      lastCheck: JSON.stringify({ status: 'passed', stale: false }),
      lastCheckId: 'saved-check',
    })
  ).toBe(true)
  expect(commands.creationCheckIsStale).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'saved-check'
  )
  expect(commands.diagnoseCreationProject).not.toHaveBeenCalled()
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  await runner.close()
})

it('rejects missing, malformed and unverifiable restored check receipts', async () => {
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    'task-test',
    new AbortController().signal
  )
  const completed = JSON.stringify({ status: 'passed', stale: false })
  expect(await restoreCheckEvidence(runner, {})).toBe(false)
  expect(await restoreCheckEvidence(runner, { lastCheck: completed })).toBe(
    false
  )
  expect(
    await restoreCheckEvidence(runner, {
      lastCheck: '{}',
      lastCheckId: 'saved-check',
    })
  ).toBe(false)
  expect(commands.creationCheckIsStale).not.toHaveBeenCalled()
  const checkpoint = { lastCheck: completed, lastCheckId: 'saved-check' }
  vi.mocked(commands.creationCheckIsStale).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'missing', detail: 'missing saved report' },
  })
  expect(await restoreCheckEvidence(runner, checkpoint)).toBe(false)
  vi.mocked(commands.creationCheckIsStale).mockResolvedValueOnce({
    status: 'ok',
    data: true,
  })
  expect(await restoreCheckEvidence(runner, checkpoint)).toBe(false)
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  await runner.close()
})

it('preserves a restored runtime blocker only while runtime state and static inputs remain current', async () => {
  useSessionStore.setState({ runId: 7, sessionStatus: 'starting' })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    'task-test',
    new AbortController().signal
  )
  const checkpoint = {
    lastCheck: JSON.stringify({
      status: 'blocked',
      static: { inputFingerprint: 'static-v1' },
      runtime: {
        status: 'blocked',
        reason: 'activeSession',
        key: '7:starting',
      },
    }),
  }
  vi.mocked(commands.creationDiagnosticIsStale).mockResolvedValueOnce({
    status: 'ok',
    data: false,
  })
  expect(await restoreCheckEvidence(runner, checkpoint)).toBe(true)
  expect(commands.creationDiagnosticIsStale).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'static-v1'
  )
  useSessionStore.setState({ runId: 8 })
  expect(await restoreCheckEvidence(runner, checkpoint)).toBe(false)
  expect(commands.creationDiagnosticIsStale).toHaveBeenCalledOnce()
  expect(commands.creationCheckIsStale).not.toHaveBeenCalled()
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  await runner.close()
})

it('rejects a restored blocker when static freshness fails or is unavailable', async () => {
  useSessionStore.setState({ runId: 7, sessionStatus: 'starting' })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    'task-test',
    new AbortController().signal
  )
  const checkpoint = {
    lastCheck: JSON.stringify({
      status: 'blocked',
      static: { inputFingerprint: 'static-v1' },
      runtime: {
        status: 'blocked',
        reason: 'activeSession',
        key: '7:starting',
      },
    }),
  }
  vi.mocked(commands.creationDiagnosticIsStale).mockResolvedValueOnce({
    status: 'ok',
    data: true,
  })
  expect(await restoreCheckEvidence(runner, checkpoint)).toBe(false)
  vi.mocked(commands.creationDiagnosticIsStale).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'invalidIdentity', detail: 'project unavailable' },
  })
  expect(await restoreCheckEvidence(runner, checkpoint)).toBe(false)
  vi.mocked(commands.creationDiagnosticIsStale).mockRejectedValueOnce(
    new Error('IPC unavailable')
  )
  expect(await restoreCheckEvidence(runner, checkpoint)).toBe(false)
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  await runner.close()
})

it('discards freshness results delivered after the restored task was cancelled', async () => {
  const controller = new AbortController()
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    'task-test',
    controller.signal
  )
  let announceStarted!: () => void
  const started = new Promise<void>(resolve => {
    announceStarted = resolve
  })
  let finish!: (result: { status: 'ok'; data: boolean }) => void
  vi.mocked(commands.creationCheckIsStale).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
        announceStarted()
      })
  )
  const pending = restoreCheckEvidence(runner, {
    lastCheck: JSON.stringify({ status: 'passed', stale: false }),
    lastCheckId: 'saved-check',
  })
  const cancelled = expect(pending).rejects.toThrow('cancelled')
  await started
  expect(commands.creationCheckIsStale).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'saved-check'
  )
  controller.abort()
  finish({ status: 'ok', data: false })
  await cancelled
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  await runner.close()
})

it('projects native version conflicts into one structured refusal with targeted repair guidance', async () => {
  vi.mocked(commands.writeCreationAssistantFile).mockResolvedValueOnce({
    status: 'error',
    error: {
      code: 'versionConflict',
      detail: 'Saved bytes changed after the read.',
    },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const result = JSON.parse(
    await runner.execute('write_project_file', {
      path: 'score.js',
      version: 'saved-v1',
      text: 'let size = 2;',
    })
  )
  expect(result).toMatchObject({
    status: 'refused',
    tool: 'write_project_file',
    reason: 'versionConflict',
    origin: 'native',
    error: 'versionConflict',
    detail: 'Saved bytes changed after the read.',
    note: expect.stringContaining('Read the current saved source'),
  })
  expect(result.error).not.toContain('{')
  expect(runner.checks.requiredBeforeReply).toBe(false)
  expect(commands.assistantProjectInventory).not.toHaveBeenCalled()
  await runner.close()
})

it('does not restore a runtimeBusy lease blocker from an earlier App process', async () => {
  useSessionStore.setState({ runId: 0, sessionStatus: 'idle' })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    'task-test',
    new AbortController().signal
  )
  expect(
    await restoreCheckEvidence(runner, {
      lastCheck: JSON.stringify({
        status: 'blocked',
        static: { inputFingerprint: 'static-v1' },
        runtime: { status: 'blocked', reason: 'runtimeBusy', key: '0:idle' },
      }),
    })
  ).toBe(false)
  expect(commands.creationDiagnosticIsStale).not.toHaveBeenCalled()
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  await runner.close()
})

it('does not reuse restored saved-input evidence over an unsaved creator draft', async () => {
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    'task-test',
    new AbortController().signal
  )
  seedCreationDraft('score.js', 'before', 'saved-v1')
  useCreationFilesStore.getState().edit('score.js', 'creator draft')
  expect(
    await restoreCheckEvidence(runner, {
      lastCheck: JSON.stringify({ status: 'passed', stale: false }),
      lastCheckId: 'saved-check',
    })
  ).toBe(false)
  expect(commands.creationCheckIsStale).not.toHaveBeenCalled()
  expect(commands.startAssistantCheck).not.toHaveBeenCalled()
  await runner.close()
})

it.each([
  { gate: 'question', status: 'awaitingCreatorAnswer' },
  { gate: 'resources', status: 'awaitingCreatorConfirmation' },
] as const)(
  'routes the automatic check through the real task entry while $gate is pending',
  async ({ gate, status }) => {
    const runner = await beginAssistantTask(
      'owner',
      'edit',
      undefined,
      new AbortController().signal
    )
    if (gate === 'question') {
      runner.task = {
        ...runner.task,
        questions: materialConflictTask().questions.map(question => ({
          ...question,
          taskId: runner.task.id,
        })),
      }
    } else {
      runner.task = {
        ...runner.task,
        resourcePlans: [
          {
            id: 'pending-resources',
            decision: 'pending',
            reason: 'Choose local resources before checking',
            alternative: null,
            resources: [],
          },
        ],
      }
    }
    const execute = vi.spyOn(runner, 'execute')
    runner.checks.saved()
    expect(runner.checks.requiredBeforeReply).toBe(true)
    expect(
      JSON.parse((await runner.checks.beforeReply()) ?? '{}')
    ).toMatchObject({
      status,
    })
    expect(execute).toHaveBeenCalledExactlyOnceWith('run_project_check', {})
    expect(commands.diagnoseCreationProject).not.toHaveBeenCalled()
    expect(commands.startAssistantCheck).not.toHaveBeenCalled()
    expect(commands.inspectCreationRuntime).not.toHaveBeenCalled()
    expect(runner.checks.requiredBeforeReply).toBe(false)
    expect(await runner.checks.beforeReply()).toBeUndefined()
    expect(execute).toHaveBeenCalledOnce()
    await runner.close()
  }
)

it('discovers selectable capabilities while retaining adopted internal dependency facts', async () => {
  vi.mocked(commands.getCreationModules).mockResolvedValueOnce({
    status: 'ok',
    data: { modules: [], handoffVersion: null },
  })
  vi.mocked(commands.getCreationLibraries).mockResolvedValueOnce({
    status: 'ok',
    data: {
      manifestVersion: 'saved',
      projectVersion: '1.0.0',
      libraries: ['socket.io', 'socket.io-client', 'qrcode'].map(id => ({
        id,
        version: '4.8.4',
        kind: 'node',
        source: { url: 'fixed', integrity: 'verified' },
        referencedVersion: id === 'qrcode' ? '1.5.4' : null,
      })),
    },
  })
  const runner = await beginAssistantTask(
    'owner',
    'discussion',
    undefined,
    new AbortController().signal
  )
  const resources = JSON.parse(await runner.execute('get_local_resources', {}))
  expect(resources.libraries.map((entry: { id: string }) => entry.id)).toEqual([
    'socket.io',
    'qrcode',
  ])
  expect(resources.libraries[1].referencedVersion).toBe('1.5.4')
  expect(commands.adoptCreationAssistantLibrary).not.toHaveBeenCalled()
  await runner.close()
})

it.each(['manifest.json', 'package.json'])(
  'preserves an unsaved %s before hub adoption can add its dependency',
  async path => {
    vi.mocked(commands.getCreationModules).mockResolvedValueOnce({
      status: 'ok',
      data: { modules: [], handoffVersion: null },
    })
    seedCreationDraft(path, '{}', 'saved')
    useCreationFilesStore.getState().edit(path, '{"creator":"draft"}')
    const runner = await beginAssistantTask(
      'owner',
      'edit',
      undefined,
      new AbortController().signal
    )
    const result = JSON.parse(
      await runner.execute('use_local_module', { id: 'hub' })
    )
    expect(result).toMatchObject({ status: 'refused', reason: 'creatorDraft' })
    expect(commands.adoptCreationAssistantModule).not.toHaveBeenCalled()
    expect(useCreationFilesStore.getState().drafts[path]?.text).toBe(
      '{"creator":"draft"}'
    )
    await runner.close()
  }
)

it.each(['switch', 'cancel'])(
  'does not approve or adopt hub after a late resource proposal following %s',
  async action => {
    const plan = {
      id: 'hub-plan',
      decision: 'pending' as const,
      reason: 'Connect the existing relay',
      alternative: null,
      resources: [
        {
          kind: 'module' as const,
          id: 'hub',
          version: '0.2.0',
          source: 'fixed',
        },
        {
          kind: 'library' as const,
          id: 'socket.io-client',
          version: '4.8.4',
          source: 'fixed',
        },
      ],
    }
    let finish!: (
      value: Awaited<
        ReturnType<typeof commands.proposeCreationAssistantResources>
      >
    ) => void
    vi.mocked(
      commands.proposeCreationAssistantResources
    ).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const controller = new AbortController()
    const onTask = vi.fn()
    const runner = await beginAssistantTask(
      'owner',
      'edit',
      undefined,
      controller.signal,
      onTask,
      'Add hub and socket.io-client then connect'
    )
    onTask.mockClear()
    const pending = runner
      .execute('use_local_module', { id: 'hub' })
      .catch(() => 'cancelled')
    if (action === 'cancel') controller.abort()
    else useCreationStore.setState({ workspace: null })
    finish({
      status: 'ok',
      data: { id: 'task-test', mode: 'edit', files: [], resourcePlans: [plan] },
    })
    await pending
    expect(commands.decideCreationAssistantResources).not.toHaveBeenCalled()
    expect(commands.adoptCreationAssistantModule).not.toHaveBeenCalled()
    expect(onTask).not.toHaveBeenCalled()
    await runner.close()
  }
)

it('groups local resources into a pending card, executes no later mutations or checks, and revokes the live grant', async () => {
  const plan = {
    id: 'task-test-resources-1',
    decision: 'pending' as const,
    reason: 'Client link and identity recovery; preserve numeric selection',
    alternative: null,
    resources: [
      {
        kind: 'module' as const,
        id: 'players',
        version: '0.2.0',
        source: 'fixed',
      },
      {
        kind: 'library' as const,
        id: 'socket.io',
        version: '4.8.4',
        source: 'fixed',
      },
    ],
  }
  vi.mocked(commands.proposeCreationAssistantResources).mockResolvedValueOnce({
    status: 'ok',
    data: { id: 'task-test', mode: 'edit', files: [], resourcePlans: [plan] },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  expect(
    JSON.parse(
      await runner.execute('propose_local_resources', {
        modules: ['players'],
        libraries: ['socket.io'],
        reason: plan.reason,
      })
    ).status
  ).toBe('awaitingCreatorConfirmation')
  for (const [name, args] of [
    ['create_project_file', { path: 'new.js', text: 'unexpected' }],
    ['use_local_library', { id: 'socket.io' }],
    ['run_project_check', {}],
  ] as const) {
    expect(JSON.parse(await runner.execute(name, args)).status).toBe(
      'awaitingCreatorConfirmation'
    )
  }
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  expect(commands.adoptCreationAssistantLibrary).not.toHaveBeenCalled()
  expect(commands.diagnoseCreationProject).not.toHaveBeenCalled()
  expect(commands.decideCreationAssistantResources).not.toHaveBeenCalled()
  await runner.close()
  expect(commands.endCreationAssistantTask).toHaveBeenCalledWith(
    'owner',
    'task-test'
  )
})

it('preauthorizes an explicitly requested local addition from the original human input and completes module adoption', async () => {
  const plan = {
    id: 'task-test-resources-1',
    decision: 'pending' as const,
    reason: 'Explicitly requested module',
    alternative: null,
    resources: [
      {
        kind: 'module' as const,
        id: 'players',
        version: '0.2.0',
        source: 'fixed',
      },
    ],
  }
  vi.mocked(commands.proposeCreationAssistantResources).mockResolvedValueOnce({
    status: 'ok',
    data: { id: 'task-test', mode: 'edit', files: [], resourcePlans: [plan] },
  })
  vi.mocked(commands.decideCreationAssistantResources).mockResolvedValueOnce({
    status: 'ok',
    data: { ...plan, decision: 'approved' },
  })
  vi.mocked(commands.getCreationModules).mockResolvedValueOnce({
    status: 'ok',
    data: {
      modules: [
        {
          id: 'players',
          version: '0.2.0',
          shippedVersion: '0.2.0',
          source: { repository: 'frozen', revision: 'fixed', version: '0.2.0' },
          files: ['modules/pnds-players/protocol.js'],
          state: 'available',
          recordVersion: null,
          compatibility: null,
          error: null,
        },
      ],
      handoffVersion: null,
    },
  })
  vi.mocked(commands.adoptCreationAssistantModule).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'task-test',
      mode: 'edit',
      files: [
        {
          path: 'modules/pnds-players/protocol.js',
          created: true,
          undone: false,
        },
      ],
      resourcePlans: [{ ...plan, decision: 'approved' }],
    },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal,
    undefined,
    '添加 players 模块并完成接线。'
  )
  expect(
    JSON.parse(await runner.execute('use_local_module', { id: 'players' }))
      .status
  ).toBe('saved')
  expect(commands.decideCreationAssistantResources).toHaveBeenCalledWith(
    'owner',
    'task-test',
    plan.id,
    'approved'
  )
  expect(commands.adoptCreationAssistantModule).toHaveBeenCalledWith(
    'owner',
    'task-test',
    'players'
  )
  expect(runner.checks.requiredBeforeReply).toBe(true)
  await runner.close()
})

function materialConflictTask(status: 'pending' | 'answered' = 'pending') {
  return {
    id: 'material-task',
    mode: 'edit' as const,
    files: [],
    questions: [
      {
        id: 'material-question',
        taskId: 'material-task',
        scope: { chatId: 'chat', messageId: 'reply' },
        prompt: 'public/Pattern.js',
        options: [
          { id: 'replace', label: 'public/Pattern.js', description: '' },
          {
            id: 'coexist',
            label: 'public/Pattern-imported.js',
            description: '',
          },
        ],
        recommendedOptionId: 'coexist',
        status,
        answer:
          status === 'answered' ? { optionId: 'coexist', text: null } : null,
        materialConflict: {
          materialId: 'a'.repeat(32),
          materialVersion: 'b'.repeat(64),
          path: 'public/Pattern.js',
          targetVersion: 'saved-v1',
          candidateSha256: 'c'.repeat(64),
          coexistPath: 'public/Pattern-imported.js',
          savedExcerpt: 'old',
          candidateExcerpt: 'new',
          firstChangedLine: 1,
          truncated: false,
        },
      },
    ],
  }
}

it('pauses the real adoption adapter on its canonical conflict without claiming a save or invalidating a check', async () => {
  const waiting = materialConflictTask()
  vi.mocked(commands.adoptCreationAssistantMaterial).mockResolvedValueOnce({
    status: 'ok',
    data: waiting,
  })
  const onTask = vi.fn()
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal,
    onTask,
    'Integrate the supplied Pattern',
    { chatId: 'chat', messageId: 'reply' }
  )
  const result = JSON.parse(
    await runner.execute('adopt_creation_material', {
      id: 'a'.repeat(32),
      version: 'b'.repeat(64),
      path: 'public/Pattern.js',
    })
  )
  expect(result).toMatchObject({
    status: 'awaitingCreatorAnswer',
    question: waiting.questions[0],
  })
  expect(runner.task.questions).toEqual(waiting.questions)
  expect(onTask).toHaveBeenLastCalledWith(waiting)
  expect(runner.checks.requiredBeforeReply).toBe(false)
  expect(commands.pollCreationChanges).not.toHaveBeenCalled()
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  await runner.close()
})

it('protects a concrete coexistence draft created while the native material question waited', async () => {
  const answered = materialConflictTask('answered')
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: answered,
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    answered.id,
    new AbortController().signal,
    undefined,
    'Integrate Pattern',
    { chatId: 'chat', messageId: 'reply' }
  )
  seedCreationDraft('public/Pattern-imported.js', 'saved creator text', 'v1')
  useCreationFilesStore
    .getState()
    .edit('public/Pattern-imported.js', 'new creator draft')
  expect(
    JSON.parse(
      await runner.execute('adopt_creation_material', {
        id: 'a'.repeat(32),
        version: 'b'.repeat(64),
        path: 'public/Pattern.js',
      })
    )
  ).toMatchObject({ status: 'refused', reason: 'creatorDraft' })
  expect(commands.adoptCreationAssistantMaterial).not.toHaveBeenCalled()
  expect(
    useCreationFilesStore.getState().drafts['public/Pattern-imported.js']?.text
  ).toBe('new creator draft')
  await runner.close()
})

it('reports free-text material guidance without pretending its original target was saved', async () => {
  const base = materialConflictTask('answered')
  const answered = {
    ...base,
    questions: base.questions.map(question => ({
      ...question,
      answer: { optionId: null, text: 'Explain the rhythm first' },
    })),
  }
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: answered,
  })
  vi.mocked(commands.adoptCreationAssistantMaterial).mockResolvedValueOnce({
    status: 'ok',
    data: answered,
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    answered.id,
    new AbortController().signal
  )
  expect(
    JSON.parse(
      await runner.execute('adopt_creation_material', {
        id: 'a'.repeat(32),
        version: 'b'.repeat(64),
        path: 'public/Pattern.js',
      })
    )
  ).toMatchObject({ status: 'creatorGuidance' })
  expect(runner.checks.requiredBeforeReply).toBe(false)
  expect(commands.pollCreationChanges).not.toHaveBeenCalled()
  await runner.close()
})

it('uses the fresh explicit material receipt after an older free-text answer and schedules its real saved check', async () => {
  const base = materialConflictTask('answered')
  const originalQuestion = base.questions[0]
  if (!originalQuestion) throw new Error('Missing material fixture question')
  const fresh = { ...originalQuestion, id: 'fresh-material-question' }
  const questions = [
    {
      ...originalQuestion,
      answer: { optionId: null, text: 'Explain first' },
    },
    fresh,
  ]
  vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: { ...base, questions },
  })
  vi.mocked(commands.adoptCreationAssistantMaterial).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...base,
      questions,
      files: [
        { path: 'public/Pattern-imported.js', created: true, undone: false },
      ],
      materialAdoptions: [
        {
          questionId: fresh.id,
          materialId: 'a'.repeat(32),
          materialVersion: 'b'.repeat(64),
          targetPath: 'public/Pattern.js',
          path: 'public/Pattern-imported.js',
          version: 'saved-v2',
          candidateSha256: 'c'.repeat(64),
        },
      ],
    },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    base.id,
    new AbortController().signal
  )
  expect(
    JSON.parse(
      await runner.execute('adopt_creation_material', {
        id: 'a'.repeat(32),
        version: 'b'.repeat(64),
        path: 'public/Pattern.js',
      })
    )
  ).toMatchObject({
    status: 'saved',
    adopted: { questionId: fresh.id, path: 'public/Pattern-imported.js' },
  })
  expect(runner.checks.requiredBeforeReply).toBe(true)
  await runner.close()
})

it('ends mutation authority after durable pending integration completion', async () => {
  vi.mocked(commands.completeCreationPendingIntegration).mockResolvedValueOnce({
    status: 'ok',
    data: {
      taskId: 'task-test',
      sources: [
        {
          id: 'a'.repeat(32),
          name: 'Pattern.js',
          version: 'b'.repeat(64),
          size: 4,
          totalCharacters: 4,
        },
      ],
      targets: [{ path: 'public/Pattern.js', version: 'saved-pattern' }],
      verification: 'unverified',
      reason: 'runtimeBusy',
      restored: false,
    },
  })
  const runner = await beginAssistantTask(
    'owner',
    'edit',
    undefined,
    new AbortController().signal
  )
  const result = JSON.parse(
    await runner.execute('complete_pending_integration', {
      sources: [
        {
          id: 'a'.repeat(32),
          version: 'b'.repeat(64),
          path: 'public/Pattern.js',
        },
      ],
      targets: [{ path: 'public/Pattern.js', version: 'saved-pattern' }],
      checkTaskId: null,
    })
  )
  expect(result.status).toBe('integrated')
  expect(
    JSON.parse(
      await runner.execute('create_project_file', {
        path: 'after.js',
        text: 'late change',
      })
    )
  ).toMatchObject({ status: 'refused', reason: 'integrationCompleted' })
  expect(commands.writeCreationAssistantFile).not.toHaveBeenCalled()
  await runner.close()
})
