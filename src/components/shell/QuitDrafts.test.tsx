import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { registerCreationParticipant } from '@/lib/creation-lifecycle'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore, quitNow, requestQuit } from '@/store/window-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useAssistantStore } from '@/store/assistant-store'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationView } from '@/components/creation/CreationView'
import { QuitConfirmDialog } from './QuitConfirmDialog'

let unregister: (() => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useWindowStore.setState({ quitConfirmOpen: false })
})
afterEach(async () => {
  unregister?.()
  unregister = undefined
  cleanup()
  useCreationStore.setState({ workspace: null, active: false })
  useAssistantStore.getState().syncWorkspace(null)
  await flushAssistantHistory()
  await new Promise(resolve => setTimeout(resolve, 0))
})

it('lets an idle creator cancel quitting without saving or discarding drafts', async () => {
  const save = vi.fn()
  unregister = registerCreationParticipant({ unsavedCount: () => 3, save })
  await requestQuit()
  render(<QuitConfirmDialog />)
  expect(screen.getByText(/There are 3 unsaved creation drafts/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(useWindowStore.getState().quitConfirmOpen).toBe(false)
  expect(save).not.toHaveBeenCalled()
  expect(commands.quitApp).not.toHaveBeenCalled()
})

it('waits for all drafts to be saved before quitting', async () => {
  let count = 2
  let finish!: () => void
  const save = vi.fn(
    () =>
      new Promise<boolean>(resolve => {
        finish = () => {
          count = 0
          resolve(true)
        }
      })
  )
  unregister = registerCreationParticipant({ unsavedCount: () => count, save })
  await requestQuit()
  render(<QuitConfirmDialog />)
  fireEvent.click(screen.getByRole('button', { name: 'Save & Quit' }))
  expect(save).toHaveBeenCalledOnce()
  expect(commands.quitApp).not.toHaveBeenCalled()
  finish()
  await waitFor(() => expect(commands.quitApp).toHaveBeenCalledOnce())
})

it('keeps the app and confirmation open after a partial save or conflict', async () => {
  unregister = registerCreationParticipant({
    unsavedCount: () => 1,
    save: vi.fn().mockResolvedValue(false),
  })
  await requestQuit()
  render(<QuitConfirmDialog />)
  fireEvent.click(screen.getByRole('button', { name: 'Save & Quit' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('still unsaved')
  expect(useWindowStore.getState().quitConfirmOpen).toBe(true)
  expect(commands.quitApp).not.toHaveBeenCalled()
  expect(commands.markQuitting).not.toHaveBeenCalled()
})

it('requires separate handoff review or explicit discard instead of recording it', async () => {
  unregister = registerCreationParticipant({ unsavedCount: () => 1 })
  await requestQuit()
  render(<QuitConfirmDialog />)
  expect(screen.getByRole('button', { name: 'Save & Quit' })).toBeDisabled()
  expect(screen.getByText(/handoff draft needs separate review/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Discard & Quit' }))
  await waitFor(() => expect(commands.quitApp).toHaveBeenCalledOnce())
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it('the direct exit entry also refuses to discard drafts without confirmation', async () => {
  unregister = registerCreationParticipant({ unsavedCount: () => 1 })
  expect(await quitNow()).toBe(false)
  expect(useWindowStore.getState().quitConfirmOpen).toBe(true)
  expect(commands.quitApp).not.toHaveBeenCalled()
})

it('does not discard changed input while waiting for a running session to stop', async () => {
  let snapshot = { text: 'confirmed draft' }
  unregister = registerCreationParticipant({
    unsavedCount: () => 1,
    draftsSnapshot: () => snapshot,
  })
  useSessionStore.setState({ sessionStatus: 'ready' })
  let finish!: (value: Awaited<ReturnType<typeof commands.stopProject>>) => void
  vi.mocked(commands.stopProject).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  await requestQuit()
  render(<QuitConfirmDialog />)
  fireEvent.click(screen.getByRole('button', { name: 'Discard & Quit' }))
  await waitFor(() => expect(commands.stopProject).toHaveBeenCalledOnce())
  snapshot = { text: 'new input with the same draft count' }
  finish({ status: 'ok', data: null })
  expect(await screen.findByRole('alert')).toHaveTextContent('still unsaved')
  expect(commands.quitApp).not.toHaveBeenCalled()
  expect(useWindowStore.getState().quitConfirmOpen).toBe(true)
})

it('saves a real workspace draft through the registered CreationView participant', async () => {
  const workspace = {
    project: {
      identity: 'quit-view',
      root: '/quit-view',
      name: 'Quit view',
      source: 'folder' as const,
    },
    files: [
      {
        path: 'score.js',
        kind: 'text' as const,
        category: 'pages' as const,
        size: 5,
      },
    ],
  }
  useCreationStore.setState({ active: true, workspace, modePhase: 'idle' })
  useCreationHandoffStore.getState().clear()
  seedCreationDraft('score.js', 'saved', 'v1')
  useCreationFilesStore.getState().edit('score.js', 'creator edit')
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'v2',
  })
  render(
    <>
      <CreationView />
      <QuitConfirmDialog />
    </>
  )
  await waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('ready')
  )
  await requestQuit()
  fireEvent.click(await screen.findByRole('button', { name: 'Save & Quit' }))
  await waitFor(() => expect(commands.quitApp).toHaveBeenCalledOnce())
  expect(commands.saveCreationFile).toHaveBeenCalledWith(
    'quit-view',
    'score.js',
    'creator edit',
    'v1'
  )
  expect(useCreationFilesStore.getState().drafts['score.js']?.diskText).toBe(
    'creator edit'
  )
  expect(commands.markQuitting).not.toHaveBeenCalled()
})

it('rechecks a formerly clean draft after waiting for chat persistence on direct quit', async () => {
  let count = 0
  let snapshot = { text: 'saved' }
  unregister = registerCreationParticipant({
    unsavedCount: () => count,
    draftsSnapshot: () => snapshot,
  })
  useAssistantStore.getState().syncWorkspace('quit-history')
  await waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('ready')
  )
  useAssistantStore.setState({
    messages: [
      {
        id: 'saved-chat',
        role: 'assistant',
        text: 'Retained answer',
        status: 'completed',
        sources: [],
        scope: 'platform',
      },
    ],
  })
  vi.mocked(commands.saveAssistantHistory).mockClear()
  let finish!: (
    value: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ) => void
  vi.mocked(commands.saveAssistantHistory).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  const quitting = quitNow()
  await waitFor(() =>
    expect(commands.saveAssistantHistory).toHaveBeenCalledOnce()
  )
  count = 1
  snapshot = { text: 'new input while saving chat' }
  finish({ status: 'ok', data: null })
  expect(await quitting).toBe(false)
  expect(commands.quitApp).not.toHaveBeenCalled()
  expect(useWindowStore.getState().quitConfirmOpen).toBe(true)
})
