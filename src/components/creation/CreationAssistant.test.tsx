import { modelProfileKey } from '@/lib/model-context-settings'
import { materialPageSource } from '@/lib/assistant-materials'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'
import { AssistantOrganizationRules } from './AssistantOrganizationRules'
import { useAssistantHandoffStore } from '@/store/assistant-handoff-store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { TextBuffer } from '@/lib/text-buffer'
import { editText } from '@/test/text-editor'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { commands, events } from '@/lib/tauri-bindings'
import { HELP_BOOKS } from '@/lib/help-corpus'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { CreationView } from './CreationView'
import { useAssistantStore } from '@/store/assistant-store'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { CreationAssistant } from './CreationAssistant'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useCreationMaterialsStore } from '@/store/creation-materials-store'
import { useSettingsStore } from '@/store/settings-store'
import i18n from '@/i18n/config'
import {
  AssistantProposalCard,
  type AssistantProposal,
} from './AssistantProposalCard'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
    status: 'ok',
    data: { fingerprint: 'empty', files: [] },
  })
  vi.mocked(commands.listCreationMaterials).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  useCreationMaterialsStore.getState().close()
  vi.mocked(commands.helpCorpus).mockResolvedValue({
    status: 'ok',
    data: HELP_BOOKS.flatMap(book =>
      book.documentIds.map(id => ({
        id,
        path: `${id}.md`,
        markdown: `# ${id}\n\nInstalled contract.`,
      }))
    ),
  })
  useAssistantProjectStore.getState().syncWorkspace(null)
  useAssistantProjectStore.getState().syncWorkspace('assistant-test')
  useCreationStore.setState({
    active: true,
    opening: false,
    modePhase: 'idle',
    error: null,
    workspace: {
      project: {
        identity: 'assistant-test',
        root: '/draft',
        name: 'Draft',
        source: 'folder',
      },
      files: [{ path: 'score.js', kind: 'text', category: 'pages', size: 10 }],
    },
  })
  useCreationFilesStore.getState().clear()
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationReadingStore.getState().syncWorkspace('assistant-test')
  useAssistantStore.getState().stop()
  await useAssistantStore.getState().retryHistory()
  useAssistantStore.setState({
    owner: 'assistant-test',
    input: '',
    messages: [],
    phase: 'idle',
    error: null,
    configured: false,
  })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: 'const saved = 1', version: 'v1' },
  })
})

