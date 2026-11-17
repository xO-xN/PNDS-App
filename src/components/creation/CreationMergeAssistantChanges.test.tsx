import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
const calls = vi.hoisted(() => ({ changes: vi.fn(), diff: vi.fn() }))
vi.mock('@/lib/tauri-bindings', () => ({
  commands: {
    getGitMergeAssistantChanges: calls.changes,
    readGitMergeAssistantDiff: calls.diff,
  },
}))
vi.mock('@/lib/merge-assistant-dependencies', () => ({
  mergeAssistantResult: (result: { status: string; data: unknown }) => {
    if (result.status !== 'ok') throw new Error('unavailable')
    return result.data
  },
}))
import { CreationMergeAssistantChanges } from './CreationMergeAssistantChanges'

const props = {
  identity: 'physical',
  candidateId: 'merge-1',
  taskId: 'round-1',
  revision: 2,
}
beforeEach(() => {
  vi.resetAllMocks()
  calls.changes.mockResolvedValue({
    status: 'ok',
    data: { available: true, paths: ['actual.js'] },
  })
  calls.diff.mockResolvedValue({
    status: 'ok',
    data: {
      beforeExists: true,
      afterExists: true,
      conflictChanged: true,
      diff: {
        token: 'round-1',
        path: 'actual.js',
        added: 1,
        deleted: 1,
        reason: null,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              {
                oldLine: 1,
                newLine: null,
                kind: 'deletion',
                content: 'native before\n',
                noNewline: false,
              },
              {
                oldLine: null,
                newLine: 1,
                kind: 'addition',
                content: 'native round after\n',
                noNewline: false,
              },
            ],
          },
        ],
      },
    },
  })
})

it('loads exact native round differences only when opened', async () => {
  const { container } = render(<CreationMergeAssistantChanges {...props} />)
  expect(calls.changes).not.toHaveBeenCalled()
  const details = container.querySelector('details')
  if (!details) throw new Error('Missing changes disclosure')
  details.open = true
  fireEvent(details, new Event('toggle', { bubbles: true }))
  await screen.findByText('native round after')
  expect(calls.changes).toHaveBeenCalledWith('physical', 'merge-1', 'round-1')
  expect(calls.diff).toHaveBeenCalledWith(
    'physical',
    'merge-1',
    'round-1',
    'actual.js',
    false
  )
  expect(container.querySelector('[data-change="deletion"]')).toHaveTextContent(
    'native before'
  )
  expect(container.querySelector('[data-change="addition"]')).toHaveTextContent(
    'native round after'
  )
})

it('removes old difference content once its checkpoint is replaced or undone', async () => {
  const { container, rerender } = render(
    <CreationMergeAssistantChanges {...props} />
  )
  const details = container.querySelector('details')
  if (!details) throw new Error('Missing changes disclosure')
  details.open = true
  fireEvent(details, new Event('toggle', { bubbles: true }))
  await screen.findByText('native round after')
  calls.changes.mockResolvedValue({
    status: 'ok',
    data: { available: false, paths: [] },
  })
  rerender(<CreationMergeAssistantChanges {...props} revision={3} />)
  await waitFor(() =>
    expect(screen.queryByText('native round after')).not.toBeInTheDocument()
  )
  expect(container.querySelector('table')).not.toBeInTheDocument()
  expect(container.querySelector('select')).not.toBeInTheDocument()
})
