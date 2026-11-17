/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { assistantTaskBuild } from './assistant-task-build'
import { commands, type AssistantCompileResult } from './tauri-bindings'
import { useCreationFilesStore } from '@/store/creation-files-store'

function compiled(): AssistantCompileResult {
  return {
    status: 'succeeded',
    reused: false,
    task: {
      id: 'work',
      mode: 'edit',
      files: [
        {
          path: 'supercollider/synthdefs/pad.scsyndef',
          created: false,
          undone: false,
        },
      ],
    },
    inputs: [{ path: 'supercollider/source/pad.scd', version: 'source-v2' }],
    artifacts: [
      { path: 'supercollider/synthdefs/pad.scsyndef', version: 'binary-v2' },
    ],
    report: {
      sclangPath: '/Applications/SuperCollider.app/Contents/MacOS/sclang',
      produced: ['pad.scsyndef'],
      references: [],
      output: '',
      error: null,
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  useCreationFilesStore.getState().clear()
  vi.mocked(commands.getAssistantBuildState)
    .mockReset()
    .mockResolvedValue({
      status: 'ok',
      data: { needed: true, reason: 'sourceChanged', receipt: null },
    })
  vi.mocked(commands.compileAssistantSynthdefs)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: compiled() })
})
afterEach(() => vi.unstubAllGlobals())

function fixture() {
  let current = true
  const published = vi.fn().mockResolvedValue(undefined)
  return {
    published,
    cancel: () => {
      current = false
    },
    build: assistantTaskBuild({
      identity: 'owner',
      taskId: 'work',
      published,
      assertCurrent: () => {
        if (!current) throw new Error('cancelled')
      },
    }),
  }
}

it('automatically compiles changed saved source and publishes the native task before delivery', async () => {
  const { build, published } = fixture()
  expect(await build.prepare()).toMatchObject({
    build: {
      status: 'passed',
      inputVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  })
  expect(commands.compileAssistantSynthdefs).toHaveBeenCalledExactlyOnceWith(
    'owner',
    'work',
    []
  )
  expect(commands.getAssistantBuildState).toHaveBeenCalledWith(
    'owner',
    'work',
    true
  )
  expect(published).toHaveBeenCalledExactlyOnceWith(compiled().task)
})

it('reuses only a native receipt freshly validated against source and binary versions', async () => {
  const { inputs, artifacts, report } = compiled()
  vi.mocked(commands.getAssistantBuildState).mockResolvedValue({
    status: 'ok',
    data: {
      needed: false,
      reason: null,
      receipt: { inputs, artifacts, report },
    },
  })
  const { build, published } = fixture()
  expect(await build.prepare()).toMatchObject({ build: { status: 'passed' } })
  expect(commands.compileAssistantSynthdefs).not.toHaveBeenCalled()
  expect(published).not.toHaveBeenCalled()
  vi.mocked(commands.getAssistantBuildState).mockResolvedValue({
    status: 'ok',
    data: { needed: true, reason: 'artifactChanged', receipt: null },
  })
  await build.prepare()
  expect(commands.compileAssistantSynthdefs).toHaveBeenCalledOnce()
})

it('reports actual compiler failure for same-task repair and distinguishes a missing compiler', async () => {
  const value = compiled()
  value.status = 'failed'
  value.report.error = 'pad.scd:12 syntax error'
  vi.mocked(commands.compileAssistantSynthdefs).mockResolvedValue({
    status: 'ok',
    data: value,
  })
  const { build, published } = fixture()
  expect(await build.prepare()).toMatchObject({
    build: { status: 'failed', reason: 'pad.scd:12 syntax error' },
    blocked: expect.stringContaining('syntax error'),
  })
  value.status = 'compilerUnavailable'
  expect(await build.prepare()).toMatchObject({ build: { status: 'blocked' } })
  expect(published).not.toHaveBeenCalled()
})

it('does not publish a compiler result delivered after cancellation', async () => {
  let resolve!: (result: { status: 'ok'; data: AssistantCompileResult }) => void
  vi.mocked(commands.compileAssistantSynthdefs).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done
      })
  )
  const { build, cancel, published } = fixture()
  const promise = build.compile()
  cancel()
  resolve({ status: 'ok', data: compiled() })
  await expect(promise).rejects.toThrow('cancelled')
  expect(published).not.toHaveBeenCalled()
})
