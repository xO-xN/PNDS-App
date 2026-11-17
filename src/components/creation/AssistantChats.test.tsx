import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
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
    conversationTitles: {},
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

it('opens history with a collapsed search button and supports keyboard navigation and deletion per row', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  const trigger = screen.getByRole('button', { name: 'Chats' })
  await user.click(trigger)
  const history = screen.getByRole('dialog', { name: 'Chats' })
  const searchButton = within(history).getByRole('button', {
    name: 'Search chats',
  })
  expect(searchButton).toHaveFocus()
  expect(searchButton).toHaveAttribute('aria-expanded', 'false')
  expect(within(history).queryByRole('searchbox')).not.toBeInTheDocument()
  expect(
    within(history).queryByRole('button', { name: 'Close chat history' })
  ).not.toBeInTheDocument()
  await user.keyboard('{Enter}')
  const search = within(history).getByRole('searchbox', {
    name: 'Search chats',
  })
  expect(search).toHaveFocus()
  expect(searchButton).toHaveAttribute('aria-expanded', 'true')
  const rows = within(history).getAllByRole('button', {
    name: /^(First|Second) question$/,
  })
  const [firstRow, lastRow] = rows
  if (!firstRow || !lastRow) throw new Error('Expected two history rows')
  expect(
    within(history).getByRole('button', { name: 'Second question' })
  ).toHaveAttribute('aria-pressed', 'true')
  await user.keyboard('{ArrowDown}')
  expect(firstRow).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(lastRow).toHaveFocus()
  await user.keyboard('{Home}')
  expect(firstRow).toHaveFocus()
  await user.keyboard('{ArrowUp}{End}')
  expect(lastRow).toHaveFocus()
  await user.tab()
  const rename = within(history).getByRole('button', {
    name: `Rename chat ${lastRow.getAttribute('aria-label')}`,
  })
  expect(rename).toHaveFocus()
  expect(lastRow).not.toContainElement(rename)
  await user.tab()
  const deletion = within(history).getByRole('button', {
    name: `Delete chat ${lastRow.getAttribute('aria-label')}`,
  })
  expect(deletion).toHaveFocus()
  expect(lastRow).not.toContainElement(deletion)
  await user.keyboard('{Escape}')
  expect(history).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('expands and focuses search on mouse hover before any click', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  const searchButton = within(history).getByRole('button', {
    name: 'Search chats',
  })
  expect(searchButton).toHaveAttribute('aria-expanded', 'false')
  await user.hover(searchButton)
  expect(searchButton).toHaveAttribute('aria-expanded', 'true')
  expect(
    within(history).getByRole('searchbox', { name: 'Search chats' })
  ).toHaveFocus()
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
})

it('waits for a touch tap to expand search instead of treating touch entry as hover', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  const searchButton = within(history).getByRole('button', {
    name: 'Search chats',
  })
  fireEvent.pointerEnter(searchButton, { pointerType: 'touch' })
  expect(searchButton).toHaveAttribute('aria-expanded', 'false')
  expect(within(history).queryByRole('searchbox')).not.toBeInTheDocument()
  await user.pointer({ target: searchButton, keys: '[TouchA]' })
  expect(searchButton).toHaveAttribute('aria-expanded', 'true')
  expect(
    within(history).getByRole('searchbox', { name: 'Search chats' })
  ).toHaveFocus()
})

it('keeps New chat in the assistant header and leaves it out of history', async () => {
  const user = userEvent.setup()
  const focusComposer = vi.fn()
  render(<AssistantChats identity="project" onFocusComposer={focusComposer} />)
  const newChat = screen.getByRole('button', { name: 'New chat' })
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  expect(
    within(history).queryByRole('button', { name: 'New chat' })
  ).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  await user.click(newChat)
  expect(useAssistantStore.getState().activeConversationId).not.toBe(
    'second-chat'
  )
  expect(useAssistantStore.getState().messages).toHaveLength(4)
  expect(
    useAssistantStore.getState().conversationDrafts['second-chat']?.input
  ).toBe('Current draft')
  expect(focusComposer).toHaveBeenCalledOnce()
})

