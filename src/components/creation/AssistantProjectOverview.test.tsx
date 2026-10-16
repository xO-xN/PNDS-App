import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'
import { AssistantProjectOverview } from './AssistantProjectOverview'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'overview',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useAssistantOverviewStore.getState().syncWorkspace(null)
  useAssistantOverviewStore.getState().syncWorkspace('overview')
  vi.mocked(commands.assistantProjectOverview).mockResolvedValue({
    status: 'ok',
    data: {
      snapshot: {
        files: [{ path: 'README.md', version: 'v1', bytes: 12, reason: null }],
        fingerprint: 'v1',
      },
      manifestStatus: 'valid',
      contentPaths: [],
      evidence: [
        {
          path: 'README.md',
          version: 'v1',
          text: '# Saved intent',
          offset: 0,
          endOffset: 14,
          totalCharacters: 14,
          nextOffset: null,
          startLine: 1,
          endLine: 1,
        },
      ],
    },
  })
})

it('expands on hover and keyboard focus, refreshes saved facts and never starts models or runtime (#169)', async () => {
  render(<AssistantProjectOverview identity="overview" />)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Project overview/ })
    ).toHaveTextContent('Up to date')
  )
  const trigger = screen.getByRole('button', { name: /Project overview/ })
  const container = trigger.parentElement
  if (!container) throw new Error('Overview container is missing')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.mouseEnter(container)
  expect(
    screen.getByRole('region', { name: 'Project overview' })
  ).toHaveTextContent('No current evidence')
  fireEvent.mouseLeave(container)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  act(() => trigger.focus())
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(
    screen.getByRole('region', { name: 'Project overview' })
  ).toHaveTextContent('README.md')
  act(() => trigger.blur())
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  act(() => useCreationFilesStore.getState().changed(['README.md']))
  expect(trigger).toHaveTextContent('Out of date')
  await waitFor(() => expect(trigger).toHaveTextContent('Up to date'))
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(commands.preflightCreationProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
})
