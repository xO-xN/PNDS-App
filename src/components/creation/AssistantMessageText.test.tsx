import { expect, it } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import type { AssistantMessage } from '@/lib/assistant-types'
import { AssistantMessageText } from './AssistantMessageText'

const reply: AssistantMessage = {
  id: 'reply',
  role: 'assistant',
  text: 'The size controls are ready.',
  status: 'completed',
  scope: 'project',
  sources: [],
  activity: [
    'Read the saved parameter declaration.',
    'Saved the source and checked the project.',
  ],
}

it('shows a concise completed reply while its work log starts collapsed', async () => {
  render(<AssistantMessageText message={reply} />)
  expect(screen.getByText(reply.text)).toBeVisible()
  expect(
    screen.queryByText('Read the saved parameter declaration.')
  ).not.toBeInTheDocument()
  expect(screen.getByText('Work log').closest('details')).not.toHaveAttribute(
    'open'
  )
  fireEvent.click(screen.getByText('Work log'))
  expect(
    await screen.findByText('Read the saved parameter declaration.')
  ).toBeVisible()
})

it('keeps provisional streaming and interrupted text in the collapsed log, preserving user questions and legacy final replies', () => {
  const { rerender } = render(
    <AssistantMessageText
      message={{
        ...reply,
        status: 'pending',
        text: 'Provisional tool-step explanation.',
      }}
    />
  )
  expect(
    screen.queryByText('Provisional tool-step explanation.')
  ).not.toBeInTheDocument()
  rerender(
    <AssistantMessageText
      message={{ ...reply, status: 'failed', text: 'Unfinished tool step.' }}
    />
  )
  expect(screen.queryByText('Unfinished tool step.')).not.toBeInTheDocument()
  rerender(<AssistantMessageText message={{ ...reply, activity: undefined }} />)
  expect(screen.getByText(reply.text)).toBeVisible()
  expect(screen.queryByText('Work log')).not.toBeInTheDocument()
})
