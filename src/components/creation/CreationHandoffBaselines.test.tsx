import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type HandoffComparison } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useHandoffBaselinesStore } from '@/store/handoff-baselines-store'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationHandoffBaselines } from './CreationHandoffBaselines'
const comparison: HandoffComparison = {
  baselineId: 'b1',
  task: {
    id: 't1',
    intent: 'Wire sound',
    files: ['score.js'],
    acceptance: 'Hear the output',
    status: 'pending',
  },
  revision: 'r1',
  capturedAt: 1700000000000,
  currentFingerprint: 'current',
  comparedFiles: 3,
  baselineExcluded: [{ path: '.env', reason: 'sensitive' }],
  currentExcluded: [],
  changes: [
    {
      path: 'score.js',
      kind: 'modified',
      mentioned: true,
      before: {
        path: 'score.js',
        text: 'const speed = 2;\n',
        size: 17,
        sha256: 'before',
      },
      after: {
        path: 'score.js',
        text: 'const speed = 3;\n',
        size: 17,
        sha256: 'after',
      },
    },
    {
      path: 'old.md',
      kind: 'deleted',
      mentioned: false,
      before: {
        path: 'old.md',
        text: 'Deleted notes',
        size: 13,
        sha256: 'deleted',
      },
      after: null,
    },
    {
      path: 'sound.wav',
      kind: 'modified',
      mentioned: false,
      before: {
        path: 'sound.wav',
        text: null,
        size: 3,
        sha256: 'audio-before',
      },
      after: { path: 'sound.wav', text: null, size: 4, sha256: 'audio-after' },
    },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'p',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [{ path: 'score.js', kind: 'text', category: 'pages', size: 17 }],
    },
  })
  useCreationFilesStore.getState().clear()
  useCreationReadingStore.getState().syncWorkspace('p')
  useCreationReadingStore
    .getState()
    .showExtension(
      { id: 'handoff-baselines', title: 'Changes', content: null },
      'reply'
    )
  vi.mocked(commands.listHandoffBaselines).mockResolvedValue({
    status: 'ok',
    data: {
      usedBytes: 500,
      limitBytes: 268435456,
      baselines: [
        {
          id: 'b1',
          taskId: 't1',
          task: comparison.task,
          intent: 'Wire sound',
          revision: 'r1',
          capturedAt: comparison.capturedAt,
          complete: true,
          bytes: 500,
          files: 3,
          excluded: [],
          error: null,
        },
      ],
    },
  })
  vi.mocked(commands.compareHandoffBaseline).mockResolvedValue({
    status: 'ok',
    data: comparison,
  })
})
it('reloads newly recorded baselines when returning from file editing', async () => {
  render(<CreationHandoffBaselines identity="p" />)
  await screen.findByRole('heading', { name: 'Wire sound' })
  act(() => useCreationReadingStore.getState().showFile())
  const catalog = await commands.listHandoffBaselines('p')
  if (catalog.status !== 'ok') throw new Error('Expected baseline fixture')
  const baseline = catalog.data.baselines[0]
  if (!baseline) throw new Error('Expected first baseline')
  vi.mocked(commands.listHandoffBaselines).mockResolvedValue({
    status: 'ok',
    data: {
      ...catalog.data,
      baselines: [
        ...catalog.data.baselines,
        {
          ...baseline,
          id: 'b2',
          taskId: 't2',
          intent: 'Newly confirmed handoff',
          task: {
            ...comparison.task,
            id: 't2',
            intent: 'Newly confirmed handoff',
          },
        },
      ],
    },
  })
  act(() =>
    useCreationReadingStore
      .getState()
      .showExtension(
        { id: 'handoff-baselines', title: 'Changes', content: null },
        'reply'
      )
  )
  await screen.findByRole('heading', { name: 'Newly confirmed handoff' })
})
it('shows actual read-only text and resource differences, opens only current files and preserves drafts', async () => {
  seedCreationDraft('score.js', 'const speed = 3;\n', 'v3')
  useCreationFilesStore.getState().edit('score.js', 'const speed = 4;\n')
  render(<CreationHandoffBaselines identity="p" />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Compare saved files' })
  )
  await screen.findByText(/const speed = 2;/)
  expect(screen.getByText(/const speed = 3;/)).toBeInTheDocument()
  expect(screen.getByText(/audio-before/)).toBeInTheDocument()
  expect(screen.getByText(/audio-after/)).toBeInTheDocument()
  expect(screen.getByText('score.js', { selector: 'li' })).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Open current file old.md' })
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Open current file score.js' })
  )
  await waitFor(() =>
    expect(useCreationReadingStore.getState().view).toBe('file')
  )
  expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
    'const speed = 4;\n'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
})
it('marks stale results and rejects a late response after cancellation or project replacement', async () => {
  render(<CreationHandoffBaselines identity="p" />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Compare saved files' })
  )
  await screen.findByText(/const speed = 2;/)
  vi.mocked(commands.handoffComparisonIsStale).mockResolvedValue({
    status: 'ok',
    data: true,
  })
  await act(() => useHandoffBaselinesStore.getState().checkStale())
  expect(screen.getByRole('alert')).toHaveTextContent('Saved files changed')
  let finish!: (
    value: Awaited<ReturnType<typeof commands.compareHandoffBaseline>>
  ) => void
  vi.mocked(commands.compareHandoffBaseline).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Compare saved files' }))
  await waitFor(() =>
    expect(commands.compareHandoffBaseline).toHaveBeenCalledTimes(2)
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel comparison' }))
  await waitFor(() =>
    expect(commands.cancelHandoffOperation).toHaveBeenCalledWith('operation')
  )
  await act(async () => {
    finish({ status: 'ok', data: comparison })
  })
  expect(screen.queryByText(/const speed = 2;/)).not.toBeInTheDocument()
})

it('does not let late cleanup cancel another project comparison', async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof commands.deleteHandoffBaseline>>
  ) => void
  vi.mocked(commands.deleteHandoffBaseline).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const deleting = useHandoffBaselinesStore.getState().remove('b1')
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'other',
        root: '/other',
        name: 'Other',
        source: 'folder',
      },
      files: [],
    },
  })
  await useHandoffBaselinesStore.getState().compare('b1')
  finish({ status: 'ok', data: null })
  await deleting
  expect(useHandoffBaselinesStore.getState().comparison?.task.id).toBe('t1')
})
