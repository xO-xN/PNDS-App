import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationDebugPanel } from './CreationDebugPanel'
import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationView } from './CreationView'
import { creationProjectAction } from '@/test/desktop-actions'

type Task = Extract<
  Awaited<ReturnType<typeof commands.getCreationCheck>>,
  { status: 'ok' }
>['data']
const workspace: CreationWorkspace = {
  project: {
    identity: 'check-score',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [{ path: 'server.js', size: 12, kind: 'text', category: 'system' }],
}
const report: NonNullable<Task['report']> = {
  schemaVersion: 1,
  checkerVersion: '1.6.5',
  taskId: 'check-1',
  projectPath: '/score',
  mode: 'none',
  status: 'passed',
  error: null,
  diagnostics: null,
  evidence: null,
  freshness: { stale: false, complete: true, reasons: [] },
  environment: {
    nodeBinary: '/offline/node',
    nodeVersion: 'v24.0.0',
    outputDevice: null,
    sampleRate: null,
    channelPlan: null,
    oscTarget: null,
  },
  checks: [
    {
      code: 'health',
      status: 'passed',
      reason: 'Health matched the copied project identity',
    },
  ],
  health: null,
  outputTail: [],
  cleanup: {
    nodeConfirmed: true,
    audioConfirmed: true,
    temporaryFilesRemoved: true,
    errors: [],
  },
  unverified: ['pageRendering', 'phoneConnections', 'modelInference', 'sound'],
}
const completed: Task = {
  taskId: 'check-1',
  identity: 'check-score',
  progress: null,
  report,
}
beforeEach(() => {
  useCreationTestStore.setState({
    debugView: 'preview',
    debugVisited: { static: false, controlled: false },
  })
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: null,
    modePhase: 'idle',
    opening: false,
    request: null,
    error: null,
  })
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({ workspace })
  useSessionStore.setState({
    sessionStatus: 'idle',
    commandPending: false,
    sessionProjectPath: null,
  })
  vi.mocked(commands.startCreationCheck).mockResolvedValue({
    status: 'ok',
    data: 'check-1',
  })
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: completed,
  })
  vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
    status: 'ok',
    data: false,
  })
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: 'en' },
  })
})
async function openCheck() {
  await creationProjectAction('Controlled check')
  await screen.findByRole('region', { name: 'Controlled check' })
}
it('offers an independent check from the workspace menu and leaves failed input for the user to edit, undo or hand off (#209)', async () => {
  useCreationReadingStore.getState().showDiscussion()
  seedCreationDraft('server.js', 'saved', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'my next edit')
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: {
      ...completed,
      report: {
        ...report,
        status: 'failed',
        error: 'Controlled health failure',
      },
    },
  })
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await creationProjectAction('Controlled check')
  await screen.findByRole('region', { name: 'Controlled check' })
  expect(commands.startCreationCheck).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await screen.findByText('Controlled health failure')
  expect(
    screen.getByRole('button', { name: 'Continue editing' })
  ).toBeInTheDocument()
  vi.mocked(confirm).mockResolvedValue(false)
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare repair handoff' })
  )
  await waitFor(() => expect(confirm).toHaveBeenCalled())
  expect(commands.appendCreationHandoff).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'my next edit'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.saveCreationFileChange).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})
