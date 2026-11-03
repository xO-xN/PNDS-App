import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import type { AssistantQuestion } from '@/lib/tauri-bindings'
import { CreationAssistant } from './CreationAssistant'

const answerQuestion = useAssistantStore.getState().answerQuestion
const question = (
  number: number,
  status: AssistantQuestion['status']
): AssistantQuestion => ({
  id: `q${number}`,
  taskId: 'task',
  scope: { chatId: 'original', messageId: 'reply' },
  prompt: `Decision ${number}`,
  options: [{ id: 'yes', label: `Choice ${number}`, description: '' }],
  recommendedOptionId: 'yes',
  status,
  answer: status === 'answered' ? { optionId: 'yes', text: null } : null,
})
function showQuestions(questions: AssistantQuestion[]) {
  useAssistantStore.setState({
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        text: 'The final answer is the main reading content.',
        status: 'completed',
        scope: 'platform',
        sources: [],
        questions,
      },
    ],
  })
}
beforeEach(() => {
  useAssistantStore.setState({
    owner: 'questions-owner',
    activeConversationId: null,
    activeQuestion: null,
    questionBusy: false,
    phase: 'idle',
    configured: false,
    error: null,
    input: '',
    resourceApproval: null,
    historyState: 'ready',
    historyBusy: false,
    historySaveError: null,
    historicalMessageIds: [],
    messages: [],
  })
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationReadingStore.getState().syncWorkspace('questions-owner')
})
afterEach(() => {
  useAssistantStore.setState({ answerQuestion, activeQuestion: null })
})

it('folds completed questions before the answer and leaves the current question available', () => {
  const pending = question(7, 'pending')
  showQuestions([
    ...Array.from({ length: 5 }, (_, index) => question(index + 1, 'answered')),
    question(6, 'cancelled'),
    pending,
  ])
  useAssistantStore.setState({
    activeQuestion: {
      question: pending,
      taskId: 'task',
      replyId: 'reply',
      conversationId: null,
      ready: true,
    },
  })
  render(<CreationAssistant identity="questions-owner" />)
  const summary = screen.getByText('Questions this turn · 6')
  const history = summary.closest('details')
  expect(history).not.toHaveAttribute('open')
  expect(screen.getByText('Decision 1')).not.toBeVisible()
  expect(
    screen.getByRole('region', { name: 'Creative question 7' })
  ).toBeVisible()
  expect(screen.getByRole('button', { name: /^Choice 7/ })).toBeEnabled()
  const body = screen.getByText('The final answer is the main reading content.')
  expect(body).toBeVisible()
  expect(
    summary.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  fireEvent.click(summary)
  expect(screen.getByText('Decision 1')).toBeVisible()
  expect(screen.getByText('Your answer: Choice 1')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Choice 1' })
  ).not.toBeInTheDocument()
})

it('moves submitted-question focus to a stable history summary without hiding a pending retry', async () => {
  const pending = question(1, 'pending')
  showQuestions([pending])
  useAssistantStore.setState({
    activeQuestion: {
      question: pending,
      taskId: 'task',
      replyId: 'reply',
      conversationId: null,
      ready: true,
    },
    answerQuestion: vi.fn(async () => {
      showQuestions([question(1, 'answered')])
      useAssistantStore.setState({ activeQuestion: null, phase: 'responding' })
    }),
  })
  render(<CreationAssistant identity="questions-owner" />)
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: /^Choice 1/ }))
  )
  expect(screen.getByText('Questions this turn · 1')).toHaveFocus()
  expect(screen.getByText('Decision 1')).not.toBeVisible()
})

it('keeps a restored pending question outside the folded history and requires Continue', () => {
  const pending = question(2, 'pending')
  showQuestions([question(1, 'answered'), pending])
  useAssistantStore.setState({
    activeQuestion: {
      question: pending,
      taskId: 'task',
      replyId: 'reply',
      conversationId: null,
      ready: false,
    },
  })
  render(<CreationAssistant identity="questions-owner" />)
  expect(screen.getByText('Decision 2')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Continue task' })).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: 'Choice 2' })
  ).not.toBeInTheDocument()
})
