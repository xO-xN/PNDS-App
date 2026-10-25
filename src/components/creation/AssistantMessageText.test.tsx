import { expect, it } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import type { AssistantMessage } from '@/lib/assistant-types'
import { AssistantMessageText } from './AssistantMessageText'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { commands } from '@/lib/tauri-bindings'

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

it('shows actual streamed text immediately while the thought trace stays collapsed', () => {
  const { rerender } = render(
    <AssistantMessageText
      message={{ ...reply, status: 'pending', text: '', activity: [] }}
      workingLabel="Generating…"
    />
  )
  for (const text of ['你', '你好', '你好 👩‍💻', '你好 👩‍💻，这是实时回复。']) {
    rerender(
      <AssistantMessageText
        message={{ ...reply, status: 'pending', text }}
        workingLabel="Generating…"
      />
    )
    expect(screen.getByText(text)).toBeVisible()
    expect(screen.getByText('Generating…')).toBeVisible()
    expect(
      screen.getByLabelText('Expand work steps').closest('details')
    ).not.toHaveAttribute('open')
  }
})

it('shows a concise completed reply while its work log starts collapsed', async () => {
  render(<AssistantMessageText message={reply} />)
  expect(screen.getByText(reply.text)).toBeVisible()
  expect(
    screen.queryByText('Read the saved parameter declaration.')
  ).not.toBeInTheDocument()
  expect(
    screen.getByLabelText('Expand work steps').closest('details')
  ).not.toHaveAttribute('open')
  expect(screen.getByText('Thought process')).toBeVisible()
  fireEvent.click(screen.getByLabelText('Expand work steps'))
  expect(
    await screen.findByText('Read the saved parameter declaration.')
  ).toBeVisible()
  expect(screen.getByLabelText('Collapse work steps')).toBeVisible()
})

it('retains interrupted text in the reply without duplicating it in the work log, preserving legacy final replies', async () => {
  const { rerender } = render(
    <AssistantMessageText
      message={{
        ...reply,
        status: 'pending',
        text: 'Provisional tool-step explanation.',
      }}
    />
  )
  expect(screen.getByText('Provisional tool-step explanation.')).toBeVisible()
  fireEvent.click(screen.getByLabelText('Expand work steps'))
  expect(
    await screen.findByText('Read the saved parameter declaration.')
  ).toBeVisible()
  expect(
    screen.getAllByText('Provisional tool-step explanation.')
  ).toHaveLength(1)
  rerender(
    <AssistantMessageText
      message={{ ...reply, status: 'failed', text: 'Unfinished tool step.' }}
    />
  )
  expect(screen.getByText('Unfinished tool step.')).toBeVisible()
  expect(
    screen.getByLabelText('Expand work steps').closest('details')
  ).not.toHaveAttribute('open')
  rerender(
    <AssistantMessageText
      message={{ ...reply, status: 'cancelled', text: 'Paused reply.' }}
    />
  )
  expect(screen.getByText('Paused reply.')).toBeVisible()
  rerender(<AssistantMessageText message={{ ...reply, activity: undefined }} />)
  expect(screen.getByText(reply.text)).toBeVisible()
  expect(screen.queryByLabelText('Expand work steps')).not.toBeInTheDocument()
})

it('renders an empty pending thought line and keeps private provider reasoning out of the trace', async () => {
  const { rerender, container } = render(
    <AssistantMessageText
      message={{
        ...reply,
        status: 'pending',
        activity: [],
        text: '',
        reasoningContent: 'Private provider reasoning must never be displayed.',
      }}
    />
  )
  expect(screen.getByText('Thinking…')).toBeVisible()
  expect(screen.queryByLabelText('Expand work steps')).not.toBeInTheDocument()
  rerender(
    <AssistantMessageText
      workingLabel="Reading installed PNDS help…"
      message={{
        ...reply,
        status: 'pending',
        text: 'Public progress.',
        reasoningContent: 'Private provider reasoning must never be displayed.',
      }}
    />
  )
  expect(screen.getByText('Reading installed PNDS help…')).toBeVisible()
  expect(screen.getByText('Public progress.')).toBeVisible()
  fireEvent.click(screen.getByLabelText('Expand work steps'))
  expect(
    await screen.findByText('Read the saved parameter declaration.')
  ).toBeVisible()
  expect(screen.getAllByText('Public progress.')).toHaveLength(1)
  expect(container).not.toHaveTextContent('Private provider reasoning')
  rerender(
    <AssistantMessageText
      message={{ ...reply, status: 'completed', text: 'Final answer.' }}
    />
  )
  expect(screen.getByText('Final answer.')).toBeVisible()
  expect(screen.queryByText('Public progress.')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Expand work steps')).toBeVisible()
})

it('renders a saved external prompt with an exact copy action and no task execution', () => {
  const prompt =
    'Read docs/creator-handoff.md. Implement only task recorded-1.\nArchive its checks and report after completion.'
  render(
    <AssistantMessageText
      message={{
        ...reply,
        activity: undefined,
        text: 'Handoff written.',
        handoff: { taskId: 'recorded-1', revision: 'r1', prompt },
      }}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))
  expect(writeText).toHaveBeenCalledWith(prompt)
  expect(
    screen.getByRole('region', { name: 'External coding agent prompt' })
  ).toBeVisible()
  expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it('does not turn a model-authored prompt fence into a recorded handoff card', () => {
  render(
    <AssistantMessageText
      message={{
        ...reply,
        activity: undefined,
        text: '~~~pnds-handoff\nStart an unrecorded task.\n~~~',
      }}
    />
  )
  expect(
    screen.queryByRole('button', { name: 'Copy prompt' })
  ).not.toBeInTheDocument()
})