it('closes history from outside without changing the selected chat or its draft', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  const trigger = screen.getByRole('button', { name: 'Chats' })
  await user.click(trigger)
  const history = screen.getByRole('dialog', { name: 'Chats' })
  const overlay = document.querySelector('[data-slot="dialog-overlay"]')
  if (!overlay) throw new Error('Expected history overlay')
  await user.click(overlay)
  expect(history).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
  expect(useAssistantStore.getState().input).toBe('Current draft')
})

it('collapses empty search on blur and keeps a nonempty filter expanded', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  const searchButton = within(history).getByRole('button', {
    name: 'Search chats',
  })
  await user.hover(searchButton)
  const search = within(history).getByRole('searchbox', {
    name: 'Search chats',
  })
  await user.hover(
    within(history).getByRole('button', { name: 'First question' })
  )
  act(() =>
    within(history).getByRole('button', { name: 'First question' }).focus()
  )
  expect(searchButton).toHaveAttribute('aria-expanded', 'false')
  expect(within(history).queryByRole('searchbox')).not.toBeInTheDocument()
  await user.hover(searchButton)
  await user.type(search, 'question')
  act(() =>
    within(history).getByRole('button', { name: 'First question' }).focus()
  )
  expect(searchButton).toHaveAttribute('aria-expanded', 'true')
  expect(within(history).getByRole('searchbox')).toHaveValue('question')
  await user.click(search)
  await user.click(
    within(history).getByRole('button', { name: 'Clear search' })
  )
  expect(search).toHaveFocus()
  expect(search).toHaveValue('')
  expect(searchButton).toHaveAttribute('aria-expanded', 'true')
  await user.tab()
  expect(searchButton).toHaveAttribute('aria-expanded', 'false')
})

