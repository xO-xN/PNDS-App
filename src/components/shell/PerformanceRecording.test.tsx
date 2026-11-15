import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import i18n from '@/i18n/config'
import { notifications } from '@/lib/notifications'
import {
  commands,
  type PerformanceRecord,
  type RecordingSnapshot,
} from '@/lib/tauri-bindings'
import * as recordingEvents from '@/lib/events'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { useProjectStore } from '@/store/project-store'
import { PerformanceRecording } from './PerformanceRecording'
import { useRecordingFileDrop } from './use-recording-file-drop'

vi.mock('./use-recording-file-drop', () => ({
  useRecordingFileDrop: vi.fn(() => false),
}))

vi.mock('@/lib/notifications', () => ({
  notifications: {
    flow: {
      step: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      dismiss: vi.fn(),
    },
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((success, failure) => {
    resolve = success
    reject = failure
  })
  return { promise, resolve, reject }
}

function snapshot(values: Partial<RecordingSnapshot> = {}): RecordingSnapshot {
  return {
    revision: 0,
    operationId: null,
    recordId: null,
    projectPath: '/score',
    status: 'idle',
    elapsedMs: 0,
    durationMs: null,
    error: null,
    supported: true,
    ...values,
  }
}
function savedRecord(
  values: Partial<PerformanceRecord> = {}
): PerformanceRecord {
  const source = {
    projectId: 'score',
    projectName: 'Score',
    contentDigest: 'sha256:original',
    adapter: { protocolVersion: 1, adapterId: 'score-v1' },
  }
  return {
    schemaVersion: 2,
    id: 'record-one',
    createdAt: '0',
    complete: true,
    durationMs: 10000,
    originalSource: source,
    interpretedBy: source,
    initialState: {},
    events: [],
    performers: [
      { id: 'A', label: 'Phone', selection: 3 },
      { id: 'B', label: 'Tablet', selection: 3 },
      { id: 'C', label: 'Phone', selection: 5 },
    ],
    passes: [
      { id: 'pass-one', performerIds: ['A', 'B'], legacy: false },
      { id: 'pass-two', performerIds: ['C'], legacy: false },
    ],
    ...values,
  }
}
function name(record = savedRecord()) {
  return new Date(Number(record.createdAt)).toLocaleString()
}
function creationWorkspace(identity = 'native-workspace') {
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity,
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
}
async function openPanel() {
  await userEvent.click(
    screen.getByRole('button', { name: 'Performance recordings' })
  )
}
async function openRecord(record = savedRecord()) {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open ' + name(record) })
  )
}
async function expandPasses(count = 2) {
  const button = screen.getByRole('button', {
    name: 'Recording passes: ' + count,
  })
  if (button.getAttribute('aria-expanded') === 'false')
    await userEvent.click(button)
}
function pendingRecordDeletion(record = savedRecord()) {
  const [button] = screen.getAllByRole('button', {
    name: 'Click again to delete ' + name(record),
  })
  if (!button) throw new Error('Missing inline recording deletion control')
  return button
}
let publish: (value: RecordingSnapshot) => void

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useRecordingFileDrop).mockReturnValue(false)
  vi.mocked(commands.exportPerformanceRecord).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
  })
  useCreationStore.setState({ active: false, workspace: null })
  useProjectStore.setState({ currentProject: null })
  vi.mocked(commands.getRecordingState).mockResolvedValue({
    status: 'ok',
    data: snapshot(),
  })
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [savedRecord()],
  })
  vi.mocked(commands.stopPerformanceRecording).mockResolvedValue({
    status: 'ok',
    data: snapshot({ revision: 3 }),
  })
  vi.spyOn(recordingEvents, 'onRecordingSnapshot').mockImplementation(
    callback => {
      publish = callback
      return () => undefined
    }
  )
})

it('opens a recording from the list and rerecords the whole selected multi-performer pass', async () => {
  creationWorkspace()
  vi.mocked(commands.beginPerformanceRecording).mockResolvedValue({
    status: 'ok',
    data: snapshot({
      revision: 1,
      operationId: 'replace',
      recordId: 'record-one',
      status: 'rerecord',
    }),
  })
  render(<PerformanceRecording />)
  await openPanel()
  expect(
    screen.queryByRole('button', { name: 'Play from beginning' })
  ).not.toBeInTheDocument()
  await openRecord()
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  await expandPasses()
  expect(
    within(screen.getByRole('list', { name: 'Recording passes' })).getAllByRole(
      'listitem'
    )
  ).toHaveLength(2)
  expect(
    screen.queryByText(/Performer 1|Score selection|Phone|Tablet/)
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Rerecord Recording pass: 1' })
  )
  expect(commands.beginPerformanceRecording).toHaveBeenCalledWith(
    'rerecord',
    'record-one',
    'pass-one',
    true,
    'native-workspace'
  )
})

it('requires a second click on the same row to delete a recording and refreshes the list', async () => {
  render(<PerformanceRecording />)
  await openPanel()
  const deletion = await screen.findByRole('button', {
    name: 'Delete recording ' + name(),
  })
  const row = deletion.closest('li')
  if (!row) throw new Error('Recording deletion must belong to a record row')
  await userEvent.click(deletion)
  expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
  expect(pendingRecordDeletion().closest('li')).toBe(row)
  expect(row).toHaveTextContent('Click again to delete')
  expect(
    screen.queryByRole('button', { name: 'Cancel' })
  ).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Open ' + name() })
  ).toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  )
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  const deleting =
    deferred<Awaited<ReturnType<typeof commands.deletePerformanceRecord>>>()
  vi.mocked(commands.deletePerformanceRecord).mockReturnValueOnce(
    deleting.promise
  )
  fireEvent.click(pendingRecordDeletion())
  expect(commands.deletePerformanceRecord).toHaveBeenCalledWith(
    '/score',
    'record-one'
  )
  expect(screen.getByRole('button', { name: 'New recording' })).toBeDisabled()
  await act(async () => deleting.resolve({ status: 'ok', data: null }))
  expect(await screen.findByText('No recordings yet.')).toBeInTheDocument()
  expect(
    screen
      .getByRole('list', { name: 'Recordings' })
      .closest('.recording-list-scroll')
  ).toHaveFocus()
})

