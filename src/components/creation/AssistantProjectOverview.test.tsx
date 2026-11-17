import { beforeEach, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'
import { AssistantProjectOverview } from './AssistantProjectOverview'

function OverviewFixture() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Open overview
      </button>
      <AssistantProjectOverview
        identity="overview"
        open={open}
        onOpenChange={setOpen}
        onClose={() => trigger.current?.focus()}
      />
    </>
  )
}

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

it('refreshes saved facts while mounted and opens only on explicit activation without starting a model or runtime', async () => {
  const user = userEvent.setup()
  render(<OverviewFixture />)
  await waitFor(() =>
    expect(useAssistantOverviewStore.getState().overview).not.toBeNull()
  )
  const trigger = screen.getByRole('button', {
    name: 'Open overview',
  })
  fireEvent.mouseEnter(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  act(() => trigger.focus())
  await user.keyboard('{Enter}')
  const overview = screen.getByRole('dialog', { name: 'Project overview' })
  expect(overview).toHaveTextContent('No current evidence')
  expect(overview).toHaveTextContent('README.md')
  act(() => useCreationFilesStore.getState().changed(['README.md']))
  expect(overview).toHaveTextContent('Out of date')
  await waitFor(() => expect(overview).toHaveTextContent('Up to date'))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(commands.preflightCreationProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
})