it('keeps IME Escape in search and closes history with a normal Escape', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  const trigger = screen.getByRole('button', { name: 'Chats' })
  await user.click(trigger)
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await user.hover(
    within(history).getByRole('button', { name: 'Search chats' })
  )
  const search = within(history).getByRole('searchbox')
  await user.type(search, 'question')
  fireEvent.keyDown(search, { key: 'Escape', isComposing: true })
  fireEvent.keyDown(search, { key: 'Escape', keyCode: 229 })
  expect(history).toBeInTheDocument()
  expect(search).toHaveValue('question')
  await user.keyboard('{Escape}')
  expect(history).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  await user.click(trigger)
  expect(screen.getByRole('button', { name: 'Search chats' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  await user.hover(screen.getByRole('button', { name: 'Search chats' }))
  expect(screen.getByRole('searchbox')).toHaveValue('')
})

it('searches the full first question and selects a result without losing drafts', async () => {
  const longTitle =
    'A long first question with enough words to fill the whole visible title, ending in Obsidian'
  act(() =>
    useAssistantStore.setState(state => ({
      messages: [{ ...first, text: longTitle }, ...state.messages.slice(1)],
    }))
  )
  const focusComposer = vi.fn()
  const user = userEvent.setup()
  render(<AssistantChats identity="project" onFocusComposer={focusComposer} />)
  const trigger = screen.getByRole('button', { name: 'Chats' })
  await user.click(trigger)
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await user.hover(
    within(history).getByRole('button', { name: 'Search chats' })
  )
  const search = within(history).getByRole('searchbox', {
    name: 'Search chats',
  })
  await user.type(search, 'no match here')
  expect(
    within(history).queryAllByRole('button', { name: /^Delete chat / })
  ).toHaveLength(0)
  await user.keyboard('{Enter}')
  expect(history).toBeInTheDocument()
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
  await user.clear(search)
  await user.type(search, 'OBSIDIAN')
  expect(
    within(history).queryByRole('button', { name: 'Second question' })
  ).not.toBeInTheDocument()
  expect(
    within(history).getByRole('button', { name: /^A long first question/ })
  ).toBeVisible()
  fireEvent.keyDown(search, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(search, { key: 'Enter', keyCode: 229 })
  expect(history).toBeVisible()
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
  await user.keyboard('{Enter}')
  await waitFor(() => expect(focusComposer).toHaveBeenCalledOnce())
  expect(history).not.toBeInTheDocument()
  expect(useAssistantStore.getState().activeConversationId).toBeNull()
  expect(useAssistantStore.getState().input).toBe('First draft')
  expect(
    useAssistantStore.getState().conversationDrafts['second-chat']?.input
  ).toBe('Current draft')
  await user.click(trigger)
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  await user.hover(screen.getByRole('button', { name: 'Search chats' }))
  expect(screen.getByRole('searchbox', { name: 'Search chats' })).toHaveValue(
    ''
  )
})

it('confirms a row deletion without selecting it and returns focus after cancelling', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  const trigger = screen.getByRole('button', { name: 'Chats' })
  await user.click(trigger)
  const deleteButton = screen.getByRole('button', {
    name: 'Delete chat First question',
  })
  await user.click(deleteButton)
  expect(await screen.findByRole('alertdialog')).toHaveAccessibleName(
    'Delete “First question”?'
  )
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
  expect(useAssistantStore.getState().input).toBe('Current draft')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('dialog', { name: 'Chats' })).toBeVisible()
  await waitFor(() => expect(deleteButton).toHaveFocus())
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})

it('keeps a failed deletion in the confirmation for retry and only removes the chat after saving', async () => {
  vi.mocked(commands.saveAssistantHistory).mockResolvedValueOnce({
    status: 'error',
    error: { type: 'io' },
  })
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  const trigger = screen.getByRole('button', { name: 'Chats' })
  await user.click(trigger)
  await user.click(
    screen.getByRole('button', { name: 'Delete chat Second question' })
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
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await waitFor(() =>
    expect(
      within(history).getByRole('button', { name: 'Search chats' })
    ).toHaveFocus()
  )
  expect(within(history).queryByRole('searchbox')).not.toBeInTheDocument()
  expect(
    within(history).queryByRole('button', { name: 'Second question' })
  ).not.toBeInTheDocument()
  expect(
    within(history).getByRole('button', { name: 'First question' })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(useAssistantStore.getState().messages).toEqual([first])
  expect(useAssistantStore.getState().input).toBe('First draft')
})

it('returns focus to the expanded search after deleting a filtered chat', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  const searchButton = within(history).getByRole('button', {
    name: 'Search chats',
  })
  await user.hover(searchButton)
  const search = within(history).getByRole('searchbox')
  await user.type(search, 'question')
  await user.click(
    within(history).getByRole('button', { name: 'Delete chat Second question' })
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete chat',
    })
  )
  await waitFor(() => expect(search).toHaveFocus())
  expect(search).toHaveValue('question')
  expect(searchButton).toHaveAttribute('aria-expanded', 'true')
  expect(
    within(history).getByRole('button', { name: 'First question' })
  ).toBeVisible()
})