it('deletes one pass without deleting the recording and keeps its detail open', async () => {
  creationWorkspace()
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await expandPasses()
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete Recording pass: 1' })
  )
  expect(commands.deleteRecordingPass).not.toHaveBeenCalled()
  vi.mocked(commands.deleteRecordingPass).mockResolvedValue({
    status: 'ok',
    data: savedRecord({ passes: [] }),
  })
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [savedRecord({ passes: [] })],
  })
  const [confirmation] = screen.getAllByRole('button', {
    name: /Click again to delete/,
  })
  if (!confirmation) throw new Error('Missing inline pass deletion control')
  await userEvent.click(confirmation)
  expect(commands.deleteRecordingPass).toHaveBeenCalledWith(
    '/score',
    'record-one',
    'pass-one'
  )
  expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
  expect(
    await screen.findByText(i18n.t('recording.emptyPasses'))
  ).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: name() })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Overdub' })).toBeEnabled()
  expect(
    screen.getByRole('button', { name: 'Recording passes: 0' })
  ).toHaveFocus()
})

it('keeps an active recording running through list navigation and prevents deleting its data', async () => {
  creationWorkspace()
  const active = snapshot({
    revision: 1,
    operationId: 'add',
    recordId: 'record-one',
    status: 'overdub',
    elapsedMs: 5000,
  })
  vi.mocked(commands.beginPerformanceRecording).mockResolvedValue({
    status: 'ok',
    data: active,
  })
  render(<PerformanceRecording />)
  const barIcon = screen
    .getByRole('button', { name: 'Performance recordings' })
    .querySelector('svg')
  expect(barIcon).toHaveClass('lucide-cassette-tape')
  expect(barIcon).not.toHaveClass('recording-active')
  expect(screen.getByTestId('recording-bar-status')).toHaveClass(
    'desktop-optional-label'
  )
  await openPanel()
  await openRecord()
  await expandPasses()
  await userEvent.click(screen.getByRole('button', { name: 'Overdub' }))
  expect(
    screen.getByRole('button', { name: 'Delete Recording pass: 1' })
  ).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  ).toBeDisabled()
  expect(screen.getByTestId('recording-bar-status')).toHaveTextContent(
    'Overdubbing · 0:05'
  )
  expect(barIcon).toHaveClass('lucide-cassette-tape', 'recording-active')
  expect(screen.getByTestId('recording-bar-status')).not.toHaveClass(
    'desktop-optional-label'
  )
  await openRecord()
  expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled()
  await userEvent.keyboard('{Escape}')
  expect(
    screen.queryByRole('heading', { name: 'Performance recordings' })
  ).not.toBeInTheDocument()
  expect(commands.stopPerformanceRecording).not.toHaveBeenCalled()
  expect(screen.getByTestId('recording-bar-status')).toHaveTextContent('0:05')
})

it('enters the new recording detail immediately and stays there after automatically saving', async () => {
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  vi.mocked(commands.beginPerformanceRecording).mockResolvedValue({
    status: 'ok',
    data: snapshot({
      revision: 1,
      operationId: 'first',
      recordId: 'new-record',
      status: 'recording',
      elapsedMs: 5000,
    }),
  })
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(screen.getByRole('button', { name: 'New recording' }))
  expect(commands.beginPerformanceRecording).toHaveBeenCalledWith(
    'recording',
    null,
    null,
    true,
    null
  )
  expect(
    screen.getByRole('heading', { name: 'Current recording' })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [savedRecord({ id: 'new-record' })],
  })
  act(() => publish(snapshot({ revision: 2, recordId: 'new-record' })))
  expect(
    await screen.findByRole('heading', { name: name() })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Play from beginning' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'New recording' })
  ).not.toBeInTheDocument()
})

it('saves and refreshes the selected recording without returning to the list', async () => {
  creationWorkspace()
  vi.mocked(commands.beginPerformanceRecording).mockResolvedValue({
    status: 'ok',
    data: snapshot({
      revision: 1,
      operationId: 'add',
      recordId: 'record-one',
      status: 'overdub',
    }),
  })
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await userEvent.click(screen.getByRole('button', { name: 'Overdub' }))
  await userEvent.click(screen.getByRole('button', { name: 'Stop and save' }))
  expect(commands.stopPerformanceRecording).toHaveBeenCalledWith(false)
  expect(screen.getByRole('heading', { name: name() })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Overdub' })).toBeEnabled()
})

it('plays legacy content directly through the current compatible project in one action', async () => {
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [
      savedRecord({
        passes: [{ id: 'legacy', performerIds: ['A', 'B', 'C'], legacy: true }],
      }),
    ],
  })
  vi.mocked(commands.beginPerformanceRecording).mockResolvedValueOnce({
    status: 'ok',
    data: snapshot({
      revision: 1,
      operationId: 'replay',
      recordId: 'record-one',
      status: 'playback',
    }),
  })
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await expandPasses(1)
  expect(screen.getByText('Recording pass: 1')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Overdub' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Rerecord Existing content' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Play from beginning' })
  )
  expect(commands.beginPerformanceRecording).toHaveBeenCalledTimes(1)
  expect(commands.beginPerformanceRecording).toHaveBeenCalledWith(
    'playback',
    'record-one',
    null,
    true,
    null
  )
  expect(
    screen.queryByRole('button', { name: 'Use the current compatible project' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(i18n.t('recording.contentChanged'))
  ).not.toBeInTheDocument()
  expect(screen.getByTestId('recording-bar-status')).toHaveTextContent(
    'Playing'
  )
})

it.each(['overdub', 'rerecord'] as const)(
  'uses the current project for %s without a changed-content confirmation',
  async mode => {
    creationWorkspace()
    vi.mocked(commands.beginPerformanceRecording).mockResolvedValueOnce({
      status: 'ok',
      data: snapshot({
        revision: 1,
        operationId: 'write-pass',
        recordId: 'record-one',
        status: mode,
      }),
    })
    render(<PerformanceRecording />)
    await openPanel()
    await openRecord()
    if (mode === 'rerecord') await expandPasses()
    await userEvent.click(
      screen.getByRole('button', {
        name: mode === 'overdub' ? 'Overdub' : 'Rerecord Recording pass: 1',
      })
    )
    expect(commands.beginPerformanceRecording).toHaveBeenCalledTimes(1)
    expect(commands.beginPerformanceRecording).toHaveBeenCalledWith(
      mode,
      'record-one',
      mode === 'rerecord' ? 'pass-one' : null,
      true,
      'native-workspace'
    )
    expect(
      screen.queryByText(i18n.t('recording.contentChanged'))
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'Use the current compatible project',
      })
    ).not.toBeInTheDocument()
  }
)

