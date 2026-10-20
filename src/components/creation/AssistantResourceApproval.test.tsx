import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { useAssistantStore } from '@/store/assistant-store'
import { AssistantResourceApproval } from './AssistantResourceApproval'

const plan = {
  id: 'plan',
  decision: 'pending' as const,
  reason: 'Preserve the existing score and add identity recovery.',
  alternative: 'Keep the current HTTP transport',
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
const originalDecide = useAssistantStore.getState().decideResourceApproval
const originalStop = useAssistantStore.getState().stop
beforeEach(() => {
  useAssistantStore.setState({
    resourceApproval: { taskId: 'task', replyId: 'reply', plan },
    resourceApprovalBusy: false,
    decideResourceApproval: originalDecide,
    stop: originalStop,
  })
})

it('shows one grouped decision at the task reply, with explicit continuation and alternative actions', () => {
  const decide = vi.fn().mockResolvedValue(undefined)
  useAssistantStore.setState({ decideResourceApproval: decide })
  render(<AssistantResourceApproval replyId="reply" />)
  expect(
    screen.getByRole('region', { name: 'Add local resources?' })
  ).toHaveTextContent(plan.reason)
  expect(screen.getByText('socket.io')).toBeInTheDocument()
  expect(screen.getByText(/modules\/pnds-players/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add and continue' }))
  expect(decide).toHaveBeenCalledWith('approved')
  fireEvent.click(screen.getByRole('button', { name: 'Use this alternative' }))
  expect(decide).toHaveBeenCalledWith('alternative')
  expect(document.querySelector('.animate-spin')).toBeNull()
})

it('cannot attach the card to another reply or silently decline when no alternative was proposed', () => {
  const { rerender } = render(<AssistantResourceApproval replyId="other" />)
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  useAssistantStore.setState({
    resourceApproval: {
      taskId: 'task',
      replyId: 'reply',
      plan: { ...plan, alternative: null },
    },
  })
  rerender(<AssistantResourceApproval replyId="reply" />)
  expect(
    screen.queryByRole('button', { name: 'Use this alternative' })
  ).not.toBeInTheDocument()
  const stop = vi.fn()
  useAssistantStore.setState({ stop })
  fireEvent.click(screen.getByRole('button', { name: 'End task' }))
  expect(stop).toHaveBeenCalledOnce()
})

afterEach(() => {
  useAssistantStore.setState({
    resourceApproval: null,
    resourceApprovalBusy: false,
    decideResourceApproval: originalDecide,
    stop: originalStop,
  })
})
