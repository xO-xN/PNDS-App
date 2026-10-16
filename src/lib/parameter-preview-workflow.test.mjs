import { afterEach, expect, it, vi } from 'vitest'
import { installPreviewAdapter } from '../../src-tauri/resources/parameter-preview/adapter.mjs'
import { commands } from './tauri-bindings'
import { bindPreviewMonitor } from './parameter-preview'
import { useParameterPreviewStore } from '../store/parameter-preview-store'
import { useCreationStore } from '../store/creation-store'
import { useCreationFilesStore } from '../store/creation-files-store'
import { useSessionStore } from '../store/session-store'

afterEach(() => {
  vi.restoreAllMocks()
})
let run = 90
async function controlledPage() {
  const identity = `preview-${++run}`
  const frame = globalThis.document.createElement('iframe')
  globalThis.document.body.append(frame)
  const page = frame.contentWindow
  page.document.body.innerHTML = '<output>2</output>'
  let speed = 2
  const stop = installPreviewAdapter(
    {
      hostOrigin: 'http://host',
      sources: { 'score.js': 'source' },
      contractDigest: 'contract',
      parameters: {
        speed: {
          kind: 'number',
          limits: { min: 0, max: 10 },
          get: () => speed,
          set: value => {
            speed = value
            page.document.querySelector('output').textContent = String(value)
          },
        },
      },
    },
    page
  )
  vi.spyOn(page, 'postMessage').mockImplementation(message => {
    page.dispatchEvent(
      new page.MessageEvent('message', {
        source: page.parent,
        origin: 'http://host',
        data: message,
      })
    )
  })
  vi.spyOn(page.parent, 'postMessage').mockImplementation(message => {
    globalThis.window.dispatchEvent(
      new globalThis.MessageEvent('message', {
        source: page,
        origin: 'http://score',
        data: message,
      })
    )
  })
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity,
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    runId: run,
    monitorReloadNonce: 0,
  })
  vi.mocked(commands.authorizeCreationPreview).mockResolvedValue({
    status: 'ok',
    data: {
      runtime: { generation: 'native-91' },
      sourceDigest: 'source',
      contractDigest: 'contract',
    },
  })
  bindPreviewMonitor(page, 'http://score')
  const request = {
    spec: {
      id: 'speed',
      path: 'score.js',
      prefix: 'const speed = ',
      suffix: ';',
      kind: 'number',
      limits: { min: 0, max: 10 },
      preview: 'live',
    },
    current: 2,
  }
  const owner = {
    identity,
    proposalId: 'candidate',
    revision: 1,
    path: 'score.js',
    version: 'disk-v1',
  }
  await Promise.resolve()
  return {
    page,
    request,
    owner,
    cleanup: () => {
      stop()
      bindPreviewMonitor(null, '')
      frame.remove()
    },
  }
}

it('previews on the actual same controlled page, converges and refuses stale declaration ownership', async () => {
  const { page, request, owner, cleanup } = await controlledPage()
  await useParameterPreviewStore.getState().preview(owner, {
    parameters: [{ request, value: null }],
    contractVersion: 'contract-v1',
    partial: true,
  })
  expect(useParameterPreviewStore.getState().status).toBe('failed')
  await useParameterPreviewStore.getState().preview(owner, {
    parameters: [{ request, value: 4 }],
    contractVersion: 'contract-v1',
    partial: true,
  })
  expect(useParameterPreviewStore.getState().status).toBe('temporary')
  expect(page.document.querySelector('output').textContent).toBe('4')
  const first = useParameterPreviewStore.getState().preview(
    { ...owner, revision: 2 },
    {
      parameters: [{ request, value: 5 }],
      contractVersion: 'contract-v1',
      partial: false,
    }
  )
  const second = useParameterPreviewStore.getState().preview(
    { ...owner, revision: 3 },
    {
      parameters: [{ request, value: 7 }],
      contractVersion: 'contract-v1',
      partial: false,
    }
  )
  await Promise.all([first, second])
  expect(page.document.querySelector('output').textContent).toBe('7')
  expect(useParameterPreviewStore.getState().owner.revision).toBe(3)
  await Promise.all([
    useParameterPreviewStore.getState().end(),
    useParameterPreviewStore.getState().end(),
  ])
  expect(page.document.querySelector('output').textContent).toBe('2')
  expect(useParameterPreviewStore.getState().status).toBe('ended')
  await useParameterPreviewStore.getState().preview(owner, {
    parameters: [{ request, value: 6 }],
    contractVersion: 'contract-v1',
    partial: false,
  })
  vi.mocked(commands.authorizeCreationPreview).mockImplementation(
    async (_identity, _path, _version, contractVersion) =>
      contractVersion === 'contract-v2'
        ? {
            status: 'ok',
            data: {
              runtime: { generation: 'native-91' },
              sourceDigest: 'source',
              contractDigest: 'new-contract',
            },
          }
        : {
            status: 'error',
            error: { code: 'versionConflict', detail: 'old declaration' },
          }
  )
  await useParameterPreviewStore.getState().preview(
    { ...owner, revision: 4 },
    {
      parameters: [{ request, value: 8 }],
      contractVersion: 'contract-v2',
      partial: false,
    }
  )
  expect(page.document.querySelector('output').textContent).toBe('6')
  expect(useParameterPreviewStore.getState().status).toBe('unrestored')
  vi.mocked(commands.authorizeCreationPreview).mockResolvedValue({
    status: 'error',
    error: { code: 'versionConflict', detail: 'external change' },
  })
  useCreationFilesStore.getState().changed(['score.js'])
  await vi.waitFor(() =>
    expect(useParameterPreviewStore.getState().status).toBe('unrestored')
  )
  expect(page.document.querySelector('output').textContent).toBe('6')
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  cleanup()
})

it('surfaces the shared failed restoration when a replacement preview is cancelled', async () => {
  const { page, request, owner, cleanup } = await controlledPage()
  const candidate = {
    parameters: [{ request, value: 4 }],
    contractVersion: 'contract-v1',
    partial: false,
  }
  await useParameterPreviewStore.getState().preview(owner, candidate)
  let finishRestore
  vi.mocked(commands.authorizeCreationPreview).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishRestore = resolve
      })
  )
  const replacement = useParameterPreviewStore
    .getState()
    .preview({ ...owner, proposalId: 'replacement' }, candidate)
  const cancelled = useParameterPreviewStore.getState().end()
  finishRestore({
    status: 'error',
    error: { code: 'versionConflict', detail: 'changed' },
  })
  await Promise.all([replacement, cancelled])
  expect(useParameterPreviewStore.getState().status).toBe('unrestored')
  expect(page.document.querySelector('output').textContent).toBe('4')
  cleanup()
})