it.each(['recording.incompatible', 'recording.contentChanged'])(
  'reports playback failure without a compatibility confirmation or retry for %s',
  async error => {
    vi.mocked(commands.beginPerformanceRecording).mockResolvedValueOnce({
      status: 'error',
      error,
    })
    render(<PerformanceRecording />)
    await openPanel()
    await openRecord()
    await userEvent.click(
      screen.getByRole('button', { name: 'Play from beginning' })
    )
    expect(commands.beginPerformanceRecording).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', {
        name: 'Use the current compatible project',
      })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(i18n.t('recording.contentChanged'))
    ).not.toBeInTheDocument()
    const message = i18n.t('recording.operationFailed')
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(notifications.flow.fail).toHaveBeenCalledWith(
      expect.any(String),
      i18n.t('recording.feedback.failed'),
      message
    )
    expect(notifications.flow.succeed).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Play from beginning' })
    ).toBeEnabled()
  }
)

it('exports from the recording detail without requiring a running project or a separate save', async () => {
  creationWorkspace()
  useSessionStore.setState({ sessionStatus: 'idle', sessionProjectPath: null })
  vi.mocked(save).mockResolvedValueOnce('/export.pndsrecord')
  render(<PerformanceRecording />)
  await openPanel()
  expect(
    screen.queryByRole('button', { name: 'Export ' + name() })
  ).not.toBeInTheDocument()
  await openRecord()
  const exportButton = screen.getByRole('button', { name: 'Export' })
  expect(exportButton.querySelector('svg')).toHaveClass('lucide-upload')
  await userEvent.click(exportButton)
  expect(commands.exportPerformanceRecord).toHaveBeenCalledWith(
    '/score',
    'record-one',
    '/export.pndsrecord'
  )
  expect(
    screen.getByRole('button', { name: 'Play from beginning' })
  ).toBeDisabled()
})

it.each(['pndsrecord', 'json'])(
  'imports a .%s recording into the list after refreshing the catalog',
  async extension => {
    const imported = savedRecord({ id: 'imported', createdAt: '1000' })
    const source = '/import.' + extension
    vi.mocked(open).mockResolvedValueOnce(source)
    vi.mocked(commands.importPerformanceRecord).mockResolvedValueOnce({
      status: 'ok',
      data: imported,
    })
    render(<PerformanceRecording />)
    await openPanel()
    vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
      status: 'ok',
      data: [savedRecord(), imported],
    })
    await userEvent.click(
      screen.getByRole('button', { name: 'Import recording' })
    )
    expect(open).toHaveBeenCalledWith({
      multiple: true,
      filters: [
        { name: i18n.t('recording.file'), extensions: ['pndsrecord', 'json'] },
      ],
    })
    expect(commands.importPerformanceRecord).toHaveBeenCalledWith(
      '/score',
      source
    )
    expect(
      await screen.findByRole('button', { name: 'Open ' + name(imported) })
    ).toBeInTheDocument()
  }
)

it('reveals recordings for an inactive creation project without starting it', async () => {
  creationWorkspace()
  useSessionStore.setState({ sessionStatus: 'idle', sessionProjectPath: null })
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    screen.getByRole('button', { name: 'Show recordings in Finder' })
  )
  expect(commands.revealPerformanceRecordings).toHaveBeenCalledWith('/score')
  expect(commands.beginPerformanceRecording).not.toHaveBeenCalled()
  expect(notifications.flow.succeed).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('recording.feedback.reveal.success')
  )
})

it('shows a recording folder failure and leaves the reveal control available', async () => {
  vi.mocked(commands.revealPerformanceRecordings).mockResolvedValueOnce({
    status: 'error',
    error: 'recording.storageUnavailable',
  })
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    screen.getByRole('button', { name: 'Show recordings in Finder' })
  )
  expect(notifications.flow.fail).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('recording.feedback.failed'),
    i18n.t('recording.storageUnavailable')
  )
  expect(
    screen.getByRole('button', { name: 'Show recordings in Finder' })
  ).toBeEnabled()
})

it('ignores a late recording folder failure after switching projects', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.revealPerformanceRecordings>>>()
  vi.mocked(commands.revealPerformanceRecordings).mockReturnValueOnce(
    pending.promise
  )
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    screen.getByRole('button', { name: 'Show recordings in Finder' })
  )
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
  await act(async () =>
    pending.resolve({ status: 'error', error: 'recording.storageUnavailable' })
  )
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(id)
  expect(notifications.flow.fail).not.toHaveBeenCalled()
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('rejects a late changed-content response after switching projects', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.beginPerformanceRecording>>
  ) => void
  vi.mocked(commands.beginPerformanceRecording).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await userEvent.click(
    screen.getByRole('button', { name: 'Play from beginning' })
  )
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
  await act(async () =>
    finish({ status: 'error', error: 'recording.contentChanged' })
  )
  expect(
    screen.queryByRole('button', { name: 'Use the current compatible project' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  expect(await screen.findByText('No recordings yet.')).toBeInTheDocument()
})

it('rejects the previous project catalog after clearing the project', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.listPerformanceRecords>>
  ) => void
  vi.mocked(commands.listPerformanceRecords).mockImplementation(path =>
    path === '/score'
      ? Promise.resolve({ status: 'ok', data: [savedRecord()] })
      : new Promise(resolve => {
          finish = resolve
        })
  )
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  await waitFor(() =>
    expect(commands.listPerformanceRecords).toHaveBeenCalledWith('/other')
  )
  act(() => useSessionStore.setState({ sessionProjectPath: null }))
  await act(async () => finish({ status: 'ok', data: [savedRecord()] }))
  expect(
    screen.queryByRole('button', { name: 'Open ' + name() })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Import recording' })
  ).toBeDisabled()
})

