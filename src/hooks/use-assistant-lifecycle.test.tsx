import { expect, it, vi } from 'vitest'
import { act, renderHook } from '@/test/test-utils'
import { commands, events } from '@/lib/tauri-bindings'
import { useAssistantStore } from '@/store/assistant-store'
import { cleanupCreationParticipants } from '@/lib/creation-lifecycle'
import { useAssistantLifecycle } from './use-assistant-lifecycle'

it('native configuration changes and runtime cleanup revoke pending work while retaining the discussion', async () => {
  let changed!: Parameters<
    typeof events.modelConfigurationChangedEvent.listen
  >[0]
  const unlisten = vi.fn()
  const subscription = vi
    .spyOn(events.modelConfigurationChangedEvent, 'listen')
    .mockImplementation(async callback => {
      changed = callback
      return unlisten
    })
  const { unmount } = renderHook(() => useAssistantLifecycle())
  useAssistantStore.setState({
    owner: 'owner',
    historyState: 'ready',
    historyEpoch: 'epoch',
    historyBusy: false,
    historySaveError: null,
    input: 'Keep this input',
    phase: 'responding',
    messages: [
      {
        id: 'partial',
        role: 'assistant',
        text: 'Already produced',
        status: 'pending',
        sources: [],
        scope: 'platform',
      },
    ],
  })
  await act(async () =>
    changed({ event: 'model-configuration-changed-event', id: 1, payload: {} })
  )
  expect(useAssistantStore.getState().phase).toBe('idle')
  expect(useAssistantStore.getState().input).toBe('Keep this input')
  expect(useAssistantStore.getState().messages).toEqual([
    expect.objectContaining({ text: 'Already produced', status: 'cancelled' }),
  ])
  await act(async () => cleanupCreationParticipants())
  expect(useAssistantStore.getState().messages).toHaveLength(1)
  expect(useAssistantStore.getState().input).toBe('Keep this input')
  unmount()
  await Promise.resolve()
  expect(unlisten).toHaveBeenCalledOnce()
  subscription.mockRestore()
  useAssistantStore.getState().syncWorkspace(null)
})

it('keeps an unsaved transcript in its workspace when cleanup cannot publish it', async () => {
  useAssistantStore.setState({
    owner: 'owner',
    historyState: 'ready',
    historyEpoch: 'epoch',
    historyBusy: false,
    historySaveError: null,
    messages: [
      {
        id: 'unpublished',
        role: 'assistant',
        text: 'Keep this result in memory',
        status: 'completed',
        sources: [],
        scope: 'platform',
      },
    ],
  })
  vi.mocked(commands.saveAssistantHistory).mockResolvedValueOnce({
    status: 'error',
    error: { type: 'tooLarge' },
  })
  const { unmount } = renderHook(() => useAssistantLifecycle())
  await expect(cleanupCreationParticipants()).rejects.toMatchObject({
    code: 'tooLarge',
  })
  expect(useAssistantStore.getState().messages[0]?.text).toBe(
    'Keep this result in memory'
  )
  unmount()
  useAssistantStore.getState().syncWorkspace(null)
})
