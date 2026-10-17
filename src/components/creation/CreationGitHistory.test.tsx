import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { commands, type GitHistoryFile } from '@/lib/tauri-bindings'
import { seedCreationDraft } from '@/test/creation-files'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { CreationGitHistory } from './CreationGitHistory'
const file: GitHistoryFile = {
  commit: 'abc123',
  path: 'server.js',
  historicalText: 'old\n',
  historicalSize: 4,
  savedText: 'saved\n',
  diskVersion: 'current',
  loadable: true,
  reason: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'score',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [{ path: 'server.js', kind: 'text', category: 'system', size: 6 }],
    },
  })
  useCreationFilesStore.getState().clear()
  vi.mocked(commands.getCreationGitHistory).mockResolvedValue({
    status: 'ok',
    data: {
      head: 'now',
      limited: true,
      commits: [
        {
          id: 'abc123',
          timestamp: 1700000000,
          author: 'Creator',
          email: 'creator@pnds.local',
          message: 'Old version',
          files: ['server.js'],
        },
      ],
    },
  })
  vi.mocked(commands.readCreationGitHistoryFile).mockResolvedValue({
    status: 'ok',
    data: file,
  })
  vi.mocked(commands.loadCreationGitHistoryText).mockResolvedValue({
    status: 'ok',
    data: file,
  })
})
it('keeps an existing draft until explicit replacement and loads without saving or running', async () => {
  seedCreationDraft('server.js', 'saved\n', 'current')
  useCreationFilesStore.getState().edit('server.js', 'my draft')
  render(
    <CreationGitHistory identity="score" onBack={vi.fn()} onLoaded={vi.fn()} />
  )
  await screen.findByText(/most recent 30/)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Old version — abc123' })
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'server.js — View historical content' })
  )
  await screen.findByText('old', { exact: false })
  fireEvent.click(
    screen.getByRole('button', { name: 'Review load into draft' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Keep current draft' }))
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'my draft'
  )
  expect(commands.loadCreationGitHistoryText).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Review load into draft' })
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Replace draft with this history' })
  )
  await screen.findByText(
    'Historical text loaded into draft. Save and test explicitly.'
  )
  expect(useCreationFilesStore.getState().drafts['server.js']).toMatchObject({
    text: 'old\n',
    diskText: 'saved\n',
    diskVersion: 'current',
  })
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
})
