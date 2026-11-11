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
  return new Date(Number(record.createdAt)).toLocaleString() + ' · 0:10'
}
function creationWorkspace() {
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'native-workspace',
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
let publish: (value: RecordingSnapshot) => void

beforeEach(() => {
  vi.clearAllMocks()
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
  expect(
    screen.getByRole('button', { name: 'Back to recordings' })
  ).toBeInTheDocument()
  expect(
    within(screen.getByRole('list', { name: 'Recording passes' })).getAllByRole(
      'listitem'
    )
  ).toHaveLength(2)
  expect(
    screen.queryByText(/Performer 1|Score selection|Phone|Tablet/)
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Rerecord Pass 1' }))
  expect(commands.beginPerformanceRecording).toHaveBeenCalledWith(
    'rerecord',
    'record-one',
    'pass-one',
    false,
    'native-workspace'
  )
})

it('requires a second explicit action to delete a recording and refreshes the list', async () => {
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Delete recording ' + name() })
  )
  expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  )
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [],
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete recording' })
  )
  expect(commands.deletePerformanceRecord).toHaveBeenCalledWith(
    '/score',
    'record-one'
  )
  expect(await screen.findByText('No recordings yet.')).toBeInTheDocument()
})

it('deletes one pass without deleting the recording and keeps its detail open', async () => {
  creationWorkspace()
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await userEvent.click(screen.getByRole('button', { name: 'Delete Pass 1' }))
  expect(commands.deleteRecordingPass).not.toHaveBeenCalled()
  vi.mocked(commands.deleteRecordingPass).mockResolvedValue({
    status: 'ok',
    data: savedRecord({ passes: [] }),
  })
  vi.mocked(commands.listPerformanceRecords).mockResolvedValue({
    status: 'ok',
    data: [savedRecord({ passes: [] })],
  })
  await userEvent.click(screen.getByRole('button', { name: 'Delete pass' }))
  expect(commands.deleteRecordingPass).toHaveBeenCalledWith(
    '/score',
    'record-one',
    'pass-one'
  )
  expect(commands.deletePerformanceRecord).not.toHaveBeenCalled()
  expect(
    await screen.findByText(
      'No passes. The original score, conducting and duration are retained.'
    )
  ).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: name() })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add a pass' })).toBeEnabled()
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
  await openPanel()
  await openRecord()
  await userEvent.click(screen.getByRole('button', { name: 'Add a pass' }))
  expect(screen.getByRole('button', { name: 'Delete Pass 1' })).toBeDisabled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Back to recordings' })
  )
  expect(
    screen.getByRole('button', { name: 'Delete recording ' + name() })
  ).toBeDisabled()
  expect(screen.getByTestId('recording-bar-status')).toHaveTextContent(
    'Overdubbing · 0:05'
  )
  await openRecord()
  expect(
    screen.getByRole('button', { name: 'Stop and save this pass' })
  ).toBeEnabled()
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
    false,
    null
  )
  expect(
    screen.getByRole('heading', { name: 'Current recording' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Stop and save this pass' })
  ).toBeEnabled()
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
  await userEvent.click(screen.getByRole('button', { name: 'Add a pass' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Stop and save this pass' })
  )
  expect(commands.stopPerformanceRecording).toHaveBeenCalledWith(false)
  expect(screen.getByRole('heading', { name: name() })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add a pass' })).toBeEnabled()
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
  expect(screen.getByText('Existing content')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Add a pass' })
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
    false,
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
  'keeps changed-content confirmation before %s changes a saved recording',
  async mode => {
    creationWorkspace()
    vi.mocked(commands.beginPerformanceRecording)
      .mockResolvedValueOnce({
        status: 'error',
        error: 'recording.contentChanged',
      })
      .mockResolvedValueOnce({
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
    await userEvent.click(
      screen.getByRole('button', {
        name: mode === 'overdub' ? 'Add a pass' : 'Rerecord Pass 1',
      })
    )
    const passId = mode === 'rerecord' ? 'pass-one' : null
    expect(commands.beginPerformanceRecording).toHaveBeenCalledTimes(1)
    expect(commands.beginPerformanceRecording).toHaveBeenCalledWith(
      mode,
      'record-one',
      passId,
      false,
      'native-workspace'
    )
    expect(
      await screen.findByText(i18n.t('recording.contentChanged'))
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Use the current compatible project' })
    )
    expect(commands.beginPerformanceRecording).toHaveBeenCalledTimes(2)
    expect(commands.beginPerformanceRecording).toHaveBeenLastCalledWith(
      mode,
      'record-one',
      passId,
      true,
      'native-workspace'
    )
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
    const message = i18n.t(
      error === 'recording.contentChanged' ? 'recording.feedback.failed' : error
    )
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

it('exports from the list without requiring a running project or a separate save', async () => {
  creationWorkspace()
  useSessionStore.setState({ sessionStatus: 'idle', sessionProjectPath: null })
  vi.mocked(save).mockResolvedValueOnce('/export.pndsrecord')
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Export ' + name() })
  )
  expect(commands.exportPerformanceRecord).toHaveBeenCalledWith(
    '/score',
    'record-one',
    '/export.pndsrecord'
  )
  await openRecord()
  expect(
    screen.getByRole('button', { name: 'Play from beginning' })
  ).toBeDisabled()
})

it.each(['pndsrecord', 'json'])(
  'opens an imported .%s recording detail after refreshing the catalog',
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
      screen.getByRole('button', { name: 'Open recording' })
    )
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [
        { name: i18n.t('recording.file'), extensions: ['pndsrecord', 'json'] },
      ],
    })
    expect(commands.importPerformanceRecord).toHaveBeenCalledWith(
      '/score',
      source
    )
    expect(
      await screen.findByRole('heading', { name: name(imported) })
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
  expect(
    screen.queryByRole('button', { name: 'Back to recordings' })
  ).not.toBeInTheDocument()
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
  expect(
    screen.queryByRole('button', { name: 'Back to recordings' })
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(commands.listPerformanceRecords).toHaveBeenCalledWith('/other')
  )
  act(() => useSessionStore.setState({ sessionProjectPath: null }))
  await act(async () => finish({ status: 'ok', data: [savedRecord()] }))
  expect(
    screen.queryByRole('button', { name: 'Open ' + name() })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open recording' })).toBeDisabled()
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
  expect(
    screen.getByRole('button', { name: 'Stop and save this pass' })
  ).toBeEnabled()
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
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete recording' })
  )
  expect(
    await screen.findByText('Another recording operation is already active.')
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Open ' + name() })
  ).toBeInTheDocument()
})

it('explains that the project adapter needs upgrading for pass recording', async () => {
  creationWorkspace()
  vi.mocked(commands.beginPerformanceRecording).mockResolvedValueOnce({
    status: 'error',
    error: 'recording.passUnsupported',
  })
  render(<PerformanceRecording />)
  await openPanel()
  await openRecord()
  await userEvent.click(screen.getByRole('button', { name: 'Add a pass' }))
  expect(
    await screen.findByText(
      'Update this project’s recording adapter to support multi-performer passes. Existing recordings can still be played.'
    )
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
  const stop = screen.getByRole('button', { name: 'Stop and save this pass' })
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
  const stop = screen.getByRole('button', { name: 'Stop and save this pass' })
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
  await userEvent.click(
    screen.getByRole('button', { name: 'Stop and save this pass' })
  )
  expect(notifications.flow.fail).toHaveBeenCalled()
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('dismisses cancelled recording pickers without claiming an import or export', async () => {
  vi.mocked(open).mockResolvedValueOnce(null)
  vi.mocked(save).mockResolvedValueOnce(null)
  render(<PerformanceRecording />)
  await openPanel()
  await userEvent.click(screen.getByRole('button', { name: 'Open recording' }))
  const importId = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(importId)
  await userEvent.click(
    screen.getByRole('button', { name: 'Export ' + name() })
  )
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
  await userEvent.click(screen.getByRole('button', { name: 'Open recording' }))
  expect(notifications.flow.fail).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('recording.feedback.failed'),
    'Picker unavailable'
  )
  expect(screen.getByRole('button', { name: 'Open recording' })).toBeEnabled()
})