it('retains newer command state when the initial restore arrives late', async () => {
  let restore!: (
    result: Awaited<ReturnType<typeof commands.getRecordingState>>
  ) => void
  vi.mocked(commands.getRecordingState).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        restore = resolve
      })
  )
  vi.mocked(commands.beginPerformanceRecording).mockResolvedValueOnce({
    status: 'ok',
    data: snapshot({
      revision: 3,
      operationId: 'new',
      recordId: 'new-record',
      status: 'recording',
      elapsedMs: 7000,
    }),
  })
  render(<PerformanceRecording />)
  act(() => publish(snapshot({ revision: 2 })))
  await openPanel()
  await userEvent.click(screen.getByRole('button', { name: 'New recording' }))
  await act(async () =>
    restore({ status: 'ok', data: snapshot({ revision: 1 }) })
  )
  expect(screen.getByTestId('recording-bar-status')).toHaveTextContent(
    'Recording · 0:07'
  )
  expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled()
})

it('keeps a late restore of the previous project’s operation out of the new project list', async () => {
  let restore!: (
    result: Awaited<ReturnType<typeof commands.getRecordingState>>
  ) => void
  vi.mocked(commands.getRecordingState).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        restore = resolve
      })
  )
  render(<PerformanceRecording />)
  await openPanel()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
  await waitFor(() =>
    expect(commands.listPerformanceRecords).toHaveBeenCalledWith('/other')
  )
  await act(async () =>
    restore({
      status: 'ok',
      data: snapshot({
        revision: 1,
        operationId: 'active',
        recordId: 'record-one',
        status: 'recording',
      }),
    })
  )
  expect(
    screen.queryByRole('button', { name: 'Current recording' })
  ).not.toBeInTheDocument()
  expect(screen.getByTestId('recording-bar-status')).toHaveTextContent(
    'Recording · 0:00'
  )
  expect(commands.stopPerformanceRecording).not.toHaveBeenCalled()
})

it('keeps a recording listed after a deletion fails', async () => {
  vi.mocked(commands.deletePerformanceRecord).mockResolvedValueOnce({
    status: 'error',
    error: 'recording.busy',
  })
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Delete recording ' + name() })
  )
  await userEvent.click(pendingRecordDeletion())
  expect(
    await screen.findByText('Another recording operation is already active.')
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Open ' + name() })
  ).toBeInTheDocument()
})

it('uses a generic operation error without adapter upgrade instructions', async () => {
  creationWorkspace()
  vi.mocked(commands.beginPerformanceRecording).mockResolvedValueOnce({
    status: 'error',
    error: 'recording.passUnsupported',
  })
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await userEvent.click(screen.getByRole('button', { name: 'Overdub' }))
  expect(
    await screen.findByText(i18n.t('recording.operationFailed'))
  ).toBeInTheDocument()
})

it('uses the native project identity when an old-project event precedes the restore response', async () => {
  let restore!: (
    result: Awaited<ReturnType<typeof commands.getRecordingState>>
  ) => void
  vi.mocked(commands.getRecordingState).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        restore = resolve
      })
  )
  render(<PerformanceRecording />)
  await openPanel()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
  await waitFor(() =>
    expect(commands.listPerformanceRecords).toHaveBeenCalledWith('/other')
  )
  act(() =>
    publish(
      snapshot({
        revision: 2,
        operationId: 'old-operation',
        recordId: 'old-record',
        projectPath: '/score',
        status: 'recording',
        elapsedMs: 2000,
      })
    )
  )
  await act(async () =>
    restore({
      status: 'ok',
      data: snapshot({
        revision: 1,
        operationId: 'old-operation',
        recordId: 'old-record',
        projectPath: '/score',
        status: 'recording',
      }),
    })
  )
  expect(
    screen.queryByRole('button', { name: 'Current recording' })
  ).not.toBeInTheDocument()
  expect(screen.getByTestId('recording-bar-status')).toHaveTextContent(
    'Recording · 0:02'
  )
  act(() => useSessionStore.setState({ sessionProjectPath: '/score' }))
  expect(
    await screen.findByRole('button', { name: 'Current recording' })
  ).toBeInTheDocument()
  expect(commands.stopPerformanceRecording).not.toHaveBeenCalled()
})

it('keeps unowned native activity visible globally without inventing a project detail', async () => {
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  vi.mocked(commands.getRecordingState).mockResolvedValue({
    status: 'ok',
    data: snapshot({
      revision: 1,
      operationId: 'unowned',
      recordId: 'unowned-record',
      projectPath: null,
      status: 'recording',
      elapsedMs: 3000,
    }),
  })
  render(<PerformanceRecording />)
  await openPanel()
  await waitFor(() =>
    expect(screen.getByTestId('recording-bar-status')).toHaveTextContent(
      'Recording · 0:03'
    )
  )
  expect(
    screen.queryByRole('button', { name: 'Current recording' })
  ).not.toBeInTheDocument()
})

it('keeps one saving notification through a delayed pass save and panel dismissal', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.stopPerformanceRecording>>>()
  vi.mocked(commands.getRecordingState).mockResolvedValueOnce({
    status: 'ok',
    data: snapshot({
      revision: 1,
      operationId: 'pass',
      recordId: 'record-one',
      status: 'overdub',
    }),
  })
  vi.mocked(commands.stopPerformanceRecording).mockReturnValueOnce(
    pending.promise
  )
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  const stop = screen.getByRole('button', { name: 'Stop and save' })
  fireEvent.click(stop)
  fireEvent.click(stop)
  expect(commands.stopPerformanceRecording).toHaveBeenCalledTimes(1)
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  expect(notifications.flow.step).toHaveBeenLastCalledWith(
    id,
    i18n.t('recording.feedback.save.pending')
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  await act(async () =>
    pending.resolve({ status: 'ok', data: snapshot({ revision: 2 }) })
  )
  expect(notifications.flow.succeed).toHaveBeenCalledWith(
    id,
    i18n.t('recording.feedback.save.success')
  )
})