it('focuses the title when history fails to load and keeps reset cancellation usable', async () => {
  useAssistantStore.setState({
    historyState: 'error',
    historyError: 'invalidFormat',
  })
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  const trigger = screen.getByRole('button', { name: 'Chats' })
  await user.click(trigger)
  const history = screen.getByRole('dialog', { name: 'Chats' })
  expect(within(history).getByRole('heading', { name: 'Chats' })).toHaveFocus()
  expect(
    within(history).queryByRole('button', { name: 'Search chats' })
  ).not.toBeInTheDocument()
  expect(within(history).queryByRole('searchbox')).not.toBeInTheDocument()
  const clear = within(history).getByRole('button', {
    name: 'Clear project history',
  })
  await user.click(clear)
  expect(screen.getByRole('alertdialog')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(clear).toHaveFocus())
  expect(history).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(history).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('restores a usable focus target after resetting unreadable history', async () => {
  useAssistantStore.setState({
    historyState: 'error',
    historyError: 'invalidFormat',
  })
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await user.click(
    within(history).getByRole('button', { name: 'Clear project history' })
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Clear this history',
    })
  )
  await waitFor(() =>
    expect(
      within(history).getByRole('heading', { name: 'Chats' })
    ).toHaveFocus()
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(useAssistantStore.getState().historyState).toBe('ready')
  expect(within(history).queryByRole('searchbox')).not.toBeInTheDocument()
  await user.tab()
  expect(
    within(history).getByRole('button', { name: 'Search chats' })
  ).toHaveFocus()
})

it('keeps running-request delete actions visible but disabled while allowing chat selection', async () => {
  useAssistantStore.setState({ phase: 'responding' })
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const deletion = screen.getByRole('button', {
    name: 'Delete chat First question',
  })
  expect(deletion).toBeDisabled()
  const original = screen.getByRole('button', { name: 'First question' })
  expect(original).toBeEnabled()
  await user.click(deletion)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await user.click(original)
  expect(useAssistantStore.getState().phase).toBe('idle')
  expect(useAssistantStore.getState().input).toBe('First draft')
})

it('does not offer deletion for the blank initial placeholder, but can delete its unsent draft', async () => {
  useAssistantStore.setState({
    messages: [],
    activeConversationId: null,
    input: '',
  })
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  expect(
    screen.queryByRole('button', { name: /^Delete chat/ })
  ).not.toBeInTheDocument()
  act(() => useAssistantStore.getState().setInput('Unsent question'))
  expect(
    screen.getByRole('button', { name: 'Delete chat Untitled chat' })
  ).toBeEnabled()
  await user.click(
    screen.getByRole('button', { name: 'Delete chat Untitled chat' })
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete chat',
    })
  )
  const history = await screen.findByRole('dialog', { name: 'Chats' })
  expect(
    within(history).getByRole('button', { name: 'Untitled chat' })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    within(history).queryByRole('button', { name: /^Delete chat / })
  ).not.toBeInTheDocument()
  expect(useAssistantStore.getState().input).toBe('')
})

it('allows deleting a named empty chat and restores the unnamed placeholder', async () => {
  useAssistantStore.setState({
    messages: [],
    activeConversationId: null,
    input: '',
    conversationTitles: { original: 'Named empty chat' },
  })
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await user.click(
    within(history).getByRole('button', {
      name: 'Delete chat Named empty chat',
    })
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete chat',
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
  expect(
    within(history).getByRole('button', { name: 'Untitled chat' })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    within(history).queryByRole('button', { name: /^Delete chat / })
  ).not.toBeInTheDocument()
})

it('disables deletion during whole-project planning and hides an old workspace confirmation', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  act(() => useAssistantProjectStore.setState({ planning: true }))
  expect(
    screen.getByRole('button', { name: 'Delete chat First question' })
  ).toBeDisabled()
  act(() => useAssistantProjectStore.setState({ planning: false }))
  await user.click(
    screen.getByRole('button', { name: 'Delete chat First question' })
  )
  await screen.findByRole('alertdialog')
  act(() => useAssistantStore.setState({ owner: 'other-project' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})

it('edits the full header name in place and selects it without opening a dialog', async () => {
  const title =
    'A complete custom chat title that remains editable beyond the abbreviated chat label'
  useAssistantStore.setState({ conversationTitles: { 'second-chat': title } })
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: /^Rename chat / }))
  const input = screen.getByRole<HTMLInputElement>('textbox', {
    name: 'Chat name',
  })
  expect(input).toHaveValue(title)
  expect(input).toHaveFocus()
  expect(input).toHaveAttribute('maxlength', '120')
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(title.length)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Cancel' })
  ).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(input).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /^Rename chat / })).toHaveFocus()
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})

