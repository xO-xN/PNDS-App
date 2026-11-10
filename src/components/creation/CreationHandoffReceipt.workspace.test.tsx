import { beforeEach, expect, it, vi } from 'vitest'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { seedCreationDraft } from '@/test/creation-files'
import i18n from '@/i18n/config'
import {
  commands,
  type HandoffReceipt,
  type CreationWorkspace,
} from '@/lib/tauri-bindings'
import { handoffPrompt } from '@/lib/assistant-handoff-prompt'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import {
  HANDOFF_PATH,
  useCreationHandoffStore,
} from '@/store/creation-handoff-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useAssistantStore } from '@/store/assistant-store'
import { useSessionStore } from '@/store/session-store'
import { CreationView } from './CreationView'

const workspace: CreationWorkspace = {
  project: {
    identity: 'receipt-workspace',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [{ path: HANDOFF_PATH, kind: 'text', category: 'system', size: 20 }],
  directories: ['docs'],
}
const receipt: HandoffReceipt = {
  task: {
    id: '701a5180-a2dd-47dc-9319-9312f3790f64',
    intent: '实现已确认的音色逻辑',
    files: ['audio.js'],
    acceptance: '验证已有映射',
    status: 'pending',
  },
  revision: 'r1',
  document: {
    text: '# Confirmed handoff\n\nSaved requirements',
    version: 'h1',
  },
  instructions: 'Canonical instructions',
  taskRecorded: true,
  baselineId: 'b1',
  baselineError: null,
}
const baselineError = {
  code: 'io' as const,
  detail: 'Baseline journal unavailable',
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationStore.setState({
    active: true,
    workspace,
    opening: false,
    modePhase: 'idle',
    error: null,
  })
  useCreationFilesStore.getState().clear()
  seedCreationDraft(HANDOFF_PATH, receipt.document.text, 'h1')
  useCreationHandoffStore.getState().clear()
  useCreationHandoffStore.setState({ receipt, recorded: true })
  useAssistantStore.setState({
    owner: workspace.project.identity,
    messages: [],
    phase: 'idle',
  })
  useCreationTestStore.setState({
    tab: 'file',
    expanded: false,
    error: null,
    runtimeError: null,
  })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      head: 'saved',
      branch: 'main',
      changes: [],
      detail: null,
    },
  })
  vi.mocked(commands.getCreationGitVersions).mockResolvedValue({
    status: 'ok',
    data: {
      head: 'saved',
      branches: [{ name: 'main', tip: 'saved' }],
      versions: [
        {
          id: 'saved',
          message: 'Saved project',
          parents: [],
          timestamp: 1,
          files: [],
        },
      ],
      nextOffset: null,
      limited: false,
    },
  })
})

it.each(['recorded', 'baseline error', 'task error'] as const)(
  'never inserts a %s handoff result above Discussion/Git navigation',
  result => {
    if (result !== 'recorded')
      useCreationHandoffStore.setState({
        recorded: result !== 'task error',
        receipt: {
          ...receipt,
          taskRecorded: result !== 'task error',
          baselineId: null,
          baselineError,
        },
      })
    render(<CreationView />)
    expect(
      screen.getByRole('navigation', { name: i18n.t('assistant.readingViews') })
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: i18n.t('creation.handoff.copy') })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(i18n.t('creation.handoff.summaryWithBaseline'))
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(i18n.t('creation.handoff.summary'))
    ).not.toBeInTheDocument()
    expect(screen.queryByText(baselineError.detail)).not.toBeInTheDocument()
    act(() => useCreationReadingStore.getState().showGit())
    expect(
      screen.getByRole('region', { name: i18n.t('creation.versions.title') })
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: i18n.t('creation.handoff.copy') })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(baselineError.detail)).not.toBeInTheDocument()
    expect(useCreationHandoffStore.getState().receipt?.taskRecorded).toBe(
      result !== 'task error'
    )
  }
)

it.each([true, false])(
  'keeps receipt details, copy and baseline failures inside the handoff document (file exists: %s)',
  async exists => {
    useCreationHandoffStore.setState({
      receipt: { ...receipt, baselineId: null, baselineError },
    })
    if (!exists) {
      useCreationStore.setState({ workspace: { ...workspace, files: [] } })
      useCreationFilesStore.getState().clear()
    }
    render(<CreationView />)
    act(() => useCreationReadingStore.getState().showHandoff())
    const fileRegion = screen.getAllByRole('region', { name: HANDOFF_PATH })[0]
    if (!fileRegion) throw new Error('Expected the handoff reading surface')
    const document = within(fileRegion)
    const summary = document.getByText(i18n.t('creation.handoff.summary'))
    fireEvent.click(summary)
    expect(
      document.getByText(i18n.t('creation.handoff.recorded'))
    ).toBeVisible()
    expect(
      document.getByText(
        i18n.t('creation.handoff.revision', {
          id: receipt.task.id,
          revision: receipt.revision,
        })
      )
    ).toBeVisible()
    expect(
      document.getByText(i18n.t('creation.handoff.baselineFailed'))
    ).toBeVisible()
    expect(document.getByText(baselineError.detail)).toBeVisible()
    fireEvent.click(
      document.getByRole('button', { name: i18n.t('creation.handoff.copy') })
    )
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(handoffPrompt('/score', 'zh-CN'))
    )
    expect(useCreationHandoffStore.getState().receipt?.baselineError).toEqual(
      baselineError
    )
    expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
    expect(commands.appendCreationHandoff).not.toHaveBeenCalled()
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  }
)

it('retains an unrecorded task failure in the document without offering a recorded-task copy', () => {
  useCreationHandoffStore.setState({
    recorded: false,
    receipt: {
      ...receipt,
      taskRecorded: false,
      baselineId: null,
      baselineError,
    },
  })
  render(<CreationView />)
  act(() => useCreationReadingStore.getState().showHandoff())
  const fileRegion = screen.getAllByRole('region', { name: HANDOFF_PATH })[0]
  if (!fileRegion) throw new Error('Expected the handoff reading surface')
  expect(
    within(fileRegion).getByText(i18n.t('creation.handoff.taskFailed'))
  ).toBeVisible()
  expect(within(fileRegion).getByText(baselineError.detail)).toBeVisible()
  expect(
    within(fileRegion).queryByRole('button', {
      name: i18n.t('creation.handoff.copy'),
    })
  ).not.toBeInTheDocument()
})