it('ends a rejected save notification and permits a retry without claiming success', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.stopPerformanceRecording>>>()
  vi.mocked(commands.getRecordingState).mockResolvedValueOnce({
    status: 'ok',
    data: snapshot({
      revision: 1,
      operationId: 'pass',
      recordId: 'record-one',
      status: 'recording',
    }),
  })
  vi.mocked(commands.stopPerformanceRecording).mockReturnValueOnce(
    pending.promise
  )
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  const stop = screen.getByRole('button', { name: 'Stop and save' })
  await userEvent.click(stop)
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  await act(async () => pending.reject(new Error('Disk unavailable')))
  expect(notifications.flow.fail).toHaveBeenCalledWith(
    id,
    i18n.t('recording.feedback.failed'),
    'Disk unavailable'
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(stop).toBeEnabled()
})

it('reports discarded pass changes separately from a saved pass', async () => {
  creationWorkspace()
  vi.mocked(commands.getRecordingState).mockResolvedValueOnce({
    status: 'ok',
    data: snapshot({
      revision: 1,
      operationId: 'pass',
      recordId: 'record-one',
      status: 'overdub',
    }),
  })
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await userEvent.click(
    screen.getByRole('button', { name: 'Discard this pass' })
  )
  expect(commands.stopPerformanceRecording).toHaveBeenCalledWith(true)
  expect(notifications.flow.succeed).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('recording.feedback.discard.success')
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('recording.feedback.save.success')
  )
})

