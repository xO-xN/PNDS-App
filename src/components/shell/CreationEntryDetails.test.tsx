import { beforeEach, expect, it, vi } from 'vitest'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { CreationEntryDetails } from './CreationEntryDetails'

let live: SessionSnapshot
beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(commands.getCreationPerformerQr).mockReset().mockResolvedValue({
    status: 'ok',
    data: 'data:image/png;base64,dGVzdA==',
  })
  const base = await commands.getSessionState()
  if (base.status === 'error') throw new Error(base.error)
  live = {
    ...base.data,
    runtimeGeneration: '41',
    status: 'ready',
    projectPath: '/test',
    lanIp: '192.168.8.20',
    hostAddress: 'test.local',
    appliedPorts: { performerPort: 52341, monitorPort: 52342 },
    health: {
      status: 'ready',
      scoreServer: { performerPort: 6868, monitorPort: 6869 },
    },
  }
  useCreationStore.setState({
    active: true,
    runtimeProject: null,
    opening: false,
    modePhase: 'idle',
    workspace: {
      project: {
        identity: 'entry-test',
        root: '/test',
        name: 'Test',
        source: 'folder',
      },
      files: [],
    },
  })
  useSessionStore.getState().resetSession()
  useSessionStore.getState().applySnapshot(live)
  useSessionStore.setState({ commandPending: false })
})

it('copies and encodes the actual applied test address without publishing or displaying an overlay', async () => {
  render(<CreationEntryDetails />)
  expect(screen.getByText('test.local:52341')).toBeVisible()
  expect(await screen.findByRole('img')).toHaveAttribute(
    'src',
    'data:image/png;base64,dGVzdA=='
  )
  fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith('http://test.local:52341/')
  )
  expect(commands.getCreationPerformerQr).toHaveBeenCalledWith(
    'http://test.local:52341/',
    '41'
  )
  expect(commands.getHostEntryQr).not.toHaveBeenCalled()
  expect(commands.togglePerformerQr).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})

it('preserves the full trusted HTTPS address and removes the invitation when that entry fails', async () => {
  const url = 'https://test.example:8443/join?room=one&piece=two'
  useSessionStore.getState().applySnapshot({
    ...live,
    httpsEntry: { status: 'ready', url, error: null },
  })
  render(<CreationEntryDetails />)
  await screen.findByRole('img')
  expect(commands.getCreationPerformerQr).toHaveBeenCalledWith(url, '41')
  fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(url))
  act(() =>
    useSessionStore.getState().applySnapshot({
      ...live,
      httpsEntry: { status: 'error', url, error: 'gateway failed' },
    })
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Copy address' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Test performer entry unavailable'
  )
  expect(commands.getCreationPerformerQr).toHaveBeenCalledTimes(1)
})

it('never invites into another project and accepts the canonical path adopted by this workspace', async () => {
  useSessionStore
    .getState()
    .applySnapshot({ ...live, projectPath: '/actual-test' })
  render(<CreationEntryDetails />)
  expect(screen.getByRole('status')).toHaveTextContent('No test running')
  expect(commands.getCreationPerformerQr).not.toHaveBeenCalled()
  act(() =>
    useCreationStore.setState({
      runtimeProject: { root: '/test', path: '/actual-test' },
    })
  )
  expect(await screen.findByRole('img')).toBeVisible()
  act(() => useCreationStore.setState({ workspace: null }))
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

it('retries encoding and ignores an older run even when its performer URL is reused', async () => {
  let finish!: (result: { status: 'ok'; data: string }) => void
  vi.mocked(commands.getCreationPerformerQr)
    .mockResolvedValueOnce({ status: 'error', error: 'encoder failed' })
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
  render(<CreationEntryDetails />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not generate entry QR'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Retry entry QR' }))
  await waitFor(() =>
    expect(commands.getCreationPerformerQr).toHaveBeenCalledTimes(2)
  )
  act(() =>
    useSessionStore
      .getState()
      .applySnapshot({ ...live, status: 'starting', runtimeGeneration: '42' })
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  act(() =>
    useSessionStore
      .getState()
      .applySnapshot({ ...live, runtimeGeneration: '42' })
  )
  expect(await screen.findByRole('img')).toHaveAttribute(
    'src',
    'data:image/png;base64,dGVzdA=='
  )
  await act(async () =>
    finish({ status: 'ok', data: 'data:image/png;base64,b2xk' })
  )
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    'data:image/png;base64,dGVzdA=='
  )
  expect(commands.getCreationPerformerQr).toHaveBeenLastCalledWith(
    'http://test.local:52341/',
    '42'
  )
})
