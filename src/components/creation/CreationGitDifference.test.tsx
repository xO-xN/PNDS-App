import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@/test/test-utils'
import type { GitComparisonDiff } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
import { CreationGitDifference } from './CreationGitDifference'

const diff: GitComparisonDiff = {
  token: 't',
  path: 'monitor.js',
  added: 1,
  deleted: 1,
  reason: null,
  hunks: [
    {
      oldStart: 8,
      oldLines: 2,
      newStart: 8,
      newLines: 2,
      lines: [
        {
          kind: 'context',
          oldLine: 8,
          newLine: 8,
          content: 'draw();',
          noNewline: false,
        },
        {
          kind: 'deletion',
          oldLine: 9,
          newLine: null,
          content: 'textSize(12);',
          noNewline: false,
        },
        {
          kind: 'addition',
          oldLine: null,
          newLine: 9,
          content: 'textSize(24);',
          noNewline: true,
        },
      ],
    },
  ],
}
it('renders signed changes and real line numbers in unified and split layouts', () => {
  const props = {
    diff,
    path: diff.path,
    loading: false,
    fullContext: false,
    onFullContext: vi.fn(),
    onOpen: vi.fn(),
    canOpen: true,
  }
  const { rerender } = render(<CreationGitDifference {...props} />)
  const deleted = screen.getByText('textSize(12);').closest('tr')
  expect(deleted).toHaveAttribute('data-change', 'deletion')
  expect(deleted && within(deleted).getByText('9')).toBeVisible()
  expect(deleted && within(deleted).getByText('−')).toBeVisible()
  expect(
    screen.getByText(i18n.t('creation.comparison.noNewline').trim())
  ).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.comparison.split') })
  )
  const row = screen.getByText('textSize(12);').closest('tr')
  expect(row && within(row).getByText('textSize(24);')).toBeVisible()
  expect(screen.getByText('textSize(24);')).toHaveAttribute(
    'data-change',
    'addition'
  )
  fireEvent.click(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.openCurrent'),
    })
  )
  expect(props.onOpen).toHaveBeenCalledOnce()
  rerender(
    <CreationGitDifference
      {...props}
      path="other.js"
      diff={{ ...diff, path: 'other.js' }}
    />
  )
  expect(
    screen.getByRole('button', { name: i18n.t('creation.comparison.split') })
  ).toHaveAttribute('aria-pressed', 'true')
})
it('shows unsupported files explicitly and keeps deleted files out of the editor', () => {
  render(
    <CreationGitDifference
      diff={{ ...diff, hunks: [], reason: 'binary' }}
      path="removed.png"
      loading={false}
      fullContext={false}
      onFullContext={vi.fn()}
      onOpen={vi.fn()}
      canOpen={false}
    />
  )
  expect(
    screen.getByText(i18n.t('creation.history.reason.binary'))
  ).toBeVisible()
  expect(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.openCurrent'),
    })
  ).toBeDisabled()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})