it('opens without starting, then checks saved inputs in None and shows cleanup without saving drafts', async () => {
  seedCreationDraft('server.js', 'saved', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'draft')
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  expect(commands.startCreationCheck).not.toHaveBeenCalled()
  expect(
    screen.getByRole('combobox', { name: 'Audio mode' })
  ).toHaveTextContent(/^None$/)
  expect(screen.getByText(/1 unsaved draft/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await screen.findByText('The controlled check passed.')
  expect(
    screen.getByText('Full check report').closest('details')
  ).not.toHaveAttribute('open')
  expect(
    screen.getByText('Health matched the copied project identity')
  ).not.toBeVisible()
  fireEvent.click(screen.getByText('Full check report'))
  expect(
    screen.getByText('Health matched the copied project identity')
  ).toBeVisible()

  expect(commands.startCreationCheck).toHaveBeenCalledWith('check-score', {
    mode: 'none',
    compile: false,
    timeoutMs: 30000,
    outputDevice: null,
    sampleRate: 48000,
  })
  expect(
    screen.getByText('Health matched the copied project identity')
  ).toBeInTheDocument()
  expect(screen.getByText('Node stopped: Confirmed')).toBeInTheDocument()
  expect(screen.getByText('Actual sound content')).toBeInTheDocument()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'draft'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.savePreferences).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})
it('uses explicit Internal and compilation choices with a current preference snapshot', async () => {
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: {
      theme: 'system',
      language: 'en',
      outputDevice: 'Stage interface',
      sampleRate: 96000,
    },
  })
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Audio mode' }))
  await user.click(await screen.findByRole('option', { name: 'Internal' }))
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Compile SynthDefs in the copy' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await screen.findByText('The controlled check passed.')
  expect(commands.startCreationCheck).toHaveBeenCalledWith('check-score', {
    mode: 'internal',
    compile: true,
    timeoutMs: 30000,
    outputDevice: 'Stage interface',
    sampleRate: 96000,
  })
  expect(commands.savePreferences).not.toHaveBeenCalled()
})
it('keeps a backend refusal visible while an existing performance remains untouched', async () => {
  useSessionStore.setState({
    sessionStatus: 'starting',
    commandPending: true,
    sessionProjectPath: '/live',
  })
  vi.mocked(commands.startCreationCheck).mockResolvedValue({
    status: 'error',
    error: { code: 'testValidation', detail: 'A PNDS performance is active' },
  })
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await screen.findByText('A PNDS performance is active')
  expect(useSessionStore.getState().sessionProjectPath).toBe('/live')
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.getCreationCheck).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await openCheck()
  expect(screen.getByText('A PNDS performance is active')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Copy report' }))
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify(
        {
          workspaceIdentity: 'check-score',
          taskId: null,
          report: null,
          error: {
            code: 'testValidation',
            detail: 'A PNDS performance is active',
          },
        },
        null,
        2
      )
    )
  )
})
it('retains a failed report when the dialog is dismissed and reopened without rerunning', async () => {
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: {
      ...completed,
      report: {
        ...report,
        status: 'failed',
        error: 'Test saved snapshot is missing a required SynthDef',
      },
    },
  })
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await screen.findByText('Test saved snapshot is missing a required SynthDef')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(
    screen.queryByRole('region', { name: 'Controlled check' })
  ).not.toBeInTheDocument()
  await openCheck()
  expect(
    await screen.findByText(
      'Test saved snapshot is missing a required SynthDef'
    )
  ).toBeInTheDocument()
  expect(screen.getByText('Node stopped: Confirmed')).toBeInTheDocument()
  expect(commands.startCreationCheck).toHaveBeenCalledTimes(1)
})
it('copies the complete failed report including the original error and cleanup after reopening', async () => {
  const failed = {
    ...report,
    status: 'failed' as const,
    error: 'Missing Test dependency',
  }
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: { ...completed, report: failed },
  })
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await screen.findByText('Missing Test dependency')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await openCheck()
  fireEvent.click(screen.getByRole('button', { name: 'Copy report' }))
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify(
        {
          workspaceIdentity: 'check-score',
          taskId: 'check-1',
          report: failed,
          error: null,
        },
        null,
        2
      )
    )
  )
})
it('stops the owned task and waits for the cancellation report with cleanup', async () => {
  vi.mocked(commands.getCreationCheck).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...completed,
      report: null,
      progress: {
        taskId: 'check-1',
        projectPath: '/score',
        phase: 'health',
        path: null,
        copiedBytes: 0,
      },
    },
  })
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await screen.findByText('Verifying health identity and configuration…')
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: { ...completed, report: { ...report, status: 'cancelled' } },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Stop check' }))
  await screen.findByText(
    'The check was cancelled. Open the full report to review cleanup.'
  )
  expect(commands.cancelCreationCheck).toHaveBeenCalledWith('check-1')
  expect(
    screen.getByText('Temporary files removed: Confirmed')
  ).toBeInTheDocument()
})
it('cancels a task whose start finishes after its dialog closes', async () => {
  let finish:
    | ((value: Awaited<ReturnType<typeof commands.startCreationCheck>>) => void)
    | undefined
  vi.mocked(commands.startCreationCheck).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await waitFor(() => expect(commands.startCreationCheck).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: {
      ...completed,
      taskId: 'late-check',
      report: { ...report, taskId: 'late-check', status: 'cancelled' },
    },
  })
  await act(async () => finish?.({ status: 'ok', data: 'late-check' }))
  await waitFor(() =>
    expect(commands.cancelCreationCheck).toHaveBeenCalledWith('late-check')
  )
  expect(
    screen.queryByRole('region', { name: 'Controlled check' })
  ).not.toBeInTheDocument()
  await openCheck()
  await screen.findByText(
    'The check was cancelled. Open the full report to review cleanup.'
  )
  expect(commands.startCreationCheck).toHaveBeenCalledTimes(1)
})
it('cancels on workspace switch and ignores a late report from the previous identity', async () => {
  let finish:
    | ((value: Awaited<ReturnType<typeof commands.getCreationCheck>>) => void)
    | undefined
  vi.mocked(commands.getCreationCheck).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await waitFor(() => expect(commands.getCreationCheck).toHaveBeenCalled())
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: { ...workspace.project, identity: 'next', root: '/next' },
      },
    })
  )
  await act(async () => finish?.({ status: 'ok', data: completed }))
  expect(commands.cancelCreationCheck).toHaveBeenCalledWith('check-1')
  expect(
    screen.queryByText('The controlled check passed.')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Controlled check' })
  ).not.toBeInTheDocument()
})
it('checks actual backend freshness on focus and marks disk changes stale', async () => {
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  await screen.findByText('The controlled check passed.')
  await waitFor(() =>
    expect(commands.creationCheckIsStale).toHaveBeenCalledWith(
      'check-score',
      'check-1'
    )
  )
  vi.mocked(commands.creationCheckIsStale).mockResolvedValue({
    status: 'ok',
    data: true,
  })
  fireEvent(window, new Event('focus'))
  await screen.findByText(/This result is out of date/)
  expect(commands.startCreationCheck).toHaveBeenCalledTimes(1)
})

