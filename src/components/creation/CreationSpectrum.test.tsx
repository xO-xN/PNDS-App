import { afterEach, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { commands, events } from '@/lib/tauri-bindings'
import { useCreationSpectrumStore } from '@/store/creation-spectrum-store'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import {
  CreationSpectrum,
  CreationSpectrumStats,
  CreationSpectrumTelemetry,
} from './CreationSpectrum'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useCreationStore.setState({
    active: false,
    workspace: null,
    runtimeProject: null,
  })
})

async function prepareReadyRun() {
  const initial = await commands.getSessionState()
  if (initial.status !== 'ok') throw new Error(initial.error)
  const run = {
    ...initial.data,
    runtimeGeneration: 'ready-a',
    status: 'ready' as const,
    projectPath: '/saved-copy',
    audioMode: 'internal' as const,
  }
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'project',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
    runtimeProject: { root: '/score', path: '/saved-copy' },
  })
  useSessionStore.getState().applySnapshot(run)
  return { initial: initial.data, run }
}

it('subscribes only to the matching ready Internal run and clears readings when it changes', async () => {
  const { initial, run } = await prepareReadyRun()
  let receive!: Parameters<typeof events.creationAudioAnalyzerEvent.listen>[0]
  const unlisten = vi.fn()
  vi.spyOn(events.creationAudioAnalyzerEvent, 'listen').mockImplementation(
    async callback => {
      receive = callback
      return unlisten
    }
  )
  vi.mocked(commands.getCreationAudioStats).mockResolvedValueOnce({
    status: 'ok',
    data: { averageCpu: 8, peakCpu: 19, synths: 12, observedAt: Date.now() },
  })
  const { unmount } = render(
    <>
      <CreationSpectrumTelemetry />
      <CreationSpectrumStats />
    </>
  )
  await waitFor(() =>
    expect(commands.setCreationAudioAnalyzer).toHaveBeenCalledWith(
      'ready-a',
      true
    )
  )
  expect(screen.getByText(/DSP.*8%.*19%.*Synths 12/)).toBeVisible()
  const frame = {
    generation: 'ready-a',
    fftSize: 8192,
    sampleRate: 48_000,
    magnitudes: [0, 0.5],
  }
  act(() => {
    receive({
      event: 'creation-audio-analyzer-event',
      id: 1,
      payload: { ...frame, generation: 'old' },
    })
  })
  expect(useCreationSpectrumStore.getState().frame).toBeNull()
  act(() =>
    receive({ event: 'creation-audio-analyzer-event', id: 1, payload: frame })
  )
  expect(useCreationSpectrumStore.getState().frame).toEqual(frame)
  act(() => {
    useSessionStore.getState().applySnapshot({
      ...run,
      runtimeGeneration: 'ready-b',
      audioMode: 'external',
    })
  })
  await waitFor(() =>
    expect(commands.setCreationAudioAnalyzer).toHaveBeenCalledWith(
      'ready-a',
      false
    )
  )
  expect(unlisten).toHaveBeenCalledOnce()
  expect(useCreationSpectrumStore.getState().frame).toBeNull()
  expect(screen.queryByText(/DSP/)).toBeNull()
  unmount()
  useSessionStore.getState().applySnapshot(initial)
})

it('keeps three readout fields as values change and pitch drops out', async () => {
  const { initial, run } = await prepareReadyRun()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fill: vi.fn(),
    stroke: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(54)
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo = vi.fn()
      lineTo = vi.fn()
      closePath = vi.fn()
    }
  )
  const magnitudes = Array<number>(4096).fill(0)
  magnitudes[17] = 0.5
  const frame = {
    generation: run.runtimeGeneration,
    fftSize: 8192,
    sampleRate: 48_000,
    magnitudes,
  }
  useCreationSpectrumStore.setState({
    generation: run.runtimeGeneration,
    frame,
  })
  const { unmount } = render(<CreationSpectrum />)
  const chart = screen.getByRole('img', { name: 'Audio spectrum' })
  const cursor = screen.getByRole('slider', {
    name: 'Frequency spectrum cursor',
  })
  mockBoundingClientRect(chart, { left: 20, top: 0, width: 300 })
  fireEvent.pointerMove(chart, { clientX: 80 })

  const level = screen.getByText('-6.0 dBFS')
  const frequency = screen.getByText('99.6 Hz')
  const pitch = screen.getByText(/¢$/)
  const readout = level.parentElement
  expect(Array.from(readout?.children ?? [])).toEqual([level, frequency, pitch])
  expect(readout).not.toHaveTextContent(/project output|master gain/i)
  expect(cursor).toHaveAttribute('aria-valuetext', expect.stringContaining('¢'))

  act(() => {
    useCreationSpectrumStore.setState({
      frame: { ...frame, magnitudes: Array<number>(4096).fill(0) },
    })
  })
  expect(Array.from(readout?.children ?? [])).toEqual([level, frequency, pitch])
  expect(level).toHaveTextContent('-85.0 dBFS')
  expect(pitch).toHaveTextContent('—')
  expect(pitch).toHaveAttribute('aria-hidden', 'true')
  expect(cursor).not.toHaveAttribute(
    'aria-valuetext',
    expect.stringContaining('—')
  )
  fireEvent.pointerLeave(chart)
  expect(readout).not.toBeInTheDocument()

  fireEvent.focus(cursor)
  const keyboardReadout = screen.getByText('-85.0 dBFS')
  expect(keyboardReadout).toBeInTheDocument()
  fireEvent.blur(cursor)
  expect(keyboardReadout).not.toBeInTheDocument()

  unmount()
  useCreationSpectrumStore.setState({ generation: null, frame: null })
  useSessionStore.getState().applySnapshot(initial)
})
