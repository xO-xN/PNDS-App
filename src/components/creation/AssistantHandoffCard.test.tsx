import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { confirm } from '@tauri-apps/plugin-dialog'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useAssistantHandoffStore } from '@/store/assistant-handoff-store'
import { AssistantHandoffCard } from './AssistantHandoffCard'
const offer = {
  reason: 'Needs cross-file wiring',
  intent: 'Wire a module',
  files: ['server.js', 'new.js'],
  knownProblems: 'Not implemented',
  acceptance: 'Creator verifies sound',
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'p',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationHandoffStore.getState().clear()
  useAssistantHandoffStore.getState().offer('p', 'reply', offer)
})
it('declines a complex task without preparing or recording anything', () => {
  render(<AssistantHandoffCard messageId="reply" />)
  expect(screen.getByText('Needs cross-file wiring')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Continue discussion' }))
  expect(useCreationHandoffStore.getState().pending).toHaveLength(0)
  expect(commands.readCreationHandoff).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})
it('invalidates delayed consent after changing projects', async () => {
  let finish!: (value: boolean) => void
  vi.mocked(confirm).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(<AssistantHandoffCard messageId="reply" />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Review external handoff' })
  )
  useCreationStore.setState({ workspace: null })
  await act(async () => {
    finish(true)
  })
  expect(useCreationHandoffStore.getState().pending).toHaveLength(0)
  expect(commands.readCreationHandoff).not.toHaveBeenCalled()
})
