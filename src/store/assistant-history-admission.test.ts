import { afterEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationStore } from '@/store/creation-store'
import { useAssistantProposalStore } from '@/store/assistant-proposal-store'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { HELP_BOOKS } from '@/lib/help-corpus'
import * as flow from '@/lib/assistant-flow'

afterEach(() => vi.restoreAllMocks())

it.each(['saved', 'tooLarge'] as const)(
  'waits for a late old-proposal reload snapshot before paid work (%s)',
  async outcome => {
    useAssistantStore.getState().syncWorkspace(null)
    await flushAssistantHistory()
    vi.clearAllMocks()
    const config = { model: 'chosen', baseUrl: 'https://model.example/v1' }
    vi.mocked(commands.saveAssistantHistory).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: 'owner',
          root: '/score',
          name: 'Score',
          source: 'folder',
        },
        files: [
          { path: 'score.js', kind: 'text', category: 'pages', size: 10 },
        ],
      },
    })
    await vi.waitFor(() =>
      expect(useAssistantStore.getState().historyState).toBe('ready')
    )
    useAssistantStore.setState({
      configured: true,
      modelConfig: config,
      input: 'An earlier request',
    })
    vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
      status: 'ok',
      data: {
        fingerprint: 'saved',
        files: [{ path: 'score.js', version: 'v1', bytes: 10, reason: null }],
      },
    })
    vi.mocked(commands.helpCorpus).mockResolvedValue({
      status: 'ok',
      data: HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\nDocumentation.`,
        }))
      ),
    })
    vi.mocked(commands.beginAssistantRequest).mockImplementation(
      async (_owner, requestId) => ({
        status: 'ok',
        data: {
          requestId,
          model: config.model,
          baseUrl: config.baseUrl,
          config,
        },
      })
    )
    vi.mocked(commands.assistantModelTurn).mockResolvedValue({
      status: 'ok',
      data: {
        text: null,
        toolCalls: [
          {
            id: 'answer',
            name: 'complete_discussion',
            arguments: JSON.stringify({ answer: 'New answer' }),
          },
        ],
      },
    })
    vi.spyOn(flow, 'runAssistantRequest').mockResolvedValueOnce({
      text: 'A previous completed task with live controls',
      sources: [],
      proposals: [
        {
          id: 'old-controls',
          taskId: 'finished-task',
          path: 'score.js',
          version: 'v1',
          sourceText: 'saved',
          text: 'saved',
          parameters: [],
          binding: null,
        },
      ],
    })
    await useAssistantStore.getState().send()
    await flushAssistantHistory()
    expect(
      useAssistantProposalStore.getState().items['old-controls']
    ).toBeDefined()
    vi.mocked(commands.beginAssistantRequest).mockClear()
    vi.mocked(commands.assistantModelTurn).mockClear()

    type Result = Awaited<ReturnType<typeof commands.saveAssistantHistory>>
    let first: (result: Result) => void = () => {
      throw new Error('First save has not started')
    }
    let later: (result: Result) => void = () => {
      throw new Error('Later save has not started')
    }
    let calls = 0
    vi.mocked(commands.saveAssistantHistory).mockImplementation(() => {
      calls++
      if (calls === 1)
        return new Promise(resolve => {
          first = resolve
        })
      if (calls === 2)
        return new Promise(resolve => {
          later = resolve
        })
      return Promise.resolve(
        outcome === 'saved'
          ? { status: 'ok', data: null }
          : { status: 'error', error: { type: 'tooLarge' } }
      )
    })
    useAssistantStore.getState().setInput('A new paid request')
    const sending = useAssistantStore.getState().send()
    await vi.waitFor(() => expect(calls).toBe(1))
    expect(useAssistantStore.getState().phase).toBe('reading')

    // This is the real old proposal's reload path, reachable through its
    // unconditionally available reload-source action during a later request.
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'ok',
      data: {
        kind: 'text',
        version: 'v2',
        text: 'new saved source that exhausts remaining space',
      },
    })
    await useAssistantProposalStore.getState().reload('old-controls')
    expect(
      useAssistantStore.getState().messages[1]?.proposals?.[0]?.text
    ).toContain('exhausts remaining space')
    first({ status: 'ok', data: null })
    await vi.waitFor(() => expect(calls).toBe(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    const callsBeforeLatestSave = vi.mocked(commands.beginAssistantRequest).mock
      .calls.length
    later(
      outcome === 'saved'
        ? { status: 'ok', data: null }
        : { status: 'error', error: { type: 'tooLarge' } }
    )
    await sending
    await flushAssistantHistory()
    expect(useAssistantStore.getState().historySaveError).toBe(
      outcome === 'saved' ? null : 'tooLarge'
    )
    expect(
      useAssistantStore.getState().messages[1]?.proposals?.[0]?.text
    ).toContain('exhausts remaining space')
    expect(callsBeforeLatestSave).toBe(0)
    if (outcome === 'saved') {
      expect(commands.beginAssistantRequest).toHaveBeenCalledOnce()
      expect(useAssistantStore.getState().messages.at(-1)?.text).toBe(
        'New answer'
      )
    } else {
      expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
      expect(useAssistantStore.getState().messages).toHaveLength(2)
      expect(useAssistantStore.getState().input).toBe('A new paid request')
    }
  }
)