it('does not report a native error snapshot as a successful pass save', async () => {
  vi.mocked(commands.getRecordingState).mockResolvedValueOnce({
    status: 'ok',
    data: snapshot({
      revision: 1,
      operationId: 'pass',
      recordId: 'record-one',
      status: 'recording',
    }),
  })
  vi.mocked(commands.stopPerformanceRecording).mockResolvedValueOnce({
    status: 'ok',
    data: snapshot({
      revision: 2,
      status: 'error',
      error: 'recording.storage',
    }),
  })
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await userEvent.click(screen.getByRole('button', { name: 'Stop and save' }))
  expect(notifications.flow.fail).toHaveBeenCalled()
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('dismisses cancelled recording pickers without claiming an import or export', async () => {
  vi.mocked(open).mockResolvedValueOnce(null)
  vi.mocked(save).mockResolvedValueOnce(null)
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    screen.getByRole('button', { name: 'Import recording' })
  )
  const importId = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(importId)
  await openRecord()
  await userEvent.click(screen.getByRole('button', { name: 'Export' }))
  const exportId = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(exportId)
  expect(commands.importPerformanceRecord).not.toHaveBeenCalled()
  expect(commands.exportPerformanceRecord).not.toHaveBeenCalled()
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('dismisses feedback immediately on project ownership loss and ignores a late result', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.beginPerformanceRecording>>>()
  vi.mocked(commands.beginPerformanceRecording).mockReturnValueOnce(
    pending.promise
  )
  const view = render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(screen.getByRole('button', { name: 'New recording' }))
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(id)
  act(() => useSessionStore.setState({ sessionProjectPath: '/score' }))
  await act(async () =>
    pending.resolve({
      status: 'ok',
      data: snapshot({ revision: 3, operationId: 'old', status: 'recording' }),
    })
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  view.unmount()
})

it('ends a recording picker rejection as an error rather than leaving feedback pending', async () => {
  vi.mocked(open).mockRejectedValueOnce(new Error('Picker unavailable'))
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    screen.getByRole('button', { name: 'Import recording' })
  )
  expect(notifications.flow.fail).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('recording.feedback.failed'),
    'Picker unavailable'
  )
  expect(screen.getByRole('button', { name: 'Import recording' })).toBeEnabled()
})

it('hides its entry and closes the panel without cancelling a native recording request or its feedback', async () => {
  const operation =
    deferred<Awaited<ReturnType<typeof commands.beginPerformanceRecording>>>()
  vi.mocked(commands.beginPerformanceRecording).mockReturnValueOnce(
    operation.promise
  )
  const onOpenChange = vi.fn()
  const view = render(<PerformanceRecording onOpenChange={onOpenChange} />)
  await openPanel()
  await userEvent.click(screen.getByRole('button', { name: 'New recording' }))
  await waitFor(() =>
    expect(commands.beginPerformanceRecording).toHaveBeenCalledOnce()
  )
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]

  view.rerender(
    <PerformanceRecording visible={false} onOpenChange={onOpenChange} />
  )
  expect(
    screen.queryByRole('button', { name: 'Performance recordings' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(onOpenChange).toHaveBeenLastCalledWith(false)
  expect(commands.stopPerformanceRecording).not.toHaveBeenCalled()
  expect(notifications.flow.dismiss).not.toHaveBeenCalledWith(id)
  await act(async () =>
    operation.resolve({
      status: 'ok',
      data: snapshot({
        revision: 1,
        operationId: 'recording-operation',
        recordId: 'record-one',
        status: 'recording',
      }),
    })
  )
  expect(notifications.flow.succeed).toHaveBeenCalledWith(
    id,
    expect.any(String)
  )

  view.rerender(<PerformanceRecording visible onOpenChange={onOpenChange} />)
  expect(
    screen.getByRole('button', { name: 'Performance recordings' })
  ).toBeVisible()
  expect(screen.getByTestId('recording-bar-status')).toHaveTextContent('0:00')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(commands.getRecordingState).toHaveBeenCalledOnce()
  expect(commands.stopPerformanceRecording).not.toHaveBeenCalled()
})

it('continues receiving native recording snapshots while its entry is hidden', async () => {
  const view = render(<PerformanceRecording visible={false} />)
  await waitFor(() => expect(commands.getRecordingState).toHaveBeenCalledOnce())
  act(() =>
    publish(
      snapshot({
        revision: 4,
        operationId: 'playback-operation',
        recordId: 'record-one',
        status: 'playback',
        elapsedMs: 2400,
      })
    )
  )
  expect(
    screen.queryByRole('button', { name: 'Performance recordings' })
  ).not.toBeInTheDocument()
  view.rerender(<PerformanceRecording visible />)
  expect(screen.getByTestId('recording-bar-status')).toHaveTextContent('0:02')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(commands.getRecordingState).toHaveBeenCalledOnce()
  expect(commands.stopPerformanceRecording).not.toHaveBeenCalled()
})

it('keeps the list to timestamp rows and puts icon import beside the Finder folder on the right', async () => {
  render(<PerformanceRecording />)
  await openPanel()
  const list = screen.getByRole('list', { name: 'Recordings' })
  const row = within(list).getByRole('listitem')
  expect(row).toHaveTextContent(name())
  expect(row).not.toHaveTextContent('0:10')
  expect(within(row).getAllByRole('button')).toHaveLength(2)
  expect(
    within(row).getByRole('button', { name: 'Delete recording ' + name() })
  ).toHaveTextContent('')
  expect(
    screen.queryByRole('button', { name: 'Export' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(i18n.t('recording.informationOnly'))
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(i18n.t('recording.notRunning'))
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(i18n.t('recording.unsupported'))
  ).not.toBeInTheDocument()
  const folder = screen.getByRole('button', {
    name: 'Show recordings in Finder',
  })
  const importer = screen.getByRole('button', { name: 'Import recording' })
  expect(folder.querySelector('svg')).toHaveClass('lucide-folder')
  expect(importer).toHaveTextContent('')
  expect(importer).toHaveAttribute('title', 'Import recording')
  expect(
    folder.compareDocumentPosition(importer) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})

it('shows duration and export in the detail while keeping pass management collapsed by default', async () => {
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  expect(screen.getByText(/Duration/)).toHaveTextContent('0:10')
  expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  expect(
    screen.getByRole('button', { name: 'Recording passes: 2' })
  ).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.queryByRole('list', { name: 'Recording passes' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Recording details')).not.toBeInTheDocument()
  await expandPasses()
  expect(
    screen.getByRole('button', { name: 'Recording passes: 2' })
  ).toHaveAttribute('aria-expanded', 'true')
  expect(
    within(screen.getByRole('list', { name: 'Recording passes' })).getAllByRole(
      'listitem'
    )
  ).toHaveLength(2)
})

it.each(['outside', 'blur', 'close', 'focus'] as const)(
  'cancels an armed record deletion on %s without deleting or replacing its row',
  async action => {
    render(<PerformanceRecording />)
    await openPanel()
    const button = await screen.findByRole('button', {
      name: 'Delete recording ' + name(),
    })
    const row = button.closest('li')
    if (!row) throw new Error('Recording deletion must belong to a record row')
    await userEvent.click(button)
    expect(pendingRecordDeletion().closest('li')).toBe(row)
    if (action === 'outside')
      fireEvent.pointerDown(
        screen.getByRole('heading', { name: 'Performance recordings' })
      )
    else if (action === 'blur') fireEvent(window, new Event('blur'))
    else if (action === 'focus')
      fireEvent.blur(pendingRecordDeletion(), {
        relatedTarget: screen.getByRole('button', { name: 'Import recording' }),
      })
    else {
      await userEvent.click(
        screen.getByRole('button', { name: 'Close recordings' })
      )
      await openPanel()
    }
    expect(
      screen.queryByRole('button', { name: 'Click again to delete ' + name() })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open ' + name() })
    ).toBeInTheDocument()
    expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
  }
)

it('does not carry an armed deletion across project changes, including returning to the same path', async () => {
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Delete recording ' + name() })
  )
  act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
  await waitFor(() =>
    expect(commands.listPerformanceRecords).toHaveBeenCalledWith('/other')
  )
  act(() => useSessionStore.setState({ sessionProjectPath: '/score' }))
  expect(
    await screen.findByRole('button', { name: 'Open ' + name() })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Click again to delete ' + name() })
  ).not.toBeInTheDocument()
  expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
})

it('clears armed deletion when native activity starts and keeps the active record protected', async () => {
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Delete recording ' + name() })
  )
  act(() =>
    publish(
      snapshot({
        revision: 1,
        operationId: 'playing',
        recordId: 'record-one',
        status: 'playback',
      })
    )
  )
  expect(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  ).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Click again to delete ' + name() })
  ).not.toBeInTheDocument()
  expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
})

it('imports multiple picker files through native validation and leaves the catalog open', async () => {
  const first = savedRecord({ id: 'import-first', createdAt: '1000' })
  const second = savedRecord({ id: 'import-second', createdAt: '2000' })
  vi.mocked(open).mockResolvedValueOnce(['/first.pndsrecord', '/second.json'])
  vi.mocked(commands.importPerformanceRecord)
    .mockResolvedValueOnce({ status: 'ok', data: first })
    .mockResolvedValueOnce({ status: 'ok', data: second })
  render(<PerformanceRecording />)
  await openPanel()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [savedRecord(), first, second],
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Import recording' })
  )
  expect(commands.importPerformanceRecord).toHaveBeenNthCalledWith(
    1,
    '/score',
    '/first.pndsrecord'
  )
  expect(commands.importPerformanceRecord).toHaveBeenNthCalledWith(
    2,
    '/score',
    '/second.json'
  )
  expect(
    await screen.findByRole('button', { name: 'Open ' + name(second) })
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
})

it('validates every picker extension before importing any selected file', async () => {
  vi.mocked(open).mockResolvedValueOnce([
    '/first.pndsrecord',
    '/not-a-record.pnds',
  ])
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    screen.getByRole('button', { name: 'Import recording' })
  )
  expect(commands.importPerformanceRecord).not.toHaveBeenCalled()
  expect(notifications.flow.fail).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Import recording' })).toBeEnabled()
})

it('refreshes already imported records after a later file in the batch fails validation', async () => {
  const imported = savedRecord({ id: 'imported', createdAt: '1000' })
  vi.mocked(open).mockResolvedValueOnce(['/first.pndsrecord', '/broken.json'])
  vi.mocked(commands.importPerformanceRecord)
    .mockResolvedValueOnce({ status: 'ok', data: imported })
    .mockResolvedValueOnce({ status: 'error', error: 'recording.invalidFile' })
  render(<PerformanceRecording />)
  await openPanel()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [savedRecord(), imported],
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Import recording' })
  )
  expect(
    await screen.findByRole('button', { name: 'Open ' + name(imported) })
  ).toBeInTheDocument()
  expect(notifications.flow.fail).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('recording.feedback.failed'),
    i18n.t('recording.invalidFile')
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('ignores a late import result after switching project ownership and does not import later batch files there', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.importPerformanceRecord>>>()
  vi.mocked(open).mockResolvedValueOnce(['/first.pndsrecord', '/second.json'])
  vi.mocked(commands.importPerformanceRecord).mockReturnValueOnce(
    pending.promise
  )
  render(<PerformanceRecording />)
  await openPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Import recording' }))
  await waitFor(() =>
    expect(commands.importPerformanceRecord).toHaveBeenCalledWith(
      '/score',
      '/first.pndsrecord'
    )
  )
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
  await act(async () =>
    pending.resolve({ status: 'ok', data: savedRecord({ id: 'late-import' }) })
  )
  expect(commands.importPerformanceRecord).toHaveBeenCalledTimes(1)
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(id)
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  expect(await screen.findByText('No recordings yet.')).toBeInTheDocument()
})

it('routes an accepted native drop through the same import command without opening a picker', async () => {
  const imported = savedRecord({ id: 'dropped', createdAt: '1000' })
  vi.mocked(commands.importPerformanceRecord).mockResolvedValueOnce({
    status: 'ok',
    data: imported,
  })
  render(<PerformanceRecording />)
  await openPanel()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [savedRecord(), imported],
  })
  const drop = vi.mocked(useRecordingFileDrop).mock.calls.at(-1)?.[0]
  expect(drop?.enabled).toBe(true)
  expect(drop?.projectPath).toBe('/score')
  await act(async () => drop?.onDrop(['/dropped.pndsrecord']))
  expect(open).not.toHaveBeenCalled()
  expect(commands.importPerformanceRecord).toHaveBeenCalledWith(
    '/score',
    '/dropped.pndsrecord'
  )
  expect(
    await screen.findByRole('button', { name: 'Open ' + name(imported) })
  ).toBeInTheDocument()
})

it('enables native drop only for an open panel with a selected idle project', async () => {
  render(<PerformanceRecording />)
  await waitFor(() => expect(commands.getRecordingState).toHaveBeenCalledOnce())
  expect(vi.mocked(useRecordingFileDrop).mock.calls.at(-1)?.[0].enabled).toBe(
    false
  )
  await openPanel()
  expect(vi.mocked(useRecordingFileDrop).mock.calls.at(-1)?.[0].enabled).toBe(
    true
  )
  act(() =>
    publish(
      snapshot({
        revision: 1,
        operationId: 'record',
        recordId: 'record-one',
        status: 'recording',
      })
    )
  )
  expect(vi.mocked(useRecordingFileDrop).mock.calls.at(-1)?.[0].enabled).toBe(
    false
  )
})

it('does not import a picker result that arrives after its project was changed', async () => {
  const picker = deferred<Awaited<ReturnType<typeof open>>>()
  vi.mocked(open).mockReturnValueOnce(picker.promise)
  render(<PerformanceRecording />)
  await openPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Import recording' }))
  await waitFor(() => expect(open).toHaveBeenCalledOnce())
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
  await act(async () => picker.resolve('/late.pndsrecord'))
  expect(commands.importPerformanceRecord).not.toHaveBeenCalled()
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(id)
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('invalidates an importing batch when the native creation identity changes at the same project path', async () => {
  creationWorkspace()
  const pending =
    deferred<Awaited<ReturnType<typeof commands.importPerformanceRecord>>>()
  vi.mocked(open).mockResolvedValueOnce(['/first.pndsrecord', '/second.json'])
  vi.mocked(commands.importPerformanceRecord).mockReturnValueOnce(
    pending.promise
  )
  render(<PerformanceRecording />)
  await openPanel()
  fireEvent.click(screen.getByRole('button', { name: 'Import recording' }))
  await waitFor(() =>
    expect(commands.importPerformanceRecord).toHaveBeenCalledOnce()
  )
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  act(() =>
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'replacement-workspace',
          root: '/score',
          name: 'Other identity',
          source: 'folder',
        },
        files: [],
      },
    })
  )
  await act(async () =>
    pending.resolve({
      status: 'ok',
      data: savedRecord({ id: 'retired-import' }),
    })
  )
  expect(commands.importPerformanceRecord).toHaveBeenCalledTimes(1)
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(id)
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('ignores a late catalog response from a previous workspace identity at the same path', async () => {
  creationWorkspace()
  const previous =
    deferred<Awaited<ReturnType<typeof commands.listPerformanceRecords>>>()
  const replacement = savedRecord({
    id: 'replacement-record',
    createdAt: '3000',
  })
  vi.mocked(commands.listPerformanceRecords)
    .mockReturnValueOnce(previous.promise)
    .mockResolvedValueOnce({ status: 'ok', data: [replacement] })
  render(<PerformanceRecording />)
  await openPanel()
  await waitFor(() =>
    expect(commands.listPerformanceRecords).toHaveBeenCalledOnce()
  )
  act(() => creationWorkspace('replacement-workspace'))
  expect(
    await screen.findByRole('button', { name: 'Open ' + name(replacement) })
  ).toBeInTheDocument()
  expect(commands.listPerformanceRecords).toHaveBeenNthCalledWith(2, '/score')
  await act(async () =>
    previous.resolve({ status: 'ok', data: [savedRecord()] })
  )
  expect(
    screen.getByRole('button', { name: 'Open ' + name(replacement) })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Open ' + name() })
  ).not.toBeInTheDocument()
})

it('returns to the list on a same-path workspace replacement and never revives the old record detail', async () => {
  creationWorkspace()
  const next =
    deferred<Awaited<ReturnType<typeof commands.listPerformanceRecords>>>()
  const replacement = savedRecord({
    id: 'replacement-record',
    createdAt: '3000',
  })
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  vi.mocked(commands.listPerformanceRecords).mockReturnValueOnce(next.promise)
  act(() => creationWorkspace('replacement-workspace'))
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Open ' + name() })
  ).not.toBeInTheDocument()
  await act(async () => next.resolve({ status: 'ok', data: [replacement] }))
  expect(
    screen.getByRole('button', { name: 'Open ' + name(replacement) })
  ).toBeInTheDocument()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [savedRecord()],
  })
  act(() => creationWorkspace())
  expect(
    await screen.findByRole('button', { name: 'Open ' + name() })
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
})

