import { describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import {
  queueAssistantHistorySave,
  flushAssistantHistory,
} from './assistant-history'
import type { AssistantMessage } from './assistant-types'

describe('serialized local conversation writes (#167)', () => {
  it('captures exact message content at enqueue and continues after a failed save', async () => {
    let first!: (
      result: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
    ) => void
    vi.mocked(commands.saveAssistantHistory).mockReturnValueOnce(
      new Promise(resolve => {
        first = resolve
      })
    )
    const messages: AssistantMessage[] = [
      {
        id: 'one',
        role: 'user',
        text: 'Captured content',
        status: 'completed',
        sources: [],
        scope: 'platform',
      },
    ]
    const oldSave = queueAssistantHistorySave('owner', 'old-epoch', messages)
    const failed = expect(oldSave).rejects.toMatchObject({ code: 'io' })
    messages[0] = {
      id: 'one',
      role: 'user',
      text: 'Changed later',
      status: 'completed',
      sources: [],
      scope: 'platform',
    }
    const later = queueAssistantHistorySave('owner', 'new-epoch', messages)
    await vi.waitFor(() => expect(first).toBeDefined())
    first({ status: 'error', error: { type: 'io' } })
    await failed
    await later
    await flushAssistantHistory()
    expect(
      vi.mocked(commands.saveAssistantHistory).mock.calls.at(-2)?.[2]
    ).toEqual([expect.objectContaining({ text: 'Captured content' })])
    expect(
      vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.slice(0, 2)
    ).toEqual(['owner', 'new-epoch'])
  })
})