it('publishes a trimmed header name only after an Enter save succeeds', async () => {
  let finish = (
    _: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ): void => {
    throw new Error('Expected a pending history save')
  }
  vi.mocked(commands.saveAssistantHistory).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  const messages = useAssistantStore.getState().messages
  await user.click(
    screen.getByRole('button', { name: 'Rename chat Second question' })
  )
  const input = screen.getByRole('textbox', { name: 'Chat name' })
  await user.clear(input)
  await user.type(input, '  Resonance sketch  ')
  await user.keyboard('{Enter}')
  expect(input).toBeInTheDocument()
  expect(input).toBeDisabled()
  expect(screen.getByRole('button', { name: 'New chat' })).toBeDisabled()
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
  await act(async () => finish({ status: 'ok', data: null }))
  await waitFor(() => expect(input).not.toBeInTheDocument())
  expect(useAssistantStore.getState().conversationTitles).toEqual({
    'second-chat': 'Resonance sketch',
  })
  expect(
    screen.getByRole('button', { name: 'Rename chat Resonance sketch' })
  ).toHaveFocus()
  expect(useAssistantStore.getState().messages).toBe(messages)
  expect(useAssistantStore.getState().input).toBe('Current draft')
})

it('saves a row name on blur without switching the selected chat', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await user.click(
    within(history).getByRole('button', { name: 'Rename chat First question' })
  )
  const input = within(history).getByRole('textbox', { name: 'Chat name' })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  await user.clear(input)
  await user.type(input, '  First sketch  ')
  act(() =>
    within(history).getByRole('button', { name: 'Second question' }).focus()
  )
  await waitFor(() => expect(input).not.toBeInTheDocument())
  expect(useAssistantStore.getState().conversationTitles.original).toBe(
    'First sketch'
  )
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
  expect(useAssistantStore.getState().input).toBe('Current draft')
  expect(
    within(history).getByRole('button', { name: 'Second question' })
  ).toHaveFocus()
})

it('keeps invalid names in place and protects IME Enter and Escape before two-stage cancellation', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  const row = within(history).getByRole('button', { name: 'First question' })
  const pencil = within(history).getByRole('button', {
    name: 'Rename chat First question',
  })
  expect(row).not.toContainElement(pencil)
  await user.click(pencil)
  const input = within(history).getByRole('textbox', { name: 'Chat name' })
  expect(input).toHaveValue('First question')
  await user.clear(input)
  await user.type(input, '   ')
  await user.keyboard('{Enter}')
  expect(input).toBeInTheDocument()
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'Invalid\u2028name' } })
  await user.keyboard('{Enter}')
  expect(input).toBeInTheDocument()
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
  await user.clear(input)
  await user.type(input, 'Unsubmitted name')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 })
  expect(input).toBeInTheDocument()
  expect(history).toBeInTheDocument()
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
  expect(useAssistantStore.getState().input).toBe('Current draft')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(input).not.toBeInTheDocument())
  expect(history).toBeInTheDocument()
  expect(
    within(history).getByRole('button', { name: 'Rename chat First question' })
  ).toHaveFocus()
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
  await user.keyboard('{Escape}')
  expect(history).not.toBeInTheDocument()
})

it.each(['', 'Invalid\u2028name'])(
  'cancels an invalid inline name with Escape after focus leaves the field (%j)',
  async name => {
    const user = userEvent.setup()
    render(<AssistantChats identity="project" />)
    await user.click(screen.getByRole('button', { name: 'Chats' }))
    const history = screen.getByRole('dialog', { name: 'Chats' })
    await user.click(
      within(history).getByRole('button', {
        name: 'Rename chat First question',
      })
    )
    const input = within(history).getByRole('textbox', { name: 'Chat name' })
    fireEvent.change(input, { target: { value: name } })
    const other = within(history).getByRole('button', {
      name: 'Second question',
    })
    act(() => other.focus())
    expect(other).toHaveFocus()
    expect(input).toBeInTheDocument()
    expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(input).not.toBeInTheDocument()
    expect(history).toBeInTheDocument()
    expect(
      within(history).getByRole('button', {
        name: 'Rename chat First question',
      })
    ).toHaveFocus()
    expect(useAssistantStore.getState().conversationTitles).toEqual({})
    await user.keyboard('{Escape}')
    expect(history).not.toBeInTheDocument()
  }
)