describe('creation discussion reading (#166)', () => {
  it.each(['en', 'zh-CN'])(
    'reads selected project and private rules before the %s paid request and leaves unrelated sources unread',
    async locale => {
      await i18n.changeLanguage(locale)
      const user = userEvent.setup()
      const document = {
        path: 'docs/rules.md',
        version: 'rules-v1',
        bytes: 15,
        reason: null,
      }
      const privateRule = {
        id: 'e'.repeat(32),
        name: 'private-rules.txt',
        version: 'f'.repeat(64),
        size: 24,
        totalCharacters: 24,
      }
      useAssistantStore.setState({
        mode: 'discussion',
        configured: true,
        canContinue: false,
        paused: false,
        modelConfig: {
          model: 'test-model',
          baseUrl: 'https://model.example/v1',
        },
      })
      vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
        status: 'ok',
        data: {
          fingerprint: 'rule-files',
          files: [document, { ...document, path: 'docs/unselected.md' }],
        },
      })
      vi.mocked(commands.listCreationMaterials).mockResolvedValue({
        status: 'ok',
        data: [privateRule],
      })
      vi.mocked(commands.assistantProjectRead).mockResolvedValue({
        status: 'ok',
        data: {
          path: document.path,
          version: document.version,
          text: 'Retain pulse 0.125.',
          offset: 0,
          endOffset: 19,
          totalCharacters: 19,
          nextOffset: null,
          startLine: 1,
          endLine: 1,
        },
      })
      vi.mocked(commands.readCreationMaterial).mockResolvedValue({
        status: 'ok',
        data: {
          material: privateRule,
          text: 'Keep sound.scd unchanged',
          offset: 0,
          endOffset: 24,
          totalCharacters: 24,
          nextOffset: null,
          startLine: 1,
          endLine: 1,
        },
      })
      vi.mocked(commands.beginAssistantRequest).mockImplementationOnce(
        async (_, requestId) => ({
          status: 'ok',
          data: {
            requestId,
            model: 'test-model',
            baseUrl: 'https://model.example/v1',
            config: {
              model: 'test-model',
              baseUrl: 'https://model.example/v1',
            },
          },
        })
      )
      vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
        status: 'ok',
        data: { text: 'No safe changes needed.', toolCalls: [] },
      })
      render(
        <>
          <CreationAssistant identity="assistant-test" />
          <AssistantOrganizationRules
            identity="assistant-test"
            conversationId={null}
            disabled={false}
          />
        </>
      )
      const trigger = screen.getByRole('button', {
        name: i18n.t('assistant.organization.rules.open'),
      })
      trigger.focus()
      await user.keyboard('{Enter}')
      await user.click(
        await screen.findByRole('checkbox', { name: 'docs/rules.md' })
      )
      await user.click(
        screen.getByRole('checkbox', { name: 'private-rules.txt' })
      )
      await user.click(
        screen.getByRole('button', {
          name: i18n.t('assistant.organization.rules.start'),
        })
      )
      await vi.waitFor(() =>
        expect(commands.assistantModelTurn).toHaveBeenCalled()
      )
      await vi.waitFor(() =>
        expect(useAssistantStore.getState().phase).toBe('idle')
      )
      const packet =
        vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1] ?? []
      expect(
        packet.some(message => message.content?.includes('Retain pulse 0.125.'))
      ).toBe(true)
      expect(
        packet.some(message =>
          message.content?.includes('Keep sound.scd unchanged')
        )
      ).toBe(true)
      expect(
        vi
          .mocked(commands.assistantProjectRead)
          .mock.calls.every(
            ([, read]) =>
              read.path === 'docs/rules.md' && read.version === 'rules-v1'
          )
      ).toBe(true)
      const sources =
        useAssistantStore
          .getState()
          .messages.find(message => message.role === 'assistant')?.sources ?? []
      expect(
        sources.some(source => source.project?.path === 'docs/rules.md')
      ).toBe(true)
      expect(
        sources.some(source => source.material?.material.id === privateRule.id)
      ).toBe(true)
      await i18n.changeLanguage('en')
    }
  )
  it('submits supplemental organization text through the same edit request without consuming the composer', async () => {
    useAssistantStore.setState({
      mode: 'discussion',
      configured: true,
      canContinue: false,
      paused: false,
      modelConfig: { model: 'test-model', baseUrl: 'https://model.example/v1' },
      input: 'Unsent independent idea',
    })
    vi.mocked(commands.beginAssistantRequest).mockImplementationOnce(
      async (_, requestId) => ({
        status: 'ok',
        data: {
          requestId,
          model: 'test-model',
          baseUrl: 'https://model.example/v1',
          config: { model: 'test-model', baseUrl: 'https://model.example/v1' },
        },
      })
    )
    vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
      status: 'ok',
      data: { text: 'No changes required.', toolCalls: [] },
    })
    const user = userEvent.setup()
    render(
      <>
        <CreationAssistant identity="assistant-test" />
        <AssistantOrganizationRules
          key="assistant-test"
          identity="assistant-test"
          conversationId={null}
          disabled={false}
        />
      </>
    )
    await user.click(
      screen.getByRole('button', { name: 'Organize with rules' })
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Additional rules for this task' }),
      'Keep sound.scd unchanged; use scores for scripts.'
    )
    await user.click(screen.getByRole('button', { name: 'Start organization' }))
    await vi.waitFor(() =>
      expect(commands.assistantModelTurn).toHaveBeenCalled()
    )
    await vi.waitFor(() =>
      expect(useAssistantStore.getState().phase).toBe('idle')
    )
    const packet = vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1]
    expect(packet).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining(
            'Keep sound.scd unchanged; use scores for scripts.'
          ),
        }),
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Mode: edit'),
        }),
      ])
    )
    expect(useAssistantStore.getState().input).toBe('Unsent independent idea')
    expect(
      useAssistantStore.getState().messages.find(item => item.role === 'user')
        ?.text
    ).toContain('PNDS default organization rules')
  })

  it('captures selected rules before preparation can pause and ignores later caller changes on Continue', async () => {
    useAssistantStore.setState({
      mode: 'discussion',
      configured: true,
      canContinue: false,
      paused: false,
      modelConfig: { model: 'test-model', baseUrl: 'https://model.example/v1' },
      input: 'Unsent idea',
    })
    const snapshot = {
      fingerprint: 'rules',
      files: [
        {
          path: 'docs/rules.md',
          version: 'initial-rules',
          bytes: 10,
          reason: null,
        },
      ],
    }
    const selection = {
      text: 'Keep the artwork.',
      sources: [
        {
          kind: 'project' as const,
          path: 'docs/rules.md',
          version: 'initial-rules',
        },
      ],
    }
    let finish!: (
      value: Awaited<ReturnType<typeof commands.assistantProjectInventory>>
    ) => void
    vi.mocked(commands.assistantProjectInventory)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve
          })
      )
      .mockResolvedValue({ status: 'ok', data: snapshot })
    vi.mocked(commands.assistantProjectRead).mockResolvedValue({
      status: 'ok',
      data: {
        path: 'docs/rules.md',
        version: 'initial-rules',
        text: 'Keep seed.',
        offset: 0,
        endOffset: 10,
        totalCharacters: 10,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      },
    })
    vi.mocked(commands.beginAssistantRequest).mockImplementationOnce(
      async (_, requestId) => ({
        status: 'ok',
        data: {
          requestId,
          model: 'test-model',
          baseUrl: 'https://model.example/v1',
          config: { model: 'test-model', baseUrl: 'https://model.example/v1' },
        },
      })
    )
    vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
      status: 'ok',
      data: { text: 'No changes needed.', toolCalls: [] },
    })
    const pending = useAssistantStore.getState().organizeProject(selection)
    expect(useAssistantStore.getState().phase).toBe('reading')
    useAssistantStore.getState().pause()
    for (const source of selection.sources)
      source.version = 'later-caller-rules'
    finish({ status: 'ok', data: snapshot })
    await pending
    await useAssistantStore.getState().send(false, true)
    expect(useAssistantStore.getState().error).toBeNull()
    expect(commands.assistantProjectRead).toHaveBeenCalledWith(
      'assistant-test',
      expect.objectContaining({
        path: 'docs/rules.md',
        version: 'initial-rules',
      })
    )
    const packet =
      vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1] ?? []
    expect(
      packet.some(message => message.content?.includes('Keep seed.'))
    ).toBe(true)
    expect(
      packet.some(message => message.content?.includes('later-caller-rules'))
    ).toBe(false)
    expect(useAssistantStore.getState().input).toBe('Unsent idea')
  })

  it('dismisses a rules dialog on a project switch and fences its late source catalog', async () => {
    useAssistantStore.setState({
      mode: 'discussion',
      configured: true,
      canContinue: false,
      paused: false,
      modelConfig: { model: 'test-model', baseUrl: 'https://model.example/v1' },
    })
    let finish!: (
      value: Awaited<ReturnType<typeof commands.assistantProjectInventory>>
    ) => void
    vi.mocked(commands.assistantProjectInventory).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const user = userEvent.setup()
    const { rerender } = render(
      <>
        <CreationAssistant identity="assistant-test" />
        <AssistantOrganizationRules
          key="assistant-test"
          identity="assistant-test"
          conversationId={null}
          disabled={false}
        />
      </>
    )
    await user.click(
      screen.getByRole('button', { name: 'Organize with rules' })
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Additional rules for this task' }),
      'Rules for the old project'
    )
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'other-project',
          root: '/other',
          source: 'folder',
          name: 'Other',
        },
        files: [],
      },
    })
    rerender(
      <>
        <CreationAssistant identity="other-project" />
        <AssistantOrganizationRules
          key="other-project"
          identity="other-project"
          conversationId={null}
          disabled={false}
        />
      </>
    )
    finish({
      status: 'ok',
      data: {
        fingerprint: 'old',
        files: [
          { path: 'private-old.md', version: 'v1', bytes: 20, reason: null },
        ],
      },
    })
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(screen.queryByText('private-old.md')).not.toBeInTheDocument()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  })
  it('keeps unsent text and selections isolated when organization pauses during preparation and continues', async () => {
    useAssistantStore.setState({
      mode: 'discussion',
      configured: true,
      canContinue: false,
      paused: false,
      modelConfig: { model: 'test-model', baseUrl: 'https://model.example/v1' },
      input: 'Unsent creative idea',
    })
    useAssistantProjectStore.setState({
      attachments: [
        {
          identity: 'assistant-test',
          buffer: new TextBuffer('Unsent selection', 'score.js'),
          document: 'Unsent selection',
          baseVersion: 'v1',
          diskVersionAtCapture: 'v1',
          inventoryAtCapture: null,
          snapshot: {
            id: 'paused-unsent-selection',
            projectKey: 'project',
            path: 'score.js',
            startLine: 1,
            endLine: 1,
            source: 'saved',
            version: 'v1',
            text: 'Unsent selection',
          },
        },
      ],
    })
    vi.mocked(commands.beginAssistantRequest).mockImplementationOnce(
      async (_, requestId) => ({
        status: 'ok',
        data: {
          requestId,
          model: 'test-model',
          baseUrl: 'https://model.example/v1',
          config: { model: 'test-model', baseUrl: 'https://model.example/v1' },
        },
      })
    )
    vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
      status: 'ok',
      data: { text: 'No safe structural changes needed.', toolCalls: [] },
    })
    let finish: (
      value: Awaited<ReturnType<typeof commands.assistantProjectInventory>>
    ) => void = () => undefined
    vi.mocked(commands.assistantProjectInventory).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const starting = useAssistantStore.getState().organizeProject()
    expect(useAssistantStore.getState().phase).toBe('reading')
    useAssistantStore.getState().pause()
    finish({ status: 'ok', data: { files: [], fingerprint: 'paused' } })
    await starting
    expect(useAssistantStore.getState().input).toBe('Unsent creative idea')
    expect(useAssistantStore.getState().canContinue).toBe(true)
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    await useAssistantStore.getState().send(false, true)
    expect(useAssistantStore.getState().error).toBeNull()
    expect(commands.assistantModelTurn).toHaveBeenCalledOnce()
    const continued = vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1]
    expect(continued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          contextKind: 'input',
          content: expect.stringContaining('PNDS default organization rules'),
        }),
      ])
    )
    expect(
      continued?.some(message => message.content?.includes('Unsent selection'))
    ).toBe(false)
    expect(
      useAssistantStore
        .getState()
        .messages.find(message => message.role === 'user')?.attachments
    ).toBeUndefined()
    expect(
      useAssistantProjectStore.getState().attachments[0]?.snapshot.id
    ).toBe('paused-unsent-selection')
    expect(useAssistantStore.getState().input).toBe('Unsent creative idea')
  })
  it('continues the original organization goal after a network failure while retaining a different unsent idea', async () => {
    const user = userEvent.setup()
    useAssistantStore.setState({
      mode: 'discussion',
      configured: true,
      canContinue: false,
      paused: false,
      modelConfig: { model: 'test-model', baseUrl: 'https://model.example/v1' },
      input: 'My unsent new work',
    })
    vi.mocked(commands.beginAssistantRequest)
      .mockImplementationOnce(async (_, requestId) => ({
        status: 'ok',
        data: {
          requestId,
          model: 'test-model',
          baseUrl: 'https://model.example/v1',
          config: { model: 'test-model', baseUrl: 'https://model.example/v1' },
        },
      }))
      .mockImplementationOnce(async (_, requestId) => ({
        status: 'ok',
        data: {
          requestId,
          model: 'test-model',
          baseUrl: 'https://model.example/v1',
          config: { model: 'test-model', baseUrl: 'https://model.example/v1' },
        },
      }))
    vi.mocked(commands.assistantModelTurn)
      .mockResolvedValueOnce({ status: 'error', error: { type: 'network' } })
      .mockResolvedValueOnce({
        status: 'ok',
        data: { text: 'No safe changes needed.', toolCalls: [] },
      })
    render(<CreationAssistant identity="assistant-test" />)
    act(() => {
      void useAssistantStore.getState().organizeProject()
    })
    await act(async () => {
      await vi.waitFor(() =>
        expect(useAssistantStore.getState().canContinue).toBe(true)
      )
    })
    expect(
      screen.queryByRole('button', { name: 'Organize project' })
    ).not.toBeInTheDocument()
    await act(async () => {
      await useAssistantStore.getState().organizeProject()
    })
    expect(commands.beginAssistantRequest).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Continue task' }))
    await act(async () => {
      await vi.waitFor(() =>
        expect(commands.assistantModelTurn).toHaveBeenCalledTimes(2)
      )
    })
    const continued = vi.mocked(commands.assistantModelTurn).mock.calls[1]?.[1]
    expect(continued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          contextKind: 'input',
          content: expect.stringContaining('PNDS default organization rules'),
        }),
      ])
    )
    expect(
      continued?.some(message => message.content === 'My unsent new work')
    ).toBe(false)
    expect(useAssistantStore.getState().input).toBe('My unsent new work')
  })
  it.each(['en', 'zh-CN'])(
    'starts default organization in %s through the task entry and preserves the unsent composer',
    async locale => {
      await i18n.changeLanguage(locale)
      useAssistantStore.setState({
        mode: 'discussion',
        configured: true,
        modelConfig: {
          model: 'test-model',
          baseUrl: 'https://model.example/v1',
        },
        input: 'An unrelated unsent idea',
        canContinue: false,
        paused: false,
      })
      vi.mocked(commands.beginAssistantRequest).mockImplementationOnce(
        async (_, requestId) => ({
          status: 'ok',
          data: {
            requestId,
            model: 'test-model',
            baseUrl: 'https://model.example/v1',
            config: {
              model: 'test-model',
              baseUrl: 'https://model.example/v1',
            },
          },
        })
      )
      vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
        status: 'ok',
        data: { text: 'No safe structural changes are needed.', toolCalls: [] },
      })
      vi.mocked(commands.beginCreationAssistantTask).mockResolvedValueOnce({
        status: 'ok',
        data: { id: 'organization-task', mode: 'edit', files: [] },
      })
      useAssistantProjectStore.setState({
        attachments: [
          {
            identity: 'assistant-test',
            buffer: new TextBuffer('Unsent source', 'score.js'),
            document: 'Unsent source',
            baseVersion: 'v1',
            diskVersionAtCapture: 'v1',
            inventoryAtCapture: null,
            snapshot: {
              id: 'unsent-selection',
              projectKey: 'project',
              path: 'score.js',
              startLine: 1,
              endLine: 1,
              source: 'saved',
              version: 'v1',
              text: 'Unsent source',
            },
          },
        ],
      })
      render(<CreationAssistant identity="assistant-test" />)
      act(() => {
        void useAssistantStore.getState().organizeProject()
      })
      await act(async () => {
        await vi.waitFor(() =>
          expect(useAssistantStore.getState().error).toBeNull()
        )
        await vi.waitFor(() =>
          expect(commands.assistantModelTurn).toHaveBeenCalled()
        )
        await vi.waitFor(() =>
          expect(useAssistantStore.getState().phase).toBe('idle')
        )
      })
      expect(commands.assistantModelTurn).toHaveBeenCalled()
      const messages = vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1]
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining(
              locale === 'en'
                ? 'PNDS default organization rules'
                : 'PNDS 默认整理规范'
            ),
          }),
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('Mode: edit'),
          }),
        ])
      )
      expect(useAssistantStore.getState().mode).toBe('edit')
      expect(
        screen.getByRole('textbox', { name: i18n.t('assistant.input') })
      ).toHaveValue('An unrelated unsent idea')
      expect(
        useAssistantProjectStore.getState().attachments[0]?.snapshot.id
      ).toBe('unsent-selection')
      expect(
        useAssistantStore
          .getState()
          .messages.find(message => message.role === 'user')?.attachments
      ).toBeUndefined()
      expect(
        messages?.some(message => message.content?.includes('Unsent source'))
      ).toBe(false)
      expect(commands.getCreationModules).not.toHaveBeenCalled()
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  )
  it('opens a real private material source and retains its labelled request snapshot', async () => {
    const material = {
      id: 'a'.repeat(32),
      name: 'Pattern.js',
      version: 'b'.repeat(64),
      size: 4,
      totalCharacters: 4,
    }
    useAssistantStore.setState({
      messages: [
        {
          id: 'material-reply',
          role: 'assistant',
          text: 'Read pattern.',
          status: 'completed',
          scope: 'project',
          sources: [
            {
              docId: material.id,
              sectionId: 'L1',
              title: 'Pattern.js:1–1',
              locale: 'en',
              version: material.version,
              offset: 0,
              endOffset: 4,
              totalCharacters: 4,
              format: 'plainText',
              material: {
                material,
                text: 'page',
                offset: 0,
                endOffset: 4,
                totalCharacters: 4,
                nextOffset: null,
                startLine: 1,
                endLine: 1,
              },
            },
          ],
        },
      ],
    })
    render(<CreationAssistant identity="assistant-test" />)
    await userEvent.click(screen.getByText('Consulted sources (1)'))
    await userEvent.click(
      screen.getByRole('button', { name: /Pattern\.js:1–1/ })
    )
    expect(useCreationMaterialsStore.getState().request).toEqual({
      identity: 'assistant-test',
      id: material.id,
      version: material.version,
    })
    await userEvent.click(
      screen.getByText(
        'View the pending document snapshot used in this request'
      )
    )
    expect(screen.getByText('page')).toBeVisible()
    expect(commands.assistantProjectRead).not.toHaveBeenCalled()
  })
  it('labels a resumable interruption as Continue task and retires it when the question changes', async () => {
    const user = userEvent.setup()
    useAssistantStore.setState({
      configured: true,
      input: 'Original question',
      error: 'requestDeadline',
      canContinue: true,
    })
    render(<CreationAssistant identity="assistant-test" />)
    expect(screen.getByRole('button', { name: 'Continue task' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'previous app time limit'
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Ask the assistant' }),
      ' edited'
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Continue task' })
    ).not.toBeInTheDocument()
  })

  it('reads the whole project on explicit action without a sending confirmation (#170)', async () => {
    const user = userEvent.setup()
    useAssistantStore.setState({
      configured: true,
      modelConfig: {
        model: 'whole-model',
        baseUrl: 'https://model.example/v1',
      },
      input: 'Read all saved files',
    })
    vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
      status: 'ok',
      data: { files: [], fingerprint: 'empty' },
    })
    render(<CreationAssistant identity="assistant-test" />)
    expect(
      screen.queryByRole('checkbox', { name: 'Read current project' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Read whole project' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Context:/ }))
    await user.click(screen.getByRole('button', { name: 'Read whole project' }))
    await vi.waitFor(() => {
      expect(
        useAssistantProjectStore.getState().whole?.error ?? null
      ).toBeNull()
      expect(commands.beginAssistantRequest).toHaveBeenCalled()
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
  })
  it('captures a selected pending suggestion with proposal identity and candidate revision (#225)', async () => {
    const buffer = new TextBuffer(
      'const label = "new";\n// not selected',
      'score.js'
    )
    buffer.select(0, 20)
    vi.mocked(commands.assistantProjectRead).mockResolvedValue({
      status: 'ok',
      data: {
        path: 'score.js',
        version: 'v1',
        text: 'saved',
        offset: 0,
        endOffset: 5,
        totalCharacters: 5,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      },
    })
    const onApply = vi.fn()
    const onPreview = vi.fn()
    render(
      <AssistantProposalCard
        proposal={{
          id: 'suggestion-1',
          messageId: 'reply',
          identity: 'assistant-test',
          source: { path: 'score.js', version: 'v1' },
          candidate: { revision: 7, text: buffer.text },
          preview: 'none',
          pendingRefresh: false,
          appliedDiff: null,
        }}
        parameters={null}
        buffer={buffer}
        onCodeChange={() => undefined}
        onApply={onApply}
        onPreview={onPreview}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discuss selection' }))
    await vi.waitFor(() =>
      expect(useAssistantProjectStore.getState().attachments).toHaveLength(1)
    )
    expect(
      useAssistantProjectStore.getState().attachments[0]?.snapshot
    ).toMatchObject({
      source: 'proposal',
      proposalId: 'suggestion-1',
      candidateRevision: 7,
      sourceVersion: 'v1',
      text: 'const label = "new";',
    })
    expect(onApply).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  })
  it('sends with saved-project access by default and no content confirmation (#168)', async () => {
    const user = userEvent.setup()
    useAssistantStore.setState({
      configured: true,
      modelConfig: { model: 'test-model', baseUrl: 'https://model.example/v1' },
    })
    render(<CreationAssistant identity="assistant-test" />)
    expect(
      screen.queryByRole('checkbox', { name: 'Read current project' })
    ).not.toBeInTheDocument()
    await user.type(
      screen.getByRole('textbox', { name: 'Ask the assistant' }),
      'Explain the saved score{Enter}'
    )
    await vi.waitFor(() => {
      expect(
        useAssistantProjectStore.getState().whole?.error ?? null
      ).toBeNull()
      expect(commands.beginAssistantRequest).toHaveBeenCalled()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('sends with Enter and inserts a line break with Shift+Enter', async () => {
    useAssistantStore.setState({ configured: true })
    const original = useAssistantStore.getState().send
    const send = vi.fn().mockResolvedValue(undefined)
    useAssistantStore.setState({ send })
    try {
      const user = userEvent.setup()
      render(<CreationAssistant identity="assistant-test" />)
      const input = screen.getByRole('textbox', { name: 'Ask the assistant' })
      await user.type(input, 'First line{Shift>}{Enter}{/Shift}Second line')
      expect(input).toHaveValue('First line\nSecond line')
      expect(send).not.toHaveBeenCalled()
      await user.keyboard('{Enter}')
      expect(send).toHaveBeenCalledOnce()
      expect(input).toHaveValue('First line\nSecond line')
    } finally {
      useAssistantStore.setState({ send: original })
    }
  })

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'keeps IME confirmation Enter from sending (%o)',
    nativeState => {
      useAssistantStore.setState({ configured: true, input: '输入法选词' })
      const original = useAssistantStore.getState().send
      const send = vi.fn().mockResolvedValue(undefined)
      useAssistantStore.setState({ send })
      try {
        render(<CreationAssistant identity="assistant-test" />)
        fireEvent.keyDown(
          screen.getByRole('textbox', { name: 'Ask the assistant' }),
          { key: 'Enter', ...nativeState }
        )
        expect(send).not.toHaveBeenCalled()
      } finally {
        useAssistantStore.setState({ send: original })
      }
    }
  )

  it('switches chats and offers a historical question as an editable new-chat draft', async () => {
    const user = userEvent.setup()
    useAssistantStore.setState({
      messages: [
        {
          id: 'question',
          role: 'user',
          text: 'Original question',
          scope: 'platform',
          status: 'completed',
          sources: [],
        },
      ],
      configured: true,
    })
    render(<CreationAssistant identity="assistant-test" />)
    await user.click(screen.getByRole('button', { name: 'Edit and resend' }))
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('Original question')
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveFocus()
    expect(
      screen.getByRole('button', { name: 'Send as new chat' })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }))
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('')
    await user.click(
      screen.getByRole('button', { name: 'Conversation options' })
    )
    await user.click(screen.getByRole('menuitem', { name: 'New chat' }))
    expect(screen.queryByText('Original question')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chats' }))
    await user.click(
      screen.getByRole('button', { name: /^1 · Original question/ })
    )
    expect(screen.getByText('Original question')).toBeVisible()
  })

  it.each(['bundle', 'utility', 'readOnlyFolder'] as const)(
    'keeps the readonly file reader available without an assistant for %s projects',
    async source => {
      const workspace = useCreationStore.getState().workspace
      if (!workspace) throw new Error('Expected fixture workspace')
      useCreationStore.setState({
        workspace: {
          ...workspace,
          project: { ...workspace.project, source },
        },
      })
      const user = userEvent.setup()
      render(<CreationView />)
      expect(
        screen.queryByRole('textbox', { name: 'Ask the assistant' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('navigation', { name: 'Reading views' })
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('treeitem', { name: 'score.js' }))
      const reader = await screen.findByRole('textbox', { name: 'score.js' })
      expect(reader).toBeVisible()
      expect(reader).toHaveTextContent('const saved = 1')
      expect(reader).toHaveAttribute('aria-readonly', 'true')
      expect(
        screen.queryByRole('button', { name: 'Send' })
      ).not.toBeInTheDocument()
    }
  )

  it('offers a configuration reload and Settings route after an unknown configuration failure', async () => {
    useAssistantStore.setState({ configured: null, error: 'requestFailed' })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(
      screen.getByRole('button', { name: 'Configure model service' })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Retry manually' })
    ).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: 'Reload configuration' })
    )
    expect(
      await screen.findByText(
        'Configure a model service to start a discussion. File editing and manual testing remain available.'
      )
    ).toBeVisible()
  })

  it('keeps local file access available when unconfigured and opens the actual model settings route', async () => {
    const user = userEvent.setup()
    render(<CreationView />)
    await user.click(
      await screen.findByRole('button', { name: 'Configure model service' })
    )
    expect(useSettingsStore.getState().focusSection).toBe('modelService')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.click(screen.getByRole('treeitem', { name: 'score.js' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toBeVisible()
    useSettingsStore.getState().closeSettings()
  })

  it('renders model content without executable HTML, remote images or model-authored navigation', () => {
    useAssistantStore.setState({
      messages: [
        {
          id: 'safe-message',
          role: 'assistant',
          text: '<script>window.evil = true</script>\n[run](javascript:alert(1))\n![tracking](https://tracking.example/secret)\n[external](https://example.com)',
          status: 'completed',
          sources: [],
          scope: 'platform',
        },
      ],
    })
    const { container } = render(<CreationView />)
    const article = container.querySelector('[data-message-id="safe-message"]')
    expect(article).not.toBeNull()
    expect(article?.querySelector('script,iframe,img,a')).toBeNull()
    expect(article).toHaveTextContent('tracking')
    expect(article).toHaveTextContent('external')
    expect(article).toHaveTextContent(
      'No local documentation source was consulted'
    )
  })

  it('announces reading state, prevents duplicate sending, and retains input when stopped', async () => {
    useAssistantStore.setState({
      input: 'How does PNDS work?',
      configured: true,
      phase: 'reading',
      messages: [
        {
          id: 'pending',
          role: 'assistant',
          text: 'Partial answer',
          status: 'pending',
          sources: [],
          scope: 'platform',
        },
      ],
    })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Reading installed PNDS help'
    )
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('How does PNDS work?')
    expect(screen.getByText('Partial answer')).toBeVisible()
    expect(screen.queryByLabelText('Expand work steps')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('keeps whole-project preparation cancellable after closing the context popover', async () => {
    const user = userEvent.setup()
    useAssistantStore.setState({
      configured: true,
      modelConfig: {
        model: 'whole-model',
        baseUrl: 'https://model.example/v1',
      },
      input: 'Read all saved files',
    })
    let finish!: (
      result: Awaited<ReturnType<typeof commands.assistantProjectInventory>>
    ) => void
    vi.mocked(commands.assistantProjectInventory).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    render(<CreationAssistant identity="assistant-test" />)
    await user.click(screen.getByRole('button', { name: /^Context:/ }))
    await user.click(screen.getByRole('button', { name: 'Read whole project' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      i18n.t('assistant.whole.preparing')
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useAssistantProjectStore.getState().planning).toBe(false)
    await act(async () =>
      finish({ status: 'ok', data: { files: [], fingerprint: 'empty' } })
    )
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument()
  })

  it('lets a failed whole-project read be cancelled so the edited question can be sent normally', async () => {
    const user = userEvent.setup()
    useAssistantStore.setState({
      configured: true,
      modelConfig: {
        model: 'whole-model',
        baseUrl: 'https://model.example/v1',
      },
      input: 'Read all saved files',
    })
    vi.mocked(commands.assistantProjectInventory).mockResolvedValueOnce({
      status: 'ok',
      data: { files: [], fingerprint: 'before-change' },
    })
    vi.mocked(commands.assistantProjectOverview).mockResolvedValue({
      status: 'ok',
      data: {
        snapshot: { files: [], fingerprint: 'after-change' },
        manifestStatus: 'valid',
        contentPaths: [],
        evidence: [],
      },
    })
    render(<CreationAssistant identity="assistant-test" />)
    await user.click(screen.getByRole('button', { name: /^Context:/ }))
    await user.click(screen.getByRole('button', { name: 'Read whole project' }))
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('assistant.error.projectScopeChanged')
    )
    expect(useAssistantProjectStore.getState().planning).toBe(false)
    const input = screen.getByRole('textbox', { name: 'Ask the assistant' })
    await user.clear(input)
    await user.type(input, 'Explain only the score structure')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useAssistantProjectStore.getState().whole).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).toHaveValue('Explain only the score structure')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  })

  it.each(
    (['reading', 'responding'] as const).flatMap(phase =>
      ['click', 'Enter', 'Space'].map(
        activation => [phase, activation] as const
      )
    )
  )(
    'does not submit the %s form when stopping with %s commits idle state before the default action',
    async (phase, activation) => {
      useAssistantStore.setState({
        configured: true,
        historyState: 'ready',
        historyBusy: false,
        input: 'Keep this question',
        phase,
        messages: [],
      })
      render(<CreationAssistant identity="assistant-test" />)
      const original = useAssistantStore.getState()
      const send = vi.fn().mockResolvedValue(undefined)
      useAssistantStore.setState({
        send,
        pause: () => flushSync(original.pause),
      })
      try {
        const user = userEvent.setup()
        const stop = screen.getByRole('button', { name: 'Pause' })
        if (activation === 'click') await user.click(stop)
        else {
          stop.focus()
          await user.keyboard(activation === 'Enter' ? '{Enter}' : ' ')
        }
        expect(send).not.toHaveBeenCalled()
        expect(useAssistantStore.getState().input).toBe('Keep this question')
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
      } finally {
        useAssistantStore.setState({
          send: original.send,
          pause: original.pause,
        })
      }
    }
  )

  it('groups consulted documents while waiting and distinguishes an incomplete reply after timeout', async () => {
    useAssistantStore.setState({
      input: 'Can a declaration prove hardware acceptance?',
      configured: true,
      phase: 'responding',
      messages: [
        {
          id: 'waiting-for-answer',
          role: 'assistant',
          text: '',
          status: 'pending',
          sources: [
            {
              docId: 'reference-manifest',
              sectionId: 'manifest-fields',
              title: 'Manifest · Fields',
              locale: 'en',
            },
          ],
          scope: 'platform',
        },
      ],
    })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(screen.getByText('Consulted documents (1)')).toBeVisible()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Preparing a reply…'
    )
    const source = screen.getByText('Manifest · Fields')
    expect(source).not.toBeVisible()
    await user.click(screen.getByText('Consulted documents (1)'))
    expect(source).toBeVisible()
    act(() => {
      useAssistantStore.setState(state => ({
        phase: 'idle',
        error: 'timeout',
        messages: state.messages.map(message => ({
          ...message,
          status: 'failed',
          error: 'timeout',
        })),
      }))
    })
    expect(
      screen.getByText(
        'Reply incomplete. These documents were consulted before it stopped.'
      )
    ).toBeVisible()
    expect(source).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry manually' })).toBeEnabled()
  })

  it('hosts a controlled inline proposal and reading extension while preserving candidate, parameter and file drafts separately', async () => {
    useAssistantStore.setState({
      messages: [
        {
          id: 'reply',
          role: 'assistant',
          text: 'A proposed change',
          status: 'completed',
          sources: [],
          scope: 'platform',
        },
      ],
    })
    const user = userEvent.setup()
    render(
      <CreationView
        renderAssistantCards={message =>
          message.id === 'reply' ? <ControlledProposal /> : null
        }
      />
    )
    await user.clear(screen.getByLabelText('Test parameter'))
    await user.type(screen.getByLabelText('Test parameter'), '2')
    await user.click(screen.getByRole('button', { name: 'Code' }))
    const code = screen.getByRole('textbox', { name: 'score.js' })
    editText(code, 'candidate code')
    await user.click(
      screen.getByRole('button', { name: 'Preview temporarily' })
    )
    expect(
      screen.getByText('Temporary preview only; not saved or checked.')
    ).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Apply this candidate' })
    )
    await user.click(screen.getByText('Actual applied difference'))
    expect(screen.getByLabelText('After application')).toHaveTextContent(
      'candidate code'
    )
    editText(code, 'new unapplied code')
    expect(screen.getByLabelText('After application')).toHaveTextContent(
      'candidate code'
    )
    await user.click(screen.getByRole('button', { name: 'Open current file' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toBeVisible()
    act(() =>
      useCreationFilesStore
        .getState()
        .edit('score.js', 'independent file draft')
    )
    await user.click(
      screen.getByRole('button', { name: 'PNDS creation assistant' })
    )
    expect(screen.getByRole('textbox', { name: 'score.js' })).toHaveTextContent(
      'new unapplied code'
    )
    expect(document.querySelector('[data-message-id="reply"]')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Parameters' }))
    expect(screen.getByLabelText('Test parameter')).toHaveValue('2')
    await user.click(
      screen.getByRole('button', { name: 'Open controlled reading' })
    )
    expect(
      screen.getByRole('textbox', { name: 'Comparison note' })
    ).toBeVisible()
    await user.type(
      screen.getByRole('textbox', { name: 'Comparison note' }),
      ' retained'
    )
    await user.click(
      screen.getByRole('button', { name: 'PNDS creation assistant' })
    )
    expect(screen.getByText('A proposed change')).toBeVisible()
    expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
      'independent file draft'
    )
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  })

  it('starts in discussion and preserves the composed question across opening the current file twice', async () => {
    const user = userEvent.setup()
    render(<CreationView />)
    const input = screen.getByRole('textbox', { name: 'Ask the assistant' })
    await user.type(input, 'How do audio buses work?')
    await user.click(screen.getByRole('treeitem', { name: 'score.js' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'PNDS creation assistant' })
    )
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('How do audio buses work?')
    await user.click(screen.getByRole('treeitem', { name: 'score.js' }))
    expect(screen.getByRole('textbox', { name: 'score.js' })).toBeVisible()
  })
})

function ControlledProposal() {
  const [buffer] = useState(() => new TextBuffer('candidate', 'score.js'))
  const [parameter, setParameter] = useState('1')
  const [proposal, setProposal] = useState<AssistantProposal>({
    id: 'proposal',
    messageId: 'reply',
    identity: 'assistant-test',
    source: { path: 'score.js', version: 'v1' },
    candidate: { revision: 1, text: 'candidate' },
    preview: 'none',
    pendingRefresh: false,
    appliedDiff: null,
  })
  return (
    <AssistantProposalCard
      proposal={proposal}
      buffer={buffer}
      parameters={
        <>
          <label>
            Test parameter
            <input
              value={parameter}
              onChange={event => setParameter(event.target.value)}
            />
          </label>
          <button
            onClick={() =>
              useCreationReadingStore.getState().showExtension(
                {
                  id: 'controlled',
                  title: 'Controlled reading',
                  content: (
                    <label>
                      Comparison note
                      <input defaultValue="note" />
                    </label>
                  ),
                },
                'reply'
              )
            }
          >
            Open controlled reading
          </button>
        </>
      }
      onCodeChange={text =>
        setProposal(current => ({
          ...current,
          candidate: { revision: current.candidate.revision + 1, text },
          preview: current.preview === 'none' ? 'none' : 'stale',
        }))
      }
      onPreview={() =>
        setProposal(current => ({ ...current, preview: 'temporary' }))
      }
      onApply={() =>
        setProposal(current => ({
          ...current,
          appliedDiff: { before: 'original', after: current.candidate.text },
          pendingRefresh: true,
        }))
      }
    />
  )
}

it('defaults to discussion and keeps the captured mode fixed while a task runs', async () => {
  useAssistantStore.setState({ mode: 'discussion', phase: 'idle' })
  render(<CreationAssistant identity="assistant-test" />)
  const mode = screen.getByRole('radio', {
    name: i18n.t('assistant.mode.discussion'),
  })
  expect(mode).toHaveAttribute('aria-checked', 'true')
  expect(mode).toHaveTextContent('Discussion')
  await userEvent.click(
    screen.getByRole('radio', { name: i18n.t('assistant.mode.edit') })
  )
  expect(useAssistantStore.getState().mode).toBe('edit')
  act(() => useAssistantStore.setState({ phase: 'responding' }))
  expect(mode).toBeDisabled()
  act(() => useAssistantStore.getState().setMode('discussion'))
  expect(useAssistantStore.getState().mode).toBe('edit')
})

it('shows the thought line with one accessible phase status and retains the composer pause indicator', () => {
  useAssistantStore.setState({
    mode: 'discussion',
    configured: true,
    phase: 'responding',
    modelConfig: {
      baseUrl: 'https://model.example/v1',
      model: 'composer-model',
    },
    messages: [
      {
        id: 'streaming',
        role: 'assistant',
        text: 'Partial answer',
        status: 'pending',
        scope: 'platform',
        sources: [],
      },
    ],
  })
  const { container } = render(<CreationAssistant identity="assistant-test" />)
  expect(screen.getByText('composer-model')).toBeVisible()
  const status = screen.getByRole('status', { name: '' })
  expect(status).toHaveTextContent('Generating…')
  expect(status?.closest('[data-message-id]')).toHaveAttribute(
    'data-message-id',
    'streaming'
  )
  const loading = screen
    .getByRole('button', { name: 'Pause' })
    .querySelector('.animate-spin')
  expect(loading).toHaveClass('motion-reduce:animate-none')
  expect(loading).toHaveAttribute('aria-hidden', 'true')
  expect(container.querySelector('.creation-assistant-thinking')).toBeNull()
  const thoughtLine = container.querySelector('.assistant-thought-line')
  expect(thoughtLine).toBeVisible()
  expect(thoughtLine).toHaveAttribute('data-working', 'true')
  expect(thoughtLine).toHaveTextContent('Generating…')
  expect(status).toHaveClass('sr-only')
  expect(status.querySelector('.sr-only')).toHaveTextContent('Generating…')
  act(() => useAssistantStore.setState({ phase: 'reading' }))
  expect(screen.getAllByRole('status', { name: '' })).toHaveLength(1)
  expect(screen.getByRole('status', { name: '' })).toBe(status)
  expect(status).toHaveTextContent('Reading installed PNDS help')
  expect(thoughtLine).toHaveTextContent('Reading installed PNDS help')
  act(() => useAssistantStore.setState({ phase: 'responding' }))
  expect(screen.getByRole('status', { name: '' })).toBe(status)
  const partial = screen.getByText('Partial answer')
  expect(partial).toBeVisible()
  expect(partial.closest('[aria-live], [role="status"]')).toBeNull()
  expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
  act(() =>
    useAssistantStore.setState(state => ({
      phase: 'idle',
      messages: state.messages.map(message => ({
        ...message,
        status: 'completed',
      })),
    }))
  )
  expect(screen.queryByRole('status', { name: '' })).not.toBeInTheDocument()
  expect(screen.getByText('Partial answer')).toBeVisible()
  expect(thoughtLine).toHaveAttribute('data-working', 'false')
})

it.each(['completed', 'cancelled', 'failed'] as const)(
  'renders native text events before the model settles and retains the %s reply',
  async outcome => {
    useAssistantOverviewStore.getState().syncWorkspace(null)
    vi.mocked(commands.assistantProjectOverview).mockResolvedValue({
      status: 'ok',
      data: {
        snapshot: { files: [], fingerprint: 'empty' },
        manifestStatus: 'valid',
        contentPaths: [],
        evidence: [],
      },
    })
    let deliver!: (requestId: string, turnId: string, text: string) => void
    const off = vi.fn()
    const subscription = vi
      .spyOn(events.assistantTextEvent, 'listen')
      .mockImplementation(async cb => {
        deliver = (requestId, turnId, text) =>
          cb({
            event: 'assistant-text-event',
            id: 0,
            payload: { requestId, turnId, text },
          })
        return off
      })
    let requestId!: string
    let turnId!: string
    let finish!: (
      value: Awaited<ReturnType<typeof commands.assistantModelTurn>>
    ) => void
    vi.mocked(commands.beginAssistantRequest).mockImplementationOnce(
      async (_identity, id) => ({
        status: 'ok',
        data: {
          requestId: id,
          model: 'stream-model',
          baseUrl: 'https://model.example/v1',
          config: {
            model: 'stream-model',
            baseUrl: 'https://model.example/v1',
          },
        },
      })
    )
    vi.mocked(commands.assistantModelTurn).mockImplementationOnce(
      (id, _messages, turn) => {
        requestId = id
        turnId = turn
        return new Promise(resolve => {
          finish = resolve
        })
      }
    )
    useAssistantStore.setState({
      mode: 'discussion',
      configured: true,
      modelConfig: {
        baseUrl: 'https://model.example/v1',
        model: 'stream-model',
      },
    })
    try {
      useAssistantStore.getState().setInput('Stream this reply')
      render(<CreationAssistant identity="assistant-test" />)
      let sending!: Promise<void>
      await act(async () => {
        sending = useAssistantStore.getState().send()
        await vi.waitFor(() => expect(finish).toBeDefined())
      })
      act(() => {
        deliver('other-request', turnId, 'Wrong request')
        deliver(requestId, 'other-turn', 'Wrong turn')
      })
      expect(screen.queryByText('Wrong request')).not.toBeInTheDocument()
      expect(screen.queryByText('Wrong turn')).not.toBeInTheDocument()
      const status = screen.getByRole('status', { name: '' })
      for (const text of ['你', '你好', '你好 👩‍💻，这是实时回复。']) {
        act(() => deliver(requestId, turnId, text))
        const body = screen.getByText(text)
        expect(body).toBeVisible()
        expect(body.closest('[aria-live], [role="status"]')).toBeNull()
        expect(screen.getByRole('status', { name: '' })).toBe(status)
        expect(useAssistantStore.getState().messages.at(-1)?.status).toBe(
          'pending'
        )
      }
      const received = '你好 👩‍💻，这是实时回复。'
      await act(async () => {
        if (outcome === 'cancelled') {
          useAssistantStore.getState().stop()
          await sending
          finish({
            status: 'ok',
            data: { text: 'Late completion', toolCalls: [] },
          })
        } else {
          finish(
            outcome === 'completed'
              ? {
                  status: 'ok',
                  data: {
                    text: null,
                    toolCalls: [
                      {
                        id: 'ordinary-completion',
                        name: 'complete_discussion',
                        arguments: JSON.stringify({ answer: received }),
                      },
                    ],
                  },
                }
              : { status: 'error', error: { type: 'network' } }
          )
          await sending
        }
        await vi.waitFor(() => expect(off).toHaveBeenCalledOnce())
      })
      expect(screen.getAllByText(received)).toHaveLength(1)
      expect(screen.getByText(received)).toBeVisible()
      expect(useAssistantStore.getState().messages.at(-1)?.status).toBe(outcome)
      expect(screen.queryByRole('status', { name: '' })).not.toBeInTheDocument()
      act(() => deliver(requestId, turnId, 'Late stream update'))
      expect(screen.queryByText('Late stream update')).not.toBeInTheDocument()
      expect(screen.queryByText('Late completion')).not.toBeInTheDocument()
      expect(screen.getByText(received)).toBeVisible()
    } finally {
      subscription.mockRestore()
    }
  }
)

it('shows the thought line while preparing a request before the reply exists', () => {
  useAssistantStore.setState({ phase: 'reading', messages: [] })
  const { container } = render(<CreationAssistant identity="assistant-test" />)
  expect(container.querySelector('.assistant-thought-line')).toBeVisible()
  expect(container.querySelector('.assistant-thought-line')).toHaveTextContent(
    'Reading installed PNDS help'
  )
  expect(screen.getAllByRole('status', { name: '' })).toHaveLength(1)
})

it('numbers unique grilling questions across a chat and restarts numbering in another chat', () => {
  const question = (
    id: string,
    replyId: string,
    status: 'answered' | 'cancelled' | 'pending'
  ) => ({
    id,
    taskId: 'task',
    scope: { chatId: 'original', messageId: replyId },
    prompt: `Creative decision ${id}`,
    options: [],
    recommendedOptionId: null,
    status,
    answer:
      status === 'answered' ? { optionId: null, text: 'Confirmed' } : null,
  })
  const first = question('first-question', 'reply-one', 'answered')
  useAssistantStore.setState({
    phase: 'idle',
    activeQuestion: null,
    activeConversationId: null,
    messages: [
      {
        id: 'reply-one',
        role: 'assistant',
        text: '',
        status: 'completed',
        scope: 'project',
        sources: [],
        questions: [
          first,
          question('second-question', 'reply-one', 'cancelled'),
        ],
      },
      {
        id: 'duplicate-receipt',
        role: 'assistant',
        text: '',
        status: 'completed',
        scope: 'project',
        sources: [],
        questions: [first],
      },
      {
        id: 'new-chat',
        role: 'assistant',
        text: 'New chat',
        status: 'completed',
        scope: 'platform',
        sources: [],
        contextMarker: { type: 'topic' },
      },
      {
        id: 'new-reply',
        role: 'assistant',
        text: '',
        status: 'completed',
        scope: 'project',
        sources: [],
        questions: [question('third-question', 'new-reply', 'pending')],
      },
    ],
  })
  render(<CreationAssistant identity="assistant-test" />)
  expect(screen.getAllByText('Q1')).toHaveLength(2)
  expect(screen.getByText('Q2')).not.toBeVisible()
  fireEvent.click(screen.getByText('Questions this turn · 2'))
  expect(screen.getByText('Q2')).toBeVisible()
  expect(screen.queryByText('Q3')).not.toBeInTheDocument()
  act(() => useAssistantStore.setState({ activeConversationId: 'new-chat' }))
  expect(screen.getAllByText('Q1')).toHaveLength(1)
  expect(screen.queryByText('Q2')).not.toBeInTheDocument()
})

it.each([false, true])(
  'offers contextual next steps and starts a fresh work task while keeping the draft (preparation retry: %s)',
  async retryPreparation => {
    useAssistantOverviewStore.getState().syncWorkspace(null)
    vi.mocked(commands.assistantProjectOverview).mockResolvedValue({
      status: 'ok',
      data: {
        snapshot: { files: [], fingerprint: 'empty' },
        manifestStatus: 'valid',
        contentPaths: [],
        evidence: [],
      },
    })
    useAssistantStore.setState({
      mode: 'discussion',
      configured: true,
      historyState: 'ready',
      historyBusy: false,
      historySaveError: null,
      canContinue: false,
      paused: false,
      resumeRestored: false,
      activeQuestion: null,
      resourceApproval: null,
      input: 'A separate unsent idea',
      modelConfig: { model: 'test-model', baseUrl: 'https://model.example/v1' },
      messages: [
        {
          id: 'request',
          role: 'user',
          text: 'Map slow breathing to sparse rhythm. Keep the original sound.',
          status: 'completed',
          scope: 'project',
          contextServiceKey: modelProfileKey({
            model: 'test-model',
            baseUrl: 'https://model.example/v1',
          }),
          sources: [],
        },
        {
          id: 'ready-plan',
          role: 'assistant',
          text: 'The relevant choices are resolved. Each performer retains a separate breath envelope, and the ending fades over exactly eight seconds. Autonomous sound is out of scope.',
          status: 'completed',
          scope: 'project',
          contextServiceKey: modelProfileKey({
            model: 'test-model',
            baseUrl: 'https://model.example/v1',
          }),
          sources: [],
        },
      ],
    })
    useAssistantHandoffStore.getState().offer(
      'assistant-test',
      'ready-plan',
      {
        reason: 'The plan is ready.',
        intent: 'Implement breathing density',
        files: ['score.js'],
        knownProblems: 'No unresolved design choices.',
        acceptance:
          'Slow breathing produces sparse rhythm; preserve the sound.',
      },
      'discussion'
    )
    vi.mocked(commands.beginAssistantRequest).mockImplementationOnce(
      async (_, requestId) => ({
        status: 'ok',
        data: {
          requestId,
          model: 'test-model',
          baseUrl: 'https://model.example/v1',
          config: { model: 'test-model', baseUrl: 'https://model.example/v1' },
        },
      })
    )
    vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
      status: 'ok',
      data: { text: 'No further safe changes required.', toolCalls: [] },
    })
    render(<CreationAssistant identity="assistant-test" />)
    expect(
      screen.queryByRole('button', { name: 'Organize project' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Generate handoff draft' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Write handoff file' })
    ).toBeEnabled()
    const start = screen.getByRole('button', { name: 'Start work' })
    if (retryPreparation)
      vi.mocked(commands.assistantProjectOverview).mockResolvedValueOnce({
        status: 'error',
        error: { code: 'io', detail: 'Temporary overview failure' },
      })
    start.focus()
    await userEvent.keyboard('{Enter}')
    if (retryPreparation) {
      await vi.waitFor(() =>
        expect(useAssistantStore.getState().error).toBe('projectUnavailable')
      )
      expect(useAssistantStore.getState().input).toBe('A separate unsent idea')
      expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Start work' })).toBeEnabled()
      await userEvent.click(screen.getByRole('button', { name: 'Start work' }))
    }
    await vi.waitFor(() => {
      expect(useAssistantStore.getState().error).toBeNull()
      expect(commands.assistantModelTurn).toHaveBeenCalled()
    })
    await vi.waitFor(() =>
      expect(useAssistantStore.getState().phase).toBe('idle')
    )
    expect(screen.getByRole('radio', { name: 'Work' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(useAssistantStore.getState().input).toBe('A separate unsent idea')
    const packet = JSON.stringify(
      vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1]
    )
    expect(packet).toContain('Mode: edit')
    expect(packet).toContain('Implement breathing density')
    expect(packet).toContain('Keep the original sound')
    const workGoal = useAssistantStore
      .getState()
      .messages.filter(message => message.role === 'user')
      .at(-1)?.text
    expect(workGoal).toContain(
      'Each performer retains a separate breath envelope'
    )
    expect(workGoal).toContain('the ending fades over exactly eight seconds')
    expect(workGoal).toContain('Autonomous sound is out of scope')
    expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  }
)

it.each(['帮我整理一下工程代码库', 'Please organize the project'])(
  'routes the fresh creator command %s into Work and keeps ordinary discussion read-only',
  async input => {
    useAssistantOverviewStore.getState().syncWorkspace(null)
    vi.mocked(commands.assistantProjectOverview).mockResolvedValue({
      status: 'ok',
      data: {
        snapshot: { files: [], fingerprint: 'empty' },
        manifestStatus: 'valid',
        contentPaths: [],
        evidence: [],
      },
    })
    useAssistantStore.setState({
      mode: 'discussion',
      configured: true,
      historyState: 'ready',
      historyBusy: false,
      historySaveError: null,
      canContinue: false,
      paused: false,
      resumeRestored: false,
      activeQuestion: null,
      resourceApproval: null,
      input,
      modelConfig: { model: 'test-model', baseUrl: 'https://model.example/v1' },
      messages: [],
    })
    vi.mocked(commands.beginAssistantRequest).mockImplementationOnce(
      async (_, requestId) => ({
        status: 'ok',
        data: {
          requestId,
          model: 'test-model',
          baseUrl: 'https://model.example/v1',
          config: { model: 'test-model', baseUrl: 'https://model.example/v1' },
        },
      })
    )
    vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
      status: 'ok',
      data: { text: 'No safe organization needed.', toolCalls: [] },
    })
    render(<CreationAssistant identity="assistant-test" />)
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await vi.waitFor(() => {
      expect(useAssistantStore.getState().error).toBeNull()
      expect(commands.assistantModelTurn).toHaveBeenCalled()
    })
    await vi.waitFor(() =>
      expect(useAssistantStore.getState().phase).toBe('idle')
    )
    expect(useAssistantStore.getState().mode).toBe('edit')
    expect(
      useAssistantStore
        .getState()
        .messages.find(message => message.role === 'user')?.text
    ).toBe(input)
    const packet = JSON.stringify(
      vi.mocked(commands.assistantModelTurn).mock.calls[0]?.[1]
    )
    expect(packet).toContain('Mode: edit')
    expect(packet).toContain('PNDS default organization rules')
  }
)

it('rejects a stale or historical plan without changing mode or starting a request', async () => {
  useAssistantStore.setState({
    mode: 'discussion',
    configured: true,
    messages: [
      {
        id: 'old-plan',
        role: 'assistant',
        text: 'Old plan',
        status: 'completed',
        scope: 'project',
        sources: [],
      },
      {
        id: 'new-input',
        role: 'user',
        text: 'Discuss a different idea first',
        status: 'completed',
        scope: 'project',
        sources: [],
      },
    ],
  })
  useAssistantHandoffStore.getState().offer(
    'assistant-test',
    'old-plan',
    {
      reason: 'Ready',
      intent: 'Old goal',
      files: ['score.js'],
      knownProblems: 'None',
      acceptance: 'Old acceptance',
    },
    'discussion'
  )
  await useAssistantStore.getState().startWork('old-plan')
  expect(useAssistantStore.getState().mode).toBe('discussion')
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})

it.each([
  ['work', 'removed'],
  ['work', 'changed'],
  ['handoff', 'removed'],
  ['handoff', 'changed'],
])(
  'refuses %s selection of a plan whose private material was %s',
  async (route, change) => {
    const config = { model: 'test-model', baseUrl: 'https://model.example/v1' }
    const material = {
      id: 'a'.repeat(32),
      name: 'instrument.txt',
      version: 'b'.repeat(64),
      size: 4,
      totalCharacters: 4,
    }
    useAssistantStore.setState({
      mode: 'discussion',
      configured: true,
      modelConfig: config,
      historyState: 'ready',
      historyBusy: false,
      historySaveError: null,
      canContinue: false,
      paused: false,
      resumeRestored: false,
      activeQuestion: null,
      resourceApproval: null,
      historicalMessageIds: [],
      activeConversationId: null,
      input: 'Keep this separate draft',
      messages: [
        {
          id: 'material-plan',
          role: 'assistant',
          text: 'A plan based on the private instrument design.',
          contextServiceKey: modelProfileKey(config),
          sources: [
            materialPageSource(
              {
                material,
                text: 'Tone',
                offset: 0,
                endOffset: 4,
                totalCharacters: 4,
                nextOffset: null,
                startLine: 1,
                endLine: 1,
              },
              'en'
            ),
          ],
          status: 'completed',
          scope: 'project',
        },
      ],
    })
    useAssistantHandoffStore.getState().offer(
      'assistant-test',
      'material-plan',
      {
        reason: 'Ready',
        intent: 'Implement the instrument',
        files: ['score.js'],
        acceptance: 'Verify the instrument',
        knownProblems: 'Not implemented',
      },
      'discussion'
    )
    vi.mocked(commands.listCreationMaterials).mockResolvedValue({
      status: 'ok',
      data:
        change === 'removed' ? [] : [{ ...material, version: 'c'.repeat(64) }],
    })
    if (route === 'work')
      await useAssistantStore.getState().startWork('material-plan')
    else await useAssistantStore.getState().send(false, false, true)
    expect(commands.listCreationMaterials).toHaveBeenCalledWith(
      'assistant-test'
    )
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    expect(useAssistantStore.getState().mode).toBe('discussion')
    expect(useAssistantStore.getState().input).toBe('Keep this separate draft')
    expect(
      useAssistantStore.getState()[
        route === 'work' ? 'error' : 'handoffDraftError'
      ]
    ).toBe(route === 'work' ? 'projectScopeChanged' : true)
  }
)

const reliablePlan = {
  reason: 'The behavior decision is settled.',
  intent: 'Sustain the touch voice',
  files: ['score.js'],
  knownProblems: '',
  acceptance: 'Held touch sustains until touch-up or expiry.',
  plan: 'Touch starts a sustained voice. Hold sustains until touch-up or element expiry. Change score.js. Pause, Stop and disconnection retain their existing behavior. Verify no release while held before expiry.',
}

function readyReliableDiscussion() {
  const config = { model: 'test-model', baseUrl: 'https://model.example/v1' }
  useAssistantOverviewStore.getState().syncWorkspace(null)
  useAssistantHandoffStore.setState({ items: {} })
  vi.mocked(commands.assistantProjectOverview).mockResolvedValue({
    status: 'ok',
    data: {
      snapshot: { files: [], fingerprint: 'empty' },
      manifestStatus: 'valid',
      contentPaths: [],
      evidence: [],
    },
  })
  vi.mocked(commands.beginAssistantRequest).mockImplementation(
    async (_, requestId) => ({
      status: 'ok',
      data: { requestId, ...config, config },
    })
  )
  useAssistantStore.setState({
    mode: 'discussion',
    configured: true,
    modelConfig: config,
    activeConversationId: null,
    messages: [],
    historicalMessageIds: [],
    historyState: 'ready',
    historyBusy: false,
    historyEpoch: 'history-initial',
    historySaveError: null,
    canContinue: false,
    paused: false,
    resumeRestored: false,
    activeQuestion: null,
    resourceApproval: null,
    editing: null,
    organizing: false,
    input: 'Design a sustained touch voice.',
  })
  return config
}

it.each([false, true])(
  'publishes structured discussion text and both real buttons together (repair: %s)',
  async repair => {
    readyReliableDiscussion()
    if (repair)
      vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
        status: 'ok',
        data: { text: reliablePlan.plan, toolCalls: [] },
      })
    vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
      status: 'ok',
      data: {
        text: 'A shorter activity summary.',
        toolCalls: [
          {
            id: 'ready-plan',
            name: 'propose_handoff',
            arguments: JSON.stringify(reliablePlan),
          },
        ],
      },
    })
    render(<CreationAssistant identity="assistant-test" />)
    await act(() => useAssistantStore.getState().send())
    expect(
      screen.getByRole('button', { name: 'Write handoff file' })
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start work' })).toBeEnabled()
    const reply = useAssistantStore.getState().messages.at(-1)
    expect(reply?.text).toBe(reliablePlan.plan)
    expect(reply?.discussionPlan).toEqual(reliablePlan)
    expect(
      useAssistantHandoffStore.getState().items[reply?.id ?? '']?.suggestion
        .plan
    ).toBe(reply?.text)
    expect(commands.assistantModelTurn).toHaveBeenCalledTimes(repair ? 2 : 1)
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  }
)

it.each(['Start work', '开始工作', '直接工作'])(
  'keeps an explicit missing-plan choice out of ordinary model discussion: %s',
  async input => {
    readyReliableDiscussion()
    useAssistantStore.setState({ input })
    await act(() => useAssistantStore.getState().send())
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    expect(useAssistantStore.getState().mode).toBe('discussion')
    expect(useAssistantStore.getState().input).toBe(input)
  }
)

it('keeps a missing-plan text choice deterministic when Work mode was retained', async () => {
  readyReliableDiscussion()
  useAssistantStore.setState({ mode: 'edit', input: 'Start work' })
  await act(() => useAssistantStore.getState().send())
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(useAssistantStore.getState().mode).toBe('edit')
  expect(useAssistantStore.getState().input).toBe('Start work')
})

it('restores only a read-only plan and requires a new explicit selection before next-step actions', async () => {
  const config = readyReliableDiscussion()
  useAssistantStore.setState({
    messages: [
      {
        id: 'saved-plan',
        role: 'assistant',
        scope: 'project',
        status: 'completed',
        text: reliablePlan.plan,
        discussionPlan: reliablePlan,
        sources: [],
        contextServiceKey: modelProfileKey(config),
      },
    ],
    historicalMessageIds: ['saved-plan'],
  })
  render(<CreationAssistant identity="assistant-test" />)
  expect(
    screen.queryByRole('button', { name: 'Start work' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Write handoff file' })
  ).not.toBeInTheDocument()
  expect(useAssistantHandoffStore.getState().items).toEqual({})
  await act(() =>
    useAssistantStore.getState().selectDiscussionPlan('saved-plan')
  )
  expect(screen.getByRole('button', { name: 'Start work' })).toBeEnabled()
  expect(
    screen.getByRole('button', { name: 'Write handoff file' })
  ).toBeEnabled()
  expect(useAssistantStore.getState().messages.at(-1)?.text).toBe(
    reliablePlan.plan
  )
  expect(useAssistantStore.getState().messages.at(-1)?.id).not.toBe(
    'saved-plan'
  )
  expect(useAssistantStore.getState().mode).toBe('discussion')
  expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(commands.saveAssistantHistory).toHaveBeenCalled()
})

it('refuses a saved plan whose code evidence changed without restoring a live choice', async () => {
  const config = readyReliableDiscussion()
  useAssistantStore.setState({
    messages: [
      {
        id: 'saved-plan',
        role: 'assistant',
        scope: 'project',
        status: 'completed',
        text: reliablePlan.plan,
        discussionPlan: reliablePlan,
        contextServiceKey: modelProfileKey(config),
        sources: [
          {
            docId: 'project',
            sectionId: 'score.js',
            title: 'Score',
            locale: 'en',
            project: {
              path: 'score.js',
              version: 'old',
              text: 'old score',
              offset: 0,
              endOffset: 9,
              totalCharacters: 9,
              nextOffset: null,
              startLine: 1,
              endLine: 1,
            },
          },
        ],
      },
    ],
    historicalMessageIds: ['saved-plan'],
  })
  await act(() =>
    useAssistantStore.getState().selectDiscussionPlan('saved-plan')
  )
  expect(useAssistantHandoffStore.getState().items).toEqual({})
  expect(useAssistantStore.getState().messages).toHaveLength(1)
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
  expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
})

it('continues a historical delivery as a new Work request using the original goal and reference evidence', async () => {
  const config = readyReliableDiscussion()
  const originalGoal =
    'Keep the held voice sounding until touch-up or expiry; preserve transport controls.'
  const evidence = {
    schemaVersion: 1,
    taskId: 'old-native-task',
    savedPaths: ['score.js'],
    staticCheck: { status: 'passed' as const },
    build: { status: 'notRequired' as const },
    runtime: { status: 'observed' as const, reason: 'existingRuntimeOnly' },
    behavior: { status: 'notRun' as const, reason: 'behaviorNotVerified' },
  }
  useAssistantStore.setState({
    input: '',
    historicalMessageIds: ['old-work-reply'],
    messages: [
      {
        id: 'original-goal',
        role: 'user',
        status: 'completed',
        scope: 'project',
        sources: [],
        text: originalGoal,
        contextServiceKey: modelProfileKey(config),
      },
      {
        id: 'old-work-reply',
        role: 'assistant',
        status: 'completed',
        scope: 'project',
        sources: [],
        text: 'UNSELECTED scope expansion.',
        checkOutcome: evidence,
        contextServiceKey: modelProfileKey(config),
      },
    ],
  })
  vi.mocked(commands.beginCreationAssistantTask).mockImplementation(
    async (_, mode) => ({
      status: 'ok',
      data: { id: 'new-verification-task', mode, files: [] },
    })
  )
  vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
    status: 'ok',
    data: { text: 'A listening check is still pending.', toolCalls: [] },
  })
  render(<CreationAssistant identity="assistant-test" />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Continue verification (Work)' })
  )
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().messages.at(-1)?.status).toBe(
      'completed'
    )
  )
  expect(useAssistantStore.getState().mode).toBe('edit')
  expect(commands.beginCreationAssistantTask).toHaveBeenCalledWith(
    'assistant-test',
    'edit',
    null,
    expect.any(Object)
  )
  const request =
    useAssistantStore
      .getState()
      .messages.filter(message => message.role === 'user')
      .at(-1)?.text ?? ''
  expect(request).toContain(originalGoal)
  expect(request).toContain(JSON.stringify(evidence))
  expect(request).toContain('historical reference')
  expect(request).toContain('Do not assume')
  expect(request).not.toContain('UNSELECTED scope expansion')
  expect(
    useAssistantStore
      .getState()
      .messages.find(message => message.id === 'old-work-reply')?.checkOutcome
  ).toEqual(evidence)
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(useAssistantStore.getState().input).toBe('')
})
