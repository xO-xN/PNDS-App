import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '@/i18n/config'
import { commands, type PendingIntegrationReceipt } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useAssistantStore } from '@/store/assistant-store'
import { seedCreationDraft } from '@/test/creation-files'
import { PendingIntegrationRecovery } from './PendingIntegrationRecovery'
const receipt: PendingIntegrationReceipt = {
  taskId: 'integration',
  sources: [
    {
      id: 'a'.repeat(32),
      name: 'Pattern.js',
      version: 'b'.repeat(64),
      size: 4,
      totalCharacters: 4,
    },
  ],
  targets: [
    { path: 'public/Pattern.js', version: 'integrated-v1' },
    { path: 'server.js', version: 'wired-v1' },
  ],
  verification: 'unverified',
  reason: 'activeRuntime',
  restored: false,
}
beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  useAssistantStore.setState({ phase: 'idle', resourceApproval: null })
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'owner',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  vi.mocked(commands.getCreationPendingIntegration).mockResolvedValue({
    status: 'ok',
    data: receipt,
  })
})
it('offers persistent whole-task recovery and a separate originals-only path after a newer edit conflict', async () => {
  vi.mocked(commands.restoreCreationPendingIntegration)
    .mockResolvedValueOnce({
      status: 'error',
      error: { code: 'versionConflict', detail: 'server.js' },
    })
    .mockResolvedValueOnce({
      status: 'ok',
      data: { ...receipt, restored: true },
    })
  render(<PendingIntegrationRecovery identity="owner" disabled={false} />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Undo integration' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('newer')
  fireEvent.click(
    screen.getByRole('button', { name: 'Restore originals only' })
  )
  await waitFor(() =>
    expect(commands.restoreCreationPendingIntegration).toHaveBeenLastCalledWith(
      'owner',
      true
    )
  )
  expect(await screen.findByRole('status')).toHaveTextContent('restored')
})
it('protects a dirty target before whole-task recovery but permits restoring original pending sources', async () => {
  seedCreationDraft('server.js', 'saved', 'wired-v1')
  useCreationFilesStore.getState().edit('server.js', 'new unsaved entry')
  render(<PendingIntegrationRecovery identity="owner" disabled={false} />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Undo integration' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('unsaved')
  expect(commands.restoreCreationPendingIntegration).not.toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Restore originals only' })
  ).toBeEnabled()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'new unsaved entry'
  )
})