it('cancels an unsubmitted row name when history closes from outside', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await user.click(
    within(history).getByRole('button', { name: 'Rename chat First question' })
  )
  const input = within(history).getByRole('textbox', { name: 'Chat name' })
  await user.clear(input)
  await user.type(input, 'Unsubmitted name')
  const overlay = document.querySelector('[data-slot="dialog-overlay"]')
  if (!overlay) throw new Error('Expected history overlay')
  await user.click(overlay)
  expect(history).not.toBeInTheDocument()
  expect(
    screen.queryByRole('textbox', { name: 'Chat name' })
  ).not.toBeInTheDocument()
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  expect(
    screen.queryByRole('textbox', { name: 'Chat name' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'First question' })).toBeVisible()
})

it('cancels an invalid inline name when selecting another chat', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await user.click(
    within(history).getByRole('button', { name: 'Rename chat Second question' })
  )
  const input = within(history).getByRole('textbox', { name: 'Chat name' })
  await user.clear(input)
  await user.type(input, '   ')
  await user.click(
    within(history).getByRole('button', { name: 'First question' })
  )
  expect(history).not.toBeInTheDocument()
  expect(
    screen.queryByRole('textbox', { name: 'Chat name' })
  ).not.toBeInTheDocument()
  expect(useAssistantStore.getState().activeConversationId).toBeNull()
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})

it('filters custom names and returns to search when renaming removes the filtered row', async () => {
  useAssistantStore.setState({ conversationTitles: { original: 'Resonance' } })
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await user.hover(
    within(history).getByRole('button', { name: 'Search chats' })
  )
  const search = within(history).getByRole('searchbox', {
    name: 'Search chats',
  })
  await user.type(search, 'RESONANCE')
  expect(
    within(history).getByRole('button', { name: 'Resonance' })
  ).toBeVisible()
  expect(
    within(history).queryByRole('button', { name: 'Second question' })
  ).not.toBeInTheDocument()
  await user.click(
    within(history).getByRole('button', { name: 'Rename chat Resonance' })
  )
  const input = within(history).getByRole('textbox', { name: 'Chat name' })
  await user.clear(input)
  await user.type(input, 'Overtones')
  await user.keyboard('{Enter}')
  await waitFor(() => expect(input).not.toBeInTheDocument())
  expect(history).toBeInTheDocument()
  expect(
    within(history).queryByRole('button', { name: 'Resonance' })
  ).not.toBeInTheDocument()
  expect(
    within(history).queryByRole('button', { name: 'Overtones' })
  ).not.toBeInTheDocument()
  await waitFor(() => expect(search).toHaveFocus())
  expect(search).toHaveValue('RESONANCE')
  expect(useAssistantStore.getState().conversationTitles.original).toBe(
    'Overtones'
  )
  expect(useAssistantStore.getState().activeConversationId).toBe('second-chat')
  await user.clear(search)
  expect(
    within(history).getByRole('button', { name: 'Overtones' })
  ).toBeVisible()
})

it('keeps a failed inline rename for Enter retry without publishing the proposed name', async () => {
  vi.mocked(commands.saveAssistantHistory).mockResolvedValueOnce({
    status: 'error',
    error: { type: 'io' },
  })
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(
    screen.getByRole('button', { name: 'Rename chat Second question' })
  )
  const input = screen.getByRole('textbox', { name: 'Chat name' })
  await user.clear(input)
  await user.type(input, 'New sketch')
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The chat name could not be saved. Try again.'
  )
  expect(input).toHaveValue('New sketch')
  expect(input).toBeEnabled()
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
  await user.keyboard('{Enter}')
  await waitFor(() => expect(input).not.toBeInTheDocument())
  expect(useAssistantStore.getState().conversationTitles['second-chat']).toBe(
    'New sketch'
  )
  expect(commands.saveAssistantHistory).toHaveBeenCalledTimes(2)
})

it.each([
  ['an active request', { phase: 'responding' }],
  ['an unavailable history', { historyState: 'loading' }],
  ['a history operation', { historyBusy: true }],
  ['a stale history', { historySaveError: 'staleHistory' }],
] as const)('disables header renaming during %s', async (_, state) => {
  useAssistantStore.setState(state)
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  const pencil = screen.getByRole('button', {
    name: 'Rename chat Second question',
  })
  expect(pencil).toBeDisabled()
  await user.click(pencil)
  expect(
    screen.queryByRole('textbox', { name: 'Chat name' })
  ).not.toBeInTheDocument()
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})

