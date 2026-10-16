import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import type { AssistantMessage } from '@/lib/assistant-types'
import { CreationAssistant } from './CreationAssistant'

const oldMessages: AssistantMessage[] = [
  {
    id: 'old-question',
    role: 'user',
    text: 'Earlier question',
    status: 'completed',
    scope: 'platform',
    sources: [],
  },
  {
    id: 'old-reply',
    role: 'assistant',
    text: 'Earlier answer',
    status: 'completed',
    scope: 'platform',
    sources: [],
  },
]
const resizeCallbacks = new Set<() => void>()

beforeEach(() => {
  useAssistantStore.setState({
    owner: 'scroll-owner',
    messages: oldMessages,
    phase: 'idle',
    input: '',
    error: null,
    configured: true,
    historyState: 'ready',
    historyBusy: false,
    historySaving: false,
    historyError: null,
    historySaveError: null,
    historicalMessageIds: oldMessages.map(message => message.id),
  })
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationReadingStore.getState().syncWorkspace('scroll-owner')
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: () => void
      constructor(callback: () => void) {
        this.callback = callback
      }
      observe() {
        resizeCallbacks.add(this.callback)
      }
      unobserve() {
        // This fixture releases both observations through disconnect().
      }
      disconnect() {
        resizeCallbacks.delete(this.callback)
      }
    }
  )
})
afterEach(() => {
  resizeCallbacks.clear()
  vi.unstubAllGlobals()
})

function scrollingPanel() {
  const panel = screen.getByLabelText('Discussion messages')
  const geometry = { height: 1200, viewport: 300, top: 900 }
  Object.defineProperties(panel, {
    scrollHeight: { configurable: true, get: () => geometry.height },
    clientHeight: { configurable: true, get: () => geometry.viewport },
    scrollTop: {
      configurable: true,
      get: () => geometry.top,
      set: (value: number) => {
        geometry.top = Math.max(
          0,
          Math.min(value, geometry.height - geometry.viewport)
        )
      },
    },
  })
  return { panel, geometry }
}

function newQuestion() {
  useAssistantStore.setState({
    phase: 'reading',
    messages: [
      ...oldMessages,
      {
        id: 'new-question',
        role: 'user',
        text: 'New question',
        status: 'pending',
        scope: 'platform',
        sources: [],
      },
      {
        id: 'new-reply',
        role: 'assistant',
        text: '',
        status: 'pending',
        scope: 'platform',
        sources: [],
      },
    ],
  })
}
function streamedText(text: string) {
  useAssistantStore.setState(state => ({
    phase: 'responding',
    messages: state.messages.map(message =>
      message.id === 'new-reply' ? { ...message, text } : message
    ),
  }))
}

it('reveals a newly sent question immediately, follows the reply, and respects manual history reading', async () => {
  render(<CreationAssistant identity="scroll-owner" />)
  const { panel, geometry } = scrollingPanel()
  panel.scrollTop = 100
  fireEvent.scroll(panel)
  geometry.height = 1600
  act(newQuestion)
  expect(panel.scrollTop).toBe(1300)
  geometry.height = 1800
  act(() => streamedText('First streamed words'))
  expect(panel.scrollTop).toBe(1500)
  panel.scrollTop = 400
  fireEvent.scroll(panel)
  geometry.height = 2200
  act(() => streamedText('More streamed words'))
  expect(panel.scrollTop).toBe(400)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'View latest messages' }))
  expect(panel.scrollTop).toBe(1900)
  expect(panel).toHaveFocus()
  geometry.height = 2500
  act(() => streamedText('The reply continues'))
  expect(panel.scrollTop).toBe(2200)
})

it('keeps explicit message navigation ahead of following and preserves paused reading across surfaces', () => {
  render(<CreationAssistant identity="scroll-owner" />)
  const { panel, geometry } = scrollingPanel()
  const earlier = screen.getByText('Earlier answer').closest('article')
  if (!earlier) throw new Error('Expected earlier reply')
  const targetScroll = vi
    .spyOn(earlier, 'scrollIntoView')
    .mockImplementation(() => {
      panel.scrollTop = 100
    })
  act(() => useCreationReadingStore.getState().showDiscussion('old-reply'))
  expect(targetScroll).toHaveBeenCalledOnce()
  expect(earlier).toHaveFocus()
  geometry.height = 1600
  act(() =>
    useAssistantStore.setState(state => ({
      messages: [
        ...state.messages,
        {
          id: 'late-reply',
          role: 'assistant',
          text: 'Later text',
          status: 'pending',
          scope: 'platform',
          sources: [],
        },
      ],
    }))
  )
  expect(panel.scrollTop).toBe(100)
  act(() => useCreationReadingStore.getState().showFile())
  geometry.height = 1900
  act(() => {
    for (const callback of resizeCallbacks) callback()
  })
  expect(panel.scrollTop).toBe(100)
  act(() => useCreationReadingStore.getState().showDiscussion())
  expect(panel.scrollTop).toBe(100)
  geometry.height = 2300
  act(newQuestion)
  expect(panel.scrollTop).toBe(2000)
  targetScroll.mockRestore()
})

it('keeps following through history restoration and resized content without moving a paused reader', () => {
  useAssistantStore.setState({ messages: [], historicalMessageIds: [] })
  render(<CreationAssistant identity="scroll-owner" />)
  const { panel, geometry } = scrollingPanel()
  panel.scrollTop = 0
  act(() =>
    useAssistantStore.setState({
      messages: oldMessages,
      historicalMessageIds: oldMessages.map(message => message.id),
    })
  )
  expect(panel.scrollTop).toBe(900)
  geometry.height = 1500
  act(() => {
    for (const callback of resizeCallbacks) callback()
  })
  expect(panel.scrollTop).toBe(1200)
  panel.scrollTop = 200
  fireEvent.scroll(panel)
  geometry.viewport = 200
  act(() => {
    for (const callback of resizeCallbacks) callback()
  })
  expect(panel.scrollTop).toBe(200)
  panel.scrollTop = geometry.height - geometry.viewport
  fireEvent.scroll(panel)
  geometry.height = 1800
  act(() => {
    for (const callback of resizeCallbacks) callback()
  })
  expect(panel.scrollTop).toBe(1600)
})