it('formats recording dates with the App language when the language changes in place', async () => {
  const recording = savedRecord({
    createdAt: String(new Date(2026, 10, 15, 20, 42, 18).getTime()),
  })
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [recording],
  })
  await act(async () => {
    await i18n.changeLanguage('en')
  })
  render(<PerformanceRecording />)
  await openPanel()
  expect(await screen.findByText('11/15/2026, 8:42:18 PM')).toBeInTheDocument()
  try {
    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })
    expect(screen.getByText('2026/11/15 20:42:18')).toBeInTheDocument()
    expect(screen.queryByText('11/15/2026, 8:42:18 PM')).not.toBeInTheDocument()
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(screen.getByText('11/15/2026, 8:42:18 PM')).toBeInTheDocument()
    expect(screen.queryByText('2026/11/15 20:42:18')).not.toBeInTheDocument()
  } finally {
    await act(async () => {
      await i18n.changeLanguage('en')
    })
  }
})

it('deletes an entire recording from its detail after a second click and restores focus to the list', async () => {
  const deletion =
    deferred<Awaited<ReturnType<typeof commands.deletePerformanceRecord>>>()
  vi.mocked(commands.deletePerformanceRecord).mockReturnValueOnce(
    deletion.promise
  )
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  const deleteButton = screen.getByRole('button', {
    name: 'Delete recording ' + name(),
  })
  await userEvent.click(deleteButton)
  expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
  expect(pendingRecordDeletion()).toBe(deleteButton)
  expect(deleteButton).toHaveTextContent('Click again to delete')
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  fireEvent.click(pendingRecordDeletion())
  expect(commands.deletePerformanceRecord).toHaveBeenCalledWith(
    '/score',
    'record-one'
  )
  expect(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  ).toBeDisabled()
  await act(async () => deletion.resolve({ status: 'ok', data: null }))
  expect(await screen.findByText('No recordings yet.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  await waitFor(() =>
    expect(
      screen
        .getByRole('list', { name: 'Recordings' })
        .closest('.recording-list-scroll')
    ).toHaveFocus()
  )
})

it.each(['Escape', 'outside', 'blur'] as const)(
  'cancels detail deletion on %s while keeping the selected record open',
  async action => {
    render(<PerformanceRecording />)
    await openPanel()
    await openRecord()
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Delete recording ' + name(),
      })
    )
    expect(pendingRecordDeletion()).toHaveTextContent('Click again to delete')
    if (action === 'Escape') await userEvent.keyboard('{Escape}')
    else if (action === 'outside')
      fireEvent.pointerDown(
        screen.getByRole('heading', { name: 'Performance recordings' })
      )
    else fireEvent(window, new Event('blur'))
    expect(
      screen.queryByRole('button', { name: 'Click again to delete ' + name() })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete recording ' + name() })
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: name() })).toBeInTheDocument()
    expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
  }
)

