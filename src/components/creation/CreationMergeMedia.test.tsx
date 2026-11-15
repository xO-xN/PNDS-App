import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import type { GitMergeCandidate, GitMergeContent } from '@/lib/tauri-bindings'

const calls = vi.hoisted(() => ({
  read: vi.fn(),
  choose: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  control: vi.fn(),
  disconnected: vi.fn(),
  session: {
    sessionStatus: 'idle',
    latestSnapshot: null,
    outputDevice: 'Selected output',
  },
}))
vi.mock('@/lib/tauri-bindings', () => ({
  commands: {
    startMergeAudioPreview: calls.start,
    stopPendingAudioPreview: calls.stop,
    controlPendingAudioPreview: calls.control,
  },
}))
vi.mock('@/lib/events', () => ({
  onCreationAudioPreviewDisconnected: calls.disconnected,
}))
vi.mock('@/store/creation-merge-store', async () => {
  const { create } = await import('zustand')
  return {
    useCreationMergeStore: create(() => ({
      identity: 'physical',
      candidate: null,
      contents: {},
      read: calls.read,
      choose: calls.choose,
    })),
  }
})
vi.mock('@/store/creation-store', () => ({
  useCreationStore: (
    selector: (state: {
      workspace: { project: { root: string } }
      runtimeProject: null
    }) => unknown
  ) =>
    selector({
      workspace: { project: { root: '/score' } },
      runtimeProject: null,
    }),
}))
vi.mock('@/store/session-store', () => ({
  useSessionStore: (selector: (state: typeof calls.session) => unknown) =>
    selector(calls.session),
}))

import { useCreationMergeStore } from '@/store/creation-merge-store'
import { CreationMergeMedia } from './CreationMergeMedia'

const candidate: GitMergeCandidate = {
  id: 'merge-1',
  revision: 4,
  relation: 'diverged',
  phase: 'active',
  source: 'incoming-commit',
  target: 'current-commit',
  base: 'base-commit',
  branch: 'main',
  name: 'Merge rhythm',
  files: [],
  unresolved: 1,
  result: null,
  detail: null,
  assistantOwner: null,
  canUndo: false,
}
const audio = (side: 'current' | 'incoming'): GitMergeContent => ({
  path: 'water.wav',
  side,
  exists: true,
  version: `${side}-v1`,
  text: null,
  url: 'data:audio/wav;base64,NEVER_EXPOSE_AUDIO_BYTES',
  size: 48_000,
  mime: 'audio/wav',
  durationMs: 2400,
  sampleRate: 22050,
  channels: 1,
  waveform: [0.1, 0.8, 0.3],
})
const image = (side: 'current' | 'incoming'): GitMergeContent => ({
  ...audio(side),
  path: 'cover.png',
  url: `data:image/png;base64,${side}`,
  mime: 'image/png',
  durationMs: null,
  sampleRate: null,
  channels: null,
  waveform: null,
})

beforeEach(() => {
  vi.resetAllMocks()
  calls.session.outputDevice = 'Selected output'
  calls.read.mockResolvedValue(null)
  calls.choose.mockResolvedValue(undefined)
  calls.disconnected.mockReturnValue(() => undefined)
  calls.start.mockResolvedValue({
    status: 'ok',
    data: { positionMs: 0, durationMs: 2400, playing: true },
  })
  calls.stop.mockResolvedValue({ status: 'ok', data: null })
  calls.control.mockResolvedValue({
    status: 'ok',
    data: { positionMs: 0, durationMs: 2400, playing: true },
  })
  useCreationMergeStore.setState({
    identity: 'physical',
    candidate,
    contents: {
      'current:water.wav': audio('current'),
      'incoming:water.wav': audio('incoming'),
    },
  })
})

it('shows both waveforms and audio facts without autoplay or WebView audio URLs', async () => {
  const { container, unmount } = render(
    <CreationMergeMedia path="water.wav" locked={false} />
  )
  expect(screen.getAllByRole('img', { name: 'Waveform' })).toHaveLength(2)
  expect(screen.getAllByText('0:02 · 22.05 kHz · 1 channel')).toHaveLength(2)
  expect(calls.start).not.toHaveBeenCalled()
  expect(container.querySelector('audio')).not.toBeInTheDocument()
  expect(container.innerHTML).not.toContain('NEVER_EXPOSE_AUDIO_BYTES')
  expect(calls.read).toHaveBeenCalledWith('water.wav', 'current')
  expect(calls.read).toHaveBeenCalledWith('water.wav', 'incoming')

  const listen = screen.getAllByRole('button', { name: 'Listen' })[0]
  if (!listen) throw new Error('Missing current audio preview control')
  fireEvent.click(listen)
  await screen.findByRole('button', { name: 'Stop' })
  expect(calls.start).toHaveBeenCalledTimes(1)
  expect(calls.start.mock.calls[0]).toHaveLength(1)
  expect(calls.start).toHaveBeenCalledWith({
    identity: 'physical',
    candidateId: 'merge-1',
    revision: 4,
    path: 'water.wav',
    side: 'current',
    version: 'current-v1',
    preview: expect.any(String),
    device: 'Selected output',
    positionMs: 0,
    gain: 0.75,
  })
  const preview = calls.start.mock.calls[0]?.[0]?.preview
  unmount()
  expect(calls.stop).toHaveBeenCalledWith(preview)
})