it('keeps failed checks and unconfirmed cleanup visible while the full report is collapsed', async () => {
  vi.mocked(commands.getCreationCheck).mockResolvedValue({
    status: 'ok',
    data: {
      ...completed,
      report: {
        ...report,
        status: 'failed',
        checks: [
          {
            code: 'health',
            status: 'failed',
            reason: 'Monitor health did not respond',
          },
        ],
        cleanup: {
          ...report.cleanup,
          nodeConfirmed: false,
          errors: ['Node stop was not confirmed'],
        },
      },
    },
  })
  render(
    <>
      <CreationView />
      <CreationDebugPanel hidden={false} />
    </>
  )
  await openCheck()
  fireEvent.click(screen.getByRole('button', { name: 'Start check' }))
  expect(
    await screen.findByText('Monitor health did not respond')
  ).toBeVisible()
  expect(
    screen.getByText('Full check report').closest('details')
  ).not.toHaveAttribute('open')
  expect(screen.getByText(/Cleanup is not fully confirmed/)).toBeVisible()
  expect(
    screen
      .getAllByText('Node stop was not confirmed')
      .some(element => !element.closest('details'))
  ).toBe(true)
  expect(screen.getByRole('button', { name: 'Continue editing' })).toBeVisible()
  expect(screen.getByText('1.6.5')).not.toBeVisible()
})
