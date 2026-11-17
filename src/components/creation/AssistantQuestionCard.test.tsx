import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { useAssistantStore } from '@/store/assistant-store'
import { AssistantQuestionCard } from './AssistantQuestionCard'
import type { AssistantQuestion } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'

const question: AssistantQuestion = {
  id: 'q1',
  taskId: 'task',
  scope: { chatId: 'original', messageId: 'reply' },
  prompt: 'How should the ensemble hear the ending?',
  options: [
    {
      id: 'shared',
      label: 'A shared ending',
      description: 'All performers finish together.',
    },
  ],
  recommendedOptionId: 'shared',
  status: 'pending',
  answer: null,
}
const answerQuestion = useAssistantStore.getState().answerQuestion
const stop = useAssistantStore.getState().stop
afterEach(() => {
  act(() => {
    void i18n.changeLanguage('en')
  })
  cleanup()
  act(() =>
    useAssistantStore.setState({
      activeQuestion: null,
      questionBusy: false,
      answerQuestion,
      stop,
    })
  )
})
it.each(['en', 'zh-CN'])(
  'shows native material differences and consequences in %s without a default answer',
  async language => {
    await act(async () => {
      await i18n.changeLanguage(language)
    })
    const materialQuestion: AssistantQuestion = {
      ...question,
      prompt: 'Grid.js',
      options: [
        { id: 'replace', label: 'Grid.js', description: '' },
        { id: 'coexist', label: 'Grid-imported.js', description: '' },
      ],
      recommendedOptionId: 'coexist',
      materialConflict: {
        materialId: 'a'.repeat(32),
        materialVersion: 'b'.repeat(64),
        path: 'Grid.js',
        targetVersion: 'saved-v1',
        candidateSha256: 'c'.repeat(64),
        coexistPath: 'Grid-imported.js',
        savedExcerpt: 'size = 3',
        candidateExcerpt: 'size = 8',
        firstChangedLine: 2,
        truncated: true,
      },
    }
    const submit = vi.fn()
    useAssistantStore.setState({
      phase: 'idle',
      activeConversationId: null,
      activeQuestion: {
        taskId: 'task',
        replyId: 'reply',
        question: materialQuestion,
        ready: true,
        conversationId: null,
      },
      questionBusy: false,
      answerQuestion: submit,
    })
    render(
      <AssistantQuestionCard question={materialQuestion} replyId="reply" />
    )
    expect(screen.getByText('size = 3')).toBeInTheDocument()
    expect(screen.getByText('size = 8')).toBeInTheDocument()
    const replace = screen.getByRole('radio', {
      name: language === 'en' ? /Replace Grid.js/ : /替换 Grid.js/,
    })
    expect(replace).not.toBeChecked()
    expect(
      screen
        .getAllByRole('radio')
        .every(radio => !(radio as HTMLInputElement).checked)
    ).toBe(true)
    expect(
      screen.getByText(language === 'en' ? /Keep the saved file/ : /保留保存版/)
    ).toHaveTextContent('Grid-imported.js')
    expect(replace).toHaveFocus()
    await userEvent.setup().keyboard('[Space]')
    expect(submit).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('assistant.question.submit') })
    )
    expect(submit).toHaveBeenCalledWith('q1', {
      optionId: 'replace',
      text: null,
    })
  }
)
function setup(ready = true, submit = vi.fn().mockResolvedValue(undefined)) {
  useAssistantStore.setState({
    owner: 'owner',
    phase: 'idle',
    activeConversationId: null,
    activeQuestion: {
      taskId: 'task',
      replyId: 'reply',
      question,
      ready,
      conversationId: null,
    },
    questionBusy: false,
    resumeError: false,
    answerQuestion: submit,
  })
  render(
    <AssistantQuestionCard question={question} replyId="reply" number={1} />
  )
  return submit
}
it.each(['[Space]', '[Enter]'])(
  'offers a recommendation and sends the chosen option immediately with %s',
  async key => {
    const submit = setup()
    const option = screen.getByRole('button', { name: /A shared ending/ })
    expect(screen.getByText('Q1')).toBeVisible()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Submit answer' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'End task' })
    ).not.toBeInTheDocument()
    const recommended = screen.getByText('Recommended')
    expect(recommended).toHaveClass('rounded-md', 'border', 'shrink-0')
    expect(option.lastElementChild).toBe(recommended)
    expect(screen.getByRole('textbox', { name: 'My own answer' })).toBeVisible()
    expect(submit).not.toHaveBeenCalled()
    const user = userEvent.setup()
    expect(option).toHaveFocus()
    await user.keyboard(key)
    expect(submit).toHaveBeenCalledWith('q1', {
      optionId: 'shared',
      text: null,
    })
    expect(option).toBeDisabled()
    fireEvent.click(option)
    expect(submit).toHaveBeenCalledOnce()
  }
)
it('sends a clicked option once while the native answer is pending', async () => {
  let release!: () => void
  const submit = setup(
    true,
    vi.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve
        })
    )
  )
  const option = screen.getByRole('button', { name: /A shared ending/ })
  fireEvent.click(option)
  fireEvent.click(option)
  expect(submit).toHaveBeenCalledOnce()
  expect(screen.getByRole('textbox')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Send my answer' })).toBeDisabled()
  await act(async () => release())
  expect(option).toBeDisabled()
})
it('keeps free text visible, ignores IME and Shift+Enter, and sends trimmed text with Enter', () => {
  const submit = setup()
  const input = screen.getByRole('textbox', { name: 'My own answer' })
  expect(screen.getByRole('button', { name: 'Send my answer' })).toBeDisabled()
  fireEvent.change(input, {
    target: { value: '  Each performer chooses when to stop.  ' },
  })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(submit).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(submit).toHaveBeenCalledWith('q1', {
    optionId: null,
    text: 'Each performer chooses when to stop.',
  })
})
it('allows the answer arrow to send text and preserves that text for retry after failure', async () => {
  const submit = setup(
    true,
    vi.fn(async () => {
      useAssistantStore.setState({ resumeError: true })
    })
  )
  const input = screen.getByRole('textbox', { name: 'My own answer' })
  fireEvent.change(input, { target: { value: 'Individual endings.' } })
  const send = screen.getByRole('button', { name: 'Send my answer' })
  fireEvent.click(send)
  await waitFor(() => expect(send).toBeEnabled())
  expect(input).toHaveValue('Individual endings.')
  expect(submit).toHaveBeenCalledWith('q1', {
    optionId: null,
    text: 'Individual endings.',
  })
})
it('restores the question as read-only until explicit task revalidation', () => {
  setup(false)
  expect(
    screen.getByText('Continue the task to answer this question.')
  ).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Submit answer' })
  ).not.toBeInTheDocument()
})

it.each([true, false])(
  'offers cancellation on the pending discussion question (ready: %s)',
  async ready => {
    setup(ready)
    const cancel = vi.fn()
    act(() =>
      useAssistantStore.setState({
        mode: 'discussion',
        historyState: 'ready',
        historyBusy: false,
        stop: cancel,
      })
    )
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Cancel this discussion round' })
    )
    expect(cancel).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('button', { name: 'End task' })
    ).not.toBeInTheDocument()
  }
)

it('disables the discussion cancel action while an answer is being saved', () => {
  setup()
  const cancel = vi.fn()
  act(() =>
    useAssistantStore.setState({
      mode: 'discussion',
      historyState: 'ready',
      historyBusy: false,
      questionBusy: true,
      stop: cancel,
    })
  )
  const action = screen.getByRole('button', {
    name: 'Cancel this discussion round',
  })
  expect(action).toBeDisabled()
  fireEvent.click(action)
  expect(cancel).not.toHaveBeenCalled()
})