it('permits listening during read-only review while refusing either binary choice', async () => {
  useCreationMergeStore.setState({
    candidate: { ...candidate, relation: 'fastForward' },
  })
  render(<CreationMergeMedia path="water.wav" locked />)
  expect(screen.getByRole('button', { name: 'Keep current' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Use incoming' })).toBeDisabled()
  const listen = screen.getAllByRole('button', { name: 'Listen' })[1]
  if (!listen) throw new Error('Missing incoming audio preview control')
  expect(listen).toBeEnabled()
  fireEvent.click(listen)
  await waitFor(() => expect(calls.start).toHaveBeenCalled())
  expect(calls.start.mock.calls[0]?.[0]).toMatchObject({
    side: 'incoming',
    version: 'incoming-v1',
  })
  expect(calls.choose).not.toHaveBeenCalled()
})

it.each(['playing', 'pending'] as const)(
  'retires a %s preview when output changes and restores the listen controls',
  async phase => {
    const response = {
      status: 'ok' as const,
      data: { positionMs: 0, durationMs: 2400, playing: true },
    }
    let resolveStart: (value: typeof response) => void = () => {
      throw new Error('Preview request has not started')
    }
    if (phase === 'pending')
      calls.start.mockReturnValueOnce(
        new Promise<typeof response>(resolve => {
          resolveStart = resolve
        })
      )
    const { rerender } = render(
      <CreationMergeMedia path="water.wav" locked={false} />
    )
    const listen = screen.getAllByRole('button', { name: 'Listen' })[0]
    if (!listen) throw new Error('Missing current audio preview control')
    fireEvent.click(listen)
    const preview = calls.start.mock.calls[0]?.[0]?.preview
    if (phase === 'playing') await screen.findByRole('button', { name: 'Stop' })
    else expect(listen).toBeDisabled()

    calls.session.outputDevice = 'Changed output'
    rerender(<CreationMergeMedia path="water.wav" locked={false} />)
    await waitFor(() => expect(calls.stop).toHaveBeenCalledWith(preview))
    const controls = screen.getAllByRole('button', { name: 'Listen' })
    expect(controls).toHaveLength(2)
    for (const control of controls) expect(control).toBeEnabled()
    expect(calls.start).toHaveBeenCalledTimes(1)
    if (phase === 'pending') {
      await act(async () => resolveStart(response))
      expect(
        screen.queryByRole('button', { name: 'Stop' })
      ).not.toBeInTheDocument()
    }
    const restarted = controls[0]
    if (!restarted) throw new Error('Missing restored audio preview control')
    fireEvent.click(restarted)
    await screen.findByRole('button', { name: 'Stop' })
    expect(calls.start).toHaveBeenCalledTimes(2)
    expect(calls.start.mock.calls[1]?.[0]).toMatchObject({
      device: 'Changed output',
      side: 'current',
    })
  }
)

it('shows loaded image dimensions for each side and forgets them when its version changes', async () => {
  useCreationMergeStore.setState({
    contents: {
      'current:cover.png': image('current'),
      'incoming:cover.png': image('incoming'),
    },
  })
  render(<CreationMergeMedia path="cover.png" locked={false} />)
  const current = screen.getByRole('img', { name: 'Current version' })
  const incoming = screen.getByRole('img', { name: 'Incoming version' })
  expect(current).toHaveAttribute('src', 'data:image/png;base64,current')
  expect(incoming).toHaveAttribute('src', 'data:image/png;base64,incoming')
  expect(screen.queryByText('640 × 480')).not.toBeInTheDocument()
  Object.defineProperties(current, {
    naturalWidth: { value: 640 },
    naturalHeight: { value: 480 },
  })
  Object.defineProperties(incoming, {
    naturalWidth: { value: 1280 },
    naturalHeight: { value: 720 },
  })
  fireEvent.load(current)
  fireEvent.load(incoming)
  expect(screen.getByText('640 × 480')).toBeInTheDocument()
  expect(screen.getByText('1280 × 720')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Keep current' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use incoming' }))
  expect(calls.choose.mock.calls).toEqual([
    ['cover.png', 'current'],
    ['cover.png', 'incoming'],
  ])

  act(() =>
    useCreationMergeStore.setState({
      candidate: { ...candidate, revision: 5 },
      contents: {
        'current:cover.png': { ...image('current'), version: 'current-v2' },
        'incoming:cover.png': image('incoming'),
      },
    })
  )
  expect(screen.queryByText('640 × 480')).not.toBeInTheDocument()
  expect(screen.getByText('1280 × 720')).toBeInTheDocument()
  expect(calls.start).not.toHaveBeenCalled()
})