it('disables row renaming during project planning and dismisses an old owner editor', async () => {
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  const pencil = within(history).getByRole('button', {
    name: 'Rename chat First question',
  })
  act(() => useAssistantProjectStore.setState({ planning: true }))
  expect(pencil).toBeDisabled()
  act(() => useAssistantProjectStore.setState({ planning: false }))
  await user.click(pencil)
  expect(
    within(history).getByRole('textbox', { name: 'Chat name' })
  ).toBeInTheDocument()
  act(() => useAssistantStore.setState({ owner: 'other-project' }))
  expect(
    screen.queryByRole('textbox', { name: 'Chat name' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('dialog', { name: 'Chats' })
  ).not.toBeInTheDocument()
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})

it.each(['__proto__', 'constructor', 'toString'])(
  'uses the default name for chat ID %s without an own custom title',
  async id => {
    useAssistantStore.setState(state => ({
      messages: state.messages.map(message =>
        message.id === 'second-chat' ? { ...message, id } : message
      ),
      activeConversationId: id,
    }))
    const user = userEvent.setup()
    render(<AssistantChats identity="project" />)
    expect(
      screen.getByRole('button', { name: 'Rename chat Second question' })
    ).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Chats' }))
    const history = screen.getByRole('dialog', { name: 'Chats' })
    expect(
      within(history).getByRole('button', { name: 'Second question' })
    ).toHaveAttribute('aria-pressed', 'true')
    await user.hover(
      within(history).getByRole('button', { name: 'Search chats' })
    )
    await user.type(within(history).getByRole('searchbox'), 'Second')
    expect(
      within(history).getByRole('button', { name: 'Second question' })
    ).toBeVisible()
  }
)

it('saves and displays an own custom title for a __proto__ chat ID', async () => {
  useAssistantStore.setState(state => ({
    messages: state.messages.map(message =>
      message.id === 'second-chat' ? { ...message, id: '__proto__' } : message
    ),
    activeConversationId: '__proto__',
  }))
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  const history = screen.getByRole('dialog', { name: 'Chats' })
  await user.click(
    within(history).getByRole('button', { name: 'Rename chat Second question' })
  )
  const input = within(history).getByRole('textbox', { name: 'Chat name' })
  expect(input).toHaveValue('Second question')
  await user.clear(input)
  await user.type(input, 'Prototype study')
  await user.keyboard('{Enter}')
  await waitFor(() => expect(input).not.toBeInTheDocument())
  const titles = useAssistantStore.getState().conversationTitles
  expect(Object.hasOwn(titles, '__proto__')).toBe(true)
  expect(titles['__proto__']).toBe('Prototype study')
  expect(
    within(history).getByRole('button', { name: 'Prototype study' })
  ).toHaveAttribute('aria-pressed', 'true')
  await user.keyboard('{Escape}')
  expect(
    screen.getByRole('button', { name: 'Rename chat Prototype study' })
  ).toBeEnabled()
})

it('keeps a boundary emoji intact when using the default name for a rename', async () => {
  const visibleName = `${'a'.repeat(59)}🎶`
  useAssistantStore.setState(state => ({
    messages: state.messages.map(message =>
      message.id === 'second'
        ? { ...message, text: `${visibleName} and more of the first question` }
        : message
    ),
  }))
  const user = userEvent.setup()
  render(<AssistantChats identity="project" />)
  await user.click(
    screen.getByRole('button', { name: `Rename chat ${visibleName}` })
  )
  const input = screen.getByRole('textbox', { name: 'Chat name' })
  expect(input).toHaveValue(visibleName)
  expect(input).toBeEnabled()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(input).not.toBeInTheDocument())
  expect(useAssistantStore.getState().conversationTitles['second-chat']).toBe(
    visibleName
  )
  expect(
    screen.getByRole('button', { name: `Rename chat ${visibleName}` })
  ).toHaveFocus()
})
