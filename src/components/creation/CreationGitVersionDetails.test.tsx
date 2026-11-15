import { expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import type { GitVersion, GitVersionGraph } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
import { CreationGitVersionDetails } from './CreationGitVersionDetails'

const version: GitVersion = {
  id: 'recorded-version',
  message: 'Balance the ripples\nOriginal commit body',
  author: 'Ada Composer',
  timestamp: 1_700_000_000,
  parents: ['first-parent', 'not-loaded'],
  files: ['sketch.js'],
}
const graph: GitVersionGraph = {
  head: version.id,
  versions: [
    version,
    {
      ...version,
      id: 'first-parent',
      message: 'First parent',
      parents: [],
    },
  ],
  branches: [],
  nextOffset: null,
  limited: false,
}
const props = () => ({
  version,
  graph,
  branch: 'experiment',
  working: false,
  editable: true,
  busy: false,
  error: null,
  onRename: vi.fn().mockResolvedValue(true),
  children: <button type="button">Main action</button>,
})
const start = () => {
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.rename') })
  )
  return screen.getByRole('textbox', {
    name: i18n.t('creation.versions.versionName'),
  })
}

it('shows compact version facts without repeating the time already displayed in the tree', () => {
  const { container } = render(<CreationGitVersionDetails {...props()} />)
  expect(screen.getByText('experiment')).toBeVisible()
  expect(screen.getByText('Ada Composer')).toBeVisible()
  expect(screen.getByText(version.id.slice(0, 8))).toHaveAttribute(
    'title',
    version.id
  )
  expect(screen.getByText('First parent, not-loaded')).toBeVisible()
  expect(container.querySelectorAll('dt')).toHaveLength(4)
  expect(screen.getByRole('button', { name: 'Main action' })).toBeVisible()
  expect(
    screen.queryByRole('button', {
      name: i18n.t('creation.versions.inspector'),
    })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(
      new Date(version.timestamp * 1000).toLocaleString(i18n.resolvedLanguage, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    )
  ).not.toBeInTheDocument()
})

it('opens inline editing and binds the full original message to one trimmed rename', async () => {
  const onRename = vi.fn().mockResolvedValue(true)
  render(<CreationGitVersionDetails {...props()} onRename={onRename} />)
  const input = start()
  expect(input).toHaveFocus()
  expect(input).toHaveValue('Balance the ripples')
  expect(input).toHaveAttribute('maxlength', '120')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: '  More space  ' } })
  await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
  expect(onRename).toHaveBeenCalledExactlyOnceWith({
    commit: version.id,
    expected: version.message,
    name: 'More space',
  })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('cancels with Escape and restores blank or unchanged names without changing multiline commits', () => {
  const onRename = vi.fn().mockResolvedValue(true)
  render(<CreationGitVersionDetails {...props()} onRename={onRename} />)
  let input = start()
  fireEvent.change(input, { target: { value: 'Not accepted' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  input = start()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  input = start()
  fireEvent.change(input, { target: { value: '   ' } })
  fireEvent.blur(input)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(onRename).not.toHaveBeenCalled()
  expect(screen.getByText('Balance the ripples')).toHaveAttribute(
    'title',
    version.message
  )
})

it('does not submit while choosing a Chinese input-method candidate', () => {
  const onRename = vi.fn().mockResolvedValue(true)
  render(<CreationGitVersionDetails {...props()} onRename={onRename} />)
  const input = start()
  fireEvent.change(input, { target: { value: '新的水纹' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(input).toBeInTheDocument()
  expect(onRename).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Escape' })
})

it('saves on blur without removing the next action target', async () => {
  const onRename = vi.fn().mockResolvedValue(true)
  const action = vi.fn()
  render(
    <CreationGitVersionDetails {...props()} onRename={onRename}>
      <button type="button" onClick={action}>
        Next action
      </button>
    </CreationGitVersionDetails>
  )
  const input = start()
  fireEvent.change(input, { target: { value: 'Keep this name' } })
  const next = screen.getByRole('button', { name: 'Next action' })
  await act(async () => {
    next.focus()
    fireEvent.click(next)
  })
  expect(onRename).toHaveBeenCalledExactlyOnceWith({
    commit: version.id,
    expected: version.message,
    name: 'Keep this name',
  })
  expect(next.isConnected).toBe(true)
  expect(action).toHaveBeenCalledOnce()
})

it('submits once, keeps the draft and inline failure, then permits a retry', async () => {
  let resolve!: (saved: boolean) => void
  const onRename = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<boolean>(done => {
          resolve = done
        })
    )
    .mockResolvedValue(true)
  const current = props()
  const { rerender } = render(
    <CreationGitVersionDetails {...current} onRename={onRename} />
  )
  const input = start()
  fireEvent.change(input, { target: { value: 'Retry this' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.blur(input)
  expect(onRename).toHaveBeenCalledOnce()
  expect(input).toHaveAttribute('readonly')
  rerender(
    <CreationGitVersionDetails
      {...current}
      onRename={onRename}
      error={{ code: 'versionConflict', detail: 'Native version changed' }}
    />
  )
  await act(async () => resolve(false))
  expect(input).toHaveValue('Retry this')
  expect(screen.getByRole('alert')).toHaveTextContent('Native version changed')
  fireEvent.blur(input)
  expect(onRename).toHaveBeenCalledOnce()
  await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))
  expect(onRename).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('ignores late completion after changing the selected version', async () => {
  let resolve!: (saved: boolean) => void
  const onRename = vi.fn().mockImplementation(
    () =>
      new Promise<boolean>(done => {
        resolve = done
      })
  )
  const current = props()
  const { rerender } = render(
    <CreationGitVersionDetails {...current} onRename={onRename} />
  )
  const input = start()
  fireEvent.change(input, { target: { value: 'Old version name' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  const next = {
    ...version,
    id: 'new-selection',
    message: 'Next version',
    parents: [],
  }
  rerender(
    <CreationGitVersionDetails
      {...current}
      version={next}
      onRename={onRename}
    />
  )
  await act(async () => resolve(true))
  expect(screen.getByText('Next version')).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText(i18n.t('creation.versions.noParent'))).toBeVisible()
})

it('keeps working changes free of rename and commit metadata and respects read-only history', () => {
  const current = props()
  const { container, rerender } = render(
    <CreationGitVersionDetails {...current} working />
  )
  expect(screen.getByText(i18n.t('creation.versions.working'))).toBeVisible()
  expect(
    screen.queryByRole('button', { name: i18n.t('creation.versions.rename') })
  ).not.toBeInTheDocument()
  expect(container.querySelector('dl')).not.toBeInTheDocument()
  rerender(<CreationGitVersionDetails {...current} editable={false} />)
  expect(
    screen.queryByRole('button', { name: i18n.t('creation.versions.rename') })
  ).not.toBeInTheDocument()
  expect(screen.getByText('Ada Composer')).toBeVisible()
})

it('labels a historical checkout without inferring a named route from another branch tip', () => {
  render(
    <CreationGitVersionDetails
      {...props()}
      branch={null}
      graph={{
        ...graph,
        branches: [{ name: 'same-commit-route', tip: version.id }],
      }}
    />
  )
  expect(
    screen.getByText(i18n.t('creation.git.historicalPosition'))
  ).toBeVisible()
  expect(screen.queryByText('same-commit-route')).not.toBeInTheDocument()
})