it.each(['recording', 'playback', 'overdub', 'rerecord'] as const)(
  'disables entire-record deletion from the detail during native %s and cancels its confirmation',
  async status => {
    render(<PerformanceRecording />)
    await openPanel()
    await openRecord()
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete recording ' + name() })
    )
    act(() =>
      publish(
        snapshot({
          revision: 1,
          operationId: 'native-operation',
          recordId: 'record-one',
          status,
        })
      )
    )
    expect(
      screen.queryByRole('button', { name: 'Click again to delete ' + name() })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete recording ' + name() })
    ).toBeDisabled()
    expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  }
)

it('keeps the detail available for retry after deleting an entire recording fails', async () => {
  vi.mocked(commands.deletePerformanceRecord).mockResolvedValueOnce({
    status: 'error',
    error: 'recording.storageUnavailable',
  })
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  )
  await userEvent.click(pendingRecordDeletion())
  expect(await screen.findByRole('alert')).toHaveTextContent(
    i18n.t('recording.storageUnavailable')
  )
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: name() })).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  ).toBeEnabled()
  vi.mocked(commands.deletePerformanceRecord).mockResolvedValueOnce({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  )
  await userEvent.click(pendingRecordDeletion())
  expect(commands.deletePerformanceRecord).toHaveBeenCalledTimes(2)
  expect(await screen.findByText('No recordings yet.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
})

it('preserves another record detail and its focus when a delayed detail deletion finishes', async () => {
  const another = savedRecord({ id: 'record-two', createdAt: '1000' })
  const deletion =
    deferred<Awaited<ReturnType<typeof commands.deletePerformanceRecord>>>()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [savedRecord(), another],
  })
  vi.mocked(commands.deletePerformanceRecord).mockReturnValueOnce(
    deletion.promise
  )
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  )
  fireEvent.click(pendingRecordDeletion())
  expect(commands.deletePerformanceRecord).toHaveBeenCalledWith(
    '/score',
    'record-one'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  await openRecord(another)
  const back = screen.getByRole('button', { name: 'Back' })
  act(() => back.focus())
  expect(back).toHaveFocus()
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [another],
  })
  await act(async () => deletion.resolve({ status: 'ok', data: null }))
  await waitFor(() =>
    expect(commands.listPerformanceRecords).toHaveBeenCalledTimes(2)
  )
  expect(
    screen.getByRole('heading', { name: name(another) })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus()
  expect(commands.deletePerformanceRecord).toHaveBeenCalledTimes(1)
})
