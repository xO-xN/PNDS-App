import { beforeEach, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { toast } from 'sonner'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationErrorToast } from './CreationErrorToast'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }))
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'feedback',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationTestStore.setState({ tab: 'file' })
})
it('uses one transient notification for repeated watcher errors without adding a layout region', () => {
  const { container, rerender, unmount } = render(
    <CreationErrorToast
      id="watcher"
      error={{ code: 'io', detail: 'Cannot read project' }}
    />
  )
  expect(container).toBeEmptyDOMElement()
  expect(toast.error).toHaveBeenCalledOnce()
  expect(toast.error).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      id: 'watcher',
      description: 'Cannot read project',
      duration: 4000,
    })
  )
  rerender(
    <CreationErrorToast
      id="watcher"
      error={{ code: 'io', detail: 'Cannot read project' }}
    />
  )
  expect(toast.error).toHaveBeenCalledOnce()
  rerender(<CreationErrorToast id="watcher" error={null} />)
  expect(toast.dismiss).toHaveBeenCalledWith('watcher')
  unmount()
})
it('leaves the editor visible until the creator explicitly opens error details', () => {
  render(
    <CreationErrorToast
      id="runtime"
      identity="feedback"
      error="Node exited"
      details
    />
  )
  expect(useCreationTestStore.getState().tab).toBe('file')
  const options = vi.mocked(toast.error).mock.calls[0]?.[1]
  const action = options?.action
  if (!action || typeof action !== 'object' || !('onClick' in action))
    throw new Error('Expected the details action')
  action.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
  expect(useCreationTestStore.getState().tab).toBe('console')
})
it('does not open old error details in a different project', () => {
  render(
    <CreationErrorToast
      id="runtime"
      identity="feedback"
      error="Node exited"
      details
    />
  )
  const options = vi.mocked(toast.error).mock.calls[0]?.[1]
  const action = options?.action
  if (!action || typeof action !== 'object' || !('onClick' in action))
    throw new Error('Expected the details action')
  useCreationStore.setState({ workspace: null })
  action.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
  expect(useCreationTestStore.getState().tab).toBe('file')
})
