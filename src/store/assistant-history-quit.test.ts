import { beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { useAssistantStore } from './assistant-store'
import { useSessionStore } from './session-store'
import { quitNow, requestQuit } from './window-store'

beforeEach(async () => {
  useAssistantStore.getState().syncWorkspace(null)
  await flushAssistantHistory()
  vi.clearAllMocks()
})

it.each([requestQuit, quitNow])(
  'waits for queued history writes and cancelled status before exiting (%#)',
  async quit => {
    useAssistantStore.getState().syncWorkspace('project')
    await vi.waitFor(() =>
      expect(useAssistantStore.getState().historyState).toBe('ready')
    )
    useSessionStore.setState({ sessionStatus: 'idle' })
    useAssistantStore.setState({
      messages: [
        {
          id: 'partial',
          role: 'assistant',
          text: 'Already displayed',
          status: 'pending',
          sources: [],
          scope: 'platform',
        },
      ],
    })
    let finish!: (
      value: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
    ) => void
    vi.mocked(commands.saveAssistantHistory).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    const saving = useAssistantStore.getState().persistHistory()
    await vi.waitFor(() =>
      expect(commands.saveAssistantHistory).toHaveBeenCalled()
    )
    const quitting = quit()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect.soft(commands.quitApp).not.toHaveBeenCalled()
    finish({ status: 'ok', data: null })
    await Promise.all([saving, quitting])
    expect(commands.saveAssistantHistory).toHaveBeenLastCalledWith(
      'project',
      expect.any(String),
      [
        expect.objectContaining({
          text: 'Already displayed',
          status: 'cancelled',
        }),
      ]
    )
    expect(commands.quitApp).toHaveBeenCalledOnce()
    useAssistantStore.getState().syncWorkspace(null)
    await flushAssistantHistory()
    vi.clearAllMocks()
  }
)
