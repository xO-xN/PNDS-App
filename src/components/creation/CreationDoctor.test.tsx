import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import {
  commands,
  type CreationWorkspace,
  type DiagnosticReport,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationView } from './CreationView'

const workspace: CreationWorkspace = {
  project: {
    identity: 'doctor-score',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [{ path: 'server.js', size: 12, kind: 'text', category: 'system' }],
}
const report: DiagnosticReport = {
  schemaVersion: 1,
  checkerVersion: '1.6.4',
  projectPath: '/score',
  project: { id: 'score', name: 'Score', version: '0.1.0' },
  inputFingerprint: 'disk-1',
  inputs: [{ path: 'server.js', kind: 'file', fingerprint: 'file-1' }],
  checks: [
    { code: 'manifest', status: 'passed', reason: 'Manifest parsed' },
    {
      code: 'assets',
      status: 'skipped',
      reason: 'Manifest prerequisite missing',
    },
  ],
  issues: [
    {
      code: 'entry-missing',
      severity: 'error',
      path: 'server.js',
      field: 'scoreServer.entry',
      reason: 'Entry is missing',
    },
    {
      code: 'unknown',
      severity: 'warning',
      path: null,
      field: null,
      reason: 'Unknown declaration',
    },
  ],
  unverified: ['Real sound and devices'],
  staticPassed: false,
}
beforeEach(() => {
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
    sessionStatus: 'starting',
    commandPending: true,
    sessionProjectPath: '/live-performance',
  })
  vi.mocked(commands.diagnoseCreationProject).mockResolvedValue({
    status: 'ok',
    data: report,
  })
  vi.mocked(commands.creationDiagnosticIsStale).mockResolvedValue({
    status: 'ok',
    data: false,
  })
})
it('diagnoses saved disk during startup and locates issues without saving drafts or changing the run', async () => {
  seedCreationDraft('server.js', 'disk text', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'unsaved draft')
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Static Doctor' }))
  await screen.findByRole('dialog', { name: 'Static Doctor' })
  await screen.findByText('Entry is missing')
  expect(screen.getByText('Unknown declaration')).toBeInTheDocument()
  expect(screen.getByText('Manifest prerequisite missing')).toBeInTheDocument()
  expect(screen.getByText('Real sound and devices')).toBeInTheDocument()
  expect(screen.getByText('scoreServer.entry')).toBeInTheDocument()
  expect(screen.getByText('0.1.0')).toBeInTheDocument()
  expect(screen.getByText('1 unsaved draft')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open file: server.js' }))
  await waitFor(() =>
    expect(useCreationFilesStore.getState().activePath).toBe('server.js')
  )
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'unsaved draft'
  )
  expect(useSessionStore.getState().sessionProjectPath).toBe(
    '/live-performance'
  )
  expect(commands.diagnoseCreationProject).toHaveBeenCalledWith('doctor-score')
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.preflightCreationProject).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.cleanupOrphanedProcesses).not.toHaveBeenCalled()
})

it('retains a report across drafts but marks real saved changes stale until explicit recheck', async () => {
  seedCreationDraft('server.js', 'disk text', 'v1')
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Static Doctor' }))
  await screen.findByText('Entry is missing')
  act(() => useCreationFilesStore.getState().edit('server.js', 'another draft'))
  expect(
    screen.queryByText(/This report is out of date/)
  ).not.toBeInTheDocument()
  act(() => useCreationFilesStore.getState().changed(['server.js']))
  expect(screen.getByText(/This report is out of date/)).toBeInTheDocument()
  fireEvent(window, new Event('focus'))
  expect(screen.getByText(/This report is out of date/)).toBeInTheDocument()
  vi.mocked(commands.diagnoseCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...report,
      inputFingerprint: 'disk-2',
      staticPassed: true,
      issues: [],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
  await screen.findByText('The selected static checks passed.')
  expect(
    screen.queryByText(/This report is out of date/)
  ).not.toBeInTheDocument()
  expect(
    screen.getByText(/Static results do not verify runtime behavior/)
  ).toBeInTheDocument()
})

it('detects changed diagnostic inputs outside the ordinary file watcher when focus returns', async () => {
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Static Doctor' }))
  await screen.findByText('Entry is missing')
  await waitFor(() =>
    expect(commands.creationDiagnosticIsStale).toHaveBeenCalledWith(
      'doctor-score',
      'disk-1'
    )
  )
  vi.mocked(commands.creationDiagnosticIsStale).mockResolvedValueOnce({
    status: 'ok',
    data: true,
  })
  fireEvent(window, new Event('focus'))
  await screen.findByText(/This report is out of date/)
})

it('ignores late diagnostics after a workspace switch and diagnoses the new identity', async () => {
  let complete:
    | ((
        result: Awaited<ReturnType<typeof commands.diagnoseCreationProject>>
      ) => void)
    | undefined
  vi.mocked(commands.diagnoseCreationProject).mockReturnValueOnce(
    new Promise(resolve => {
      complete = resolve
    })
  )
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Static Doctor' }))
  await screen.findByText('Reading saved project…')
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: {
          ...workspace.project,
          identity: 'next-score',
          root: '/next',
        },
      },
    })
  )
  await act(async () =>
    complete?.({
      status: 'ok',
      data: {
        ...report,
        project: { id: 'old-score', name: 'Old project', version: '9.9.9' },
      },
    })
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Static Doctor' }))
  await screen.findByText('Entry is missing')
  expect(screen.queryByText('Old project')).not.toBeInTheDocument()
  expect(commands.diagnoseCreationProject).toHaveBeenLastCalledWith(
    'next-score'
  )
})

it('retains old disk changes that arrive while diagnostics are being read', async () => {
  let complete:
    | ((
        result: Awaited<ReturnType<typeof commands.diagnoseCreationProject>>
      ) => void)
    | undefined
  vi.mocked(commands.diagnoseCreationProject).mockReturnValueOnce(
    new Promise(resolve => {
      complete = resolve
    })
  )
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Static Doctor' }))
  await screen.findByText('Reading saved project…')
  act(() => useCreationFilesStore.getState().changed(['server.js']))
  await act(async () => complete?.({ status: 'ok', data: report }))
  await screen.findByText(/This report is out of date/)
})

it('offers keyboard diagnosis during shutdown for read-only sources and restores entrance focus', async () => {
  const userEvent = (await import('@testing-library/user-event')).default
  useSessionStore.setState({ sessionStatus: 'stopping' })
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, source: 'bundle' },
    },
  })
  render(<CreationView />)
  const entrance = screen.getByRole('button', { name: 'Static Doctor' })
  expect(entrance).toBeEnabled()
  entrance.focus()
  await userEvent.keyboard('{Enter}')
  await screen.findByText('Entry is missing')
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(entrance).toHaveFocus()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('explains command failures and allows explicit retry without claiming a completed report', async () => {
  vi.mocked(commands.diagnoseCreationProject).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'permission', detail: 'Cannot read project' },
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Static Doctor' }))
  await screen.findByText('Cannot read project')
  expect(
    screen.queryByText('The selected static checks passed.')
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
  await screen.findByText('Entry is missing')
})
