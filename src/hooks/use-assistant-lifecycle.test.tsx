import { expect, it, vi } from 'vitest'
import { act, renderHook } from '@/test/test-utils'
import { events } from '@/lib/tauri-bindings'
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
