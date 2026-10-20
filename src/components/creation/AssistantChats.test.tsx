import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor, within } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import type { AssistantMessage } from '@/lib/assistant-types'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { useAssistantStore } from '@/store/assistant-store'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import i18n from '@/i18n/config'
import { AssistantChats } from './AssistantChats'

const first: AssistantMessage = {
  id: 'first',
  role: 'user',
  text: 'First question',
  sources: [],
  status: 'completed',
  scope: 'platform',
}
const second: AssistantMessage = {
  ...first,
  id: 'second',
  text: 'Second question',
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useAssistantStore.getState().syncWorkspace(null)
  await flushAssistantHistory()
  vi.clearAllMocks()
  vi.mocked(commands.saveAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  useAssistantProjectStore.setState({ planning: false, whole: null })
  useAssistantStore.setState({
    owner: 'project',
    messages: [
      first,
      {
        ...first,
        id: 'second-chat',
        role: 'assistant',
        contextMarker: { type: 'topic' },
      },
      second,
    ],
    activeConversationId: 'second-chat',
    input: 'Current draft',
    conversationDrafts: { original: { input: 'First draft', editing: null } },
    editing: null,
    phase: 'idle',
    historyState: 'ready',
    historyBusy: false,
    historyError: null,
    historySaveError: null,
    historyEpoch: 'epoch',
  })
})

it('focuses the selected chat and supports arrows, Home/End, and Tab to its independent delete button', async () => {
  const user = userEvent.setup()
  render(<AssistantChats />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const selected = screen.getByRole('button', { name: '2 · Second question' })
  expect(selected).toHaveFocus()
  await user.keyboard('{Home}')
  expect(
    screen.getByRole('button', { name: '1 · First question' })
  ).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(selected).toHaveFocus()
  await user.keyboard('{ArrowUp}{End}')
  expect(selected).toHaveFocus()
  await user.tab()
  const deletion = screen.getByRole('button', {
    name: 'Delete chat 2 · Second question',
  })
  expect(deletion).toHaveFocus()
  expect(deletion).toHaveClass(
    'group-hover:opacity-100',
    'group-focus-within:opacity-100',
    'focus-visible:opacity-100'
  )
  expect(selected).not.toContainElement(deletion)
})

it('confirms a row deletion without selecting it and returns focus after cancelling', async () => {
  const user = userEvent.setup()
  render(<AssistantChats />)
  const trigger = screen.getByRole('button', { name: 'Chats' })
  await user.click(trigger)
  await user.click(
    screen.getByRole('button', { name: 'Delete chat 1 · First question' })
  )
  expect(await screen.findByRole('alertdialog')).toHaveAccessibleName(
    'Delete “1 · First question”?'
  )
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
  expect(useAssistantStore.getState().input).toBe('Current draft')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(trigger).toHaveFocus()
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})

it('keeps a failed deletion in the confirmation for retry and only removes the chat after saving', async () => {
  vi.mocked(commands.saveAssistantHistory).mockResolvedValueOnce({
    status: 'error',
    error: { type: 'io' },
  })
  const user = userEvent.setup()
  render(<AssistantChats />)
  const trigger = screen.getByRole('button', { name: 'Chats' })
  await user.click(trigger)
  await user.click(
    screen.getByRole('button', { name: 'Delete chat 2 · Second question' })
  )
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Delete chat' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'The chat was kept because deletion could not be saved. Try again.'
  )
  expect(useAssistantStore.getState().messages).toHaveLength(3)
  await user.click(within(dialog).getByRole('button', { name: 'Delete chat' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(trigger).toHaveFocus()
  expect(useAssistantStore.getState().messages).toEqual([first])
  expect(useAssistantStore.getState().input).toBe('First draft')
})

it('keeps running-request delete actions visible but disabled while allowing chat selection', async () => {
  useAssistantStore.setState({ phase: 'responding' })
  const user = userEvent.setup()
  render(<AssistantChats />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const deletion = screen.getByRole('button', {
    name: 'Delete chat 1 · First question',
  })
  expect(deletion).toBeDisabled()
  expect(deletion).toHaveClass('disabled:opacity-40')
  expect(
    screen.getByRole('button', { name: '1 · First question' })
  ).toBeEnabled()
  await user.click(deletion)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('does not offer deletion for the blank initial placeholder, but can delete its unsent draft', async () => {
  useAssistantStore.setState({
    messages: [],
    activeConversationId: null,
    input: '',
  })
  const user = userEvent.setup()
  render(<AssistantChats />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  expect(
    screen.queryByRole('button', { name: /^Delete chat/ })
  ).not.toBeInTheDocument()
  act(() => useAssistantStore.getState().setInput('Unsent question'))
  expect(
    screen.getByRole('button', { name: 'Delete chat 1 · Untitled chat' })
  ).toBeEnabled()
})

it('disables deletion during whole-project planning and hides an old workspace confirmation', async () => {
  const user = userEvent.setup()
  render(<AssistantChats />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  act(() => useAssistantProjectStore.setState({ planning: true }))
  expect(
    screen.getByRole('button', { name: 'Delete chat 1 · First question' })
  ).toBeDisabled()
  act(() => useAssistantProjectStore.setState({ planning: false }))
  await user.click(
    screen.getByRole('button', { name: 'Delete chat 1 · First question' })
  )
  await screen.findByRole('alertdialog')
  act(() => useAssistantStore.setState({ owner: 'other-project' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})
