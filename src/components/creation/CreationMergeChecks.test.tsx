import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import {
  commands,
  type GitMergeCandidate,
  type GitMergeChecks,
} from '@/lib/tauri-bindings'
import { useCreationMergeStore } from '@/store/creation-merge-store'
import { TextBuffer } from '@/lib/text-buffer'
import i18n from '@/i18n/config'
import { CreationMergeChecks } from './CreationMergeChecks'

const candidate: GitMergeCandidate = {
  id: 'merge',
  revision: 2,
  relation: 'diverged',
  phase: 'active',
  source: 'source',
  target: 'target',
  base: 'base',
  branch: 'main',
  name: 'Merge',
  files: [],
  unresolved: 0,
  result: null,
  detail: null,
  assistantOwner: null,
  canUndo: false,
}
const report: GitMergeChecks = {
  candidateId: 'merge',
  revision: 2,
  fingerprint: 'tree',
  fresh: true,
  canAdopt: true,
  detail: null,
  diagnostics: {
    schemaVersion: 1,
    checkerVersion: '1',
    projectPath: '/copy',
    project: null,
    inputFingerprint: 'input',
    inputs: [],
    checks: [],
    issues: [],
    unverified: [],
    staticPassed: true,
  },
  compile: {
    sclangPath: '/sclang',
    produced: ['main.scsyndef'],
    references: [],
    output: 'Saved compiler output',
    error: null,
  },
  compileStatus: 'passed',
  tests: null,
}
const saveAll = vi.fn().mockResolvedValue(undefined)
const refresh = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
  vi.clearAllMocks()
  useCreationMergeStore.setState({
    identity: 'identity',
    candidate,
    drafts: {},
    busy: false,
    saveAll,
    refresh,
  })
  Object.assign(commands, {
    getMergeCandidateChecks: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: report }),
    adoptMergeArtifacts: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: { ...candidate, revision: 3 } }),
  })
})

it('keeps compiled artifacts separate until the creator explicitly adopts them', async () => {
  render(<CreationMergeChecks identity="identity" candidateId="merge" />)
  const adopt = await screen.findByRole('button', {
    name: i18n.t('creation.merge.adoptArtifacts'),
  })
  expect(commands.adoptMergeArtifacts).not.toHaveBeenCalled()
  fireEvent.click(adopt)
  await waitFor(() =>
    expect(commands.adoptMergeArtifacts).toHaveBeenCalledWith(
      'identity',
      'merge',
      2
    )
  )
  expect(saveAll).toHaveBeenCalledOnce()
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
})

it('marks previous reports out of date as soon as the candidate has unsaved edits', async () => {
  render(<CreationMergeChecks identity="identity" candidateId="merge" />)
  const adopt = await screen.findByRole('button', {
    name: i18n.t('creation.merge.adoptArtifacts'),
  })
  expect(adopt).toBeEnabled()
  act(() =>
    useCreationMergeStore.setState({
      drafts: {
        'sketch.js': {
          text: 'manual change',
          savedText: 'saved',
          version: 'v1',
          buffer: new TextBuffer('manual change', 'sketch.js'),
          editorRevision: 0,
        },
      },
    })
  )
  expect(adopt).toBeDisabled()
  expect(
    screen
      .getAllByRole('status')
      .slice(0, 2)
      .every(status => status.dataset.outcome === 'outdated')
  ).toBe(true)
  expect(screen.getByText('Saved compiler output')).toBeInTheDocument()
  expect(commands.adoptMergeArtifacts).not.toHaveBeenCalled()
})

it('does not publish a late report from a replaced candidate', async () => {
  let resolve!: (
    result: Awaited<ReturnType<typeof commands.getMergeCandidateChecks>>
  ) => void
  vi.mocked(commands.getMergeCandidateChecks)
    .mockReturnValueOnce(
      new Promise(done => {
        resolve = done
      })
    )
    .mockResolvedValue({ status: 'ok', data: null })
  const view = render(
    <CreationMergeChecks identity="identity" candidateId="merge" />
  )
  act(() =>
    useCreationMergeStore.setState({
      candidate: { ...candidate, id: 'replacement' },
    })
  )
  view.rerender(
    <CreationMergeChecks identity="identity" candidateId="replacement" />
  )
  await act(async () => {
    resolve({ status: 'ok', data: report })
  })
  expect(
    screen.queryByRole('button', {
      name: i18n.t('creation.merge.adoptArtifacts'),
    })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Saved compiler output')).not.toBeInTheDocument()
  expect(
    screen
      .getAllByRole('status')
      .every(status => status.dataset.outcome === 'notExecuted')
  ).toBe(true)
})
