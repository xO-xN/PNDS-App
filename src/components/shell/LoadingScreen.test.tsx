import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useSessionStore } from '@/store/session-store'
import { LoadingScreen } from './LoadingScreen'

describe.each(['none', 'external', 'internal'] as const)(
  'LoadingScreen suspension recovery (%s, #34)',
  audioMode => {
    let now = 0
    let nextId = 0
    const callbacks = new Map<number, FrameRequestCallback>()
    const entranceMs = ((audioMode === 'internal' ? 120 : 50) * 1000) / 60

    // Advance monotonic time independently of callback delivery: advancing
    // Vitest's rAF timers normally would run every missing frame and hide #34.
    const step = async (elapsed: number) => {
      now += elapsed
      const pending = [...callbacks.values()]
      callbacks.clear()
      await act(async () => pending.forEach(callback => callback(now)))
    }
    const frames = async (count: number) => {
      for (let i = 0; i < count; i++) await step(1000 / 60)
    }
    const ready = async (loaded = true) => {
      await act(async () => {
        useSessionStore.setState({
          sessionStatus: 'ready',
          health: {
            status: 'ready',
            projectId: 'fixture',
            audioMode,
            audio: { status: 'disabled', target: null, error: null },
            scoreServer: {
              performerPort: 6868,
              monitorPort: 6869,
              error: null,
            },
          },
          monitorLoaded: loaded,
        })
      })
    }
    const fade = async () => {
      await act(async () => vi.advanceTimersByTime(400))
    }

    beforeEach(() => {
      now = 0
      callbacks.clear()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.spyOn(performance, 'now').mockImplementation(() => now)
      vi.stubGlobal(
        'requestAnimationFrame',
        (callback: FrameRequestCallback) => {
          callbacks.set(++nextId, callback)
          return nextId
        }
      )
      vi.stubGlobal('cancelAnimationFrame', (id: number) =>
        callbacks.delete(id)
      )
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        canvas: { width: 600 },
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
      } as unknown as CanvasRenderingContext2D)
      useSessionStore.getState().resetSession()
      useSessionStore.setState({ audioMode })
    })
    afterEach(() => {
      cleanup()
      vi.useRealTimers()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    it('preserves both foreground phases even when ready arrives early', async () => {
      const done = vi.fn()
      render(<LoadingScreen onDissolveEnd={done} />)
      await ready()
      await frames(Math.floor(entranceMs / (1000 / 60)) - 1)
      await fade()
      expect(done).not.toHaveBeenCalled()
      await frames(85)
      await fade()
      expect(done).not.toHaveBeenCalled()
      await frames(10)
      await fade()
      expect(done).toHaveBeenCalledOnce()
    })

    it('finishes an elapsed closure on the first frame after a long suspension', async () => {
      const done = vi.fn()
      render(<LoadingScreen onDissolveEnd={done} />)
      await frames(130)
      await ready()
      await frames(5)
      await step(30_000)
      await fade()
      expect(done).toHaveBeenCalledOnce()
    })

    it('uses elapsed time at low frame rates without stretching the phases', async () => {
      const done = vi.fn()
      render(<LoadingScreen onDissolveEnd={done} />)
      await ready()
      for (let i = 0; i < Math.ceil((entranceMs + 1500) / 100); i++) {
        await step(100)
      }
      await fade()
      expect(done).toHaveBeenCalledOnce()
    })

    it('keeps the clock when a snapshot changes audio mode during entrance', async () => {
      const done = vi.fn()
      render(<LoadingScreen onDissolveEnd={done} />)
      await frames(30)
      await act(async () => useSessionStore.getState().setAudioMode('internal'))
      await ready()
      await frames(181)
      await fade()
      expect(done).toHaveBeenCalledOnce()
    })

    it('handles a ready snapshot delivered before the first resumed entrance frame', async () => {
      const done = vi.fn()
      render(<LoadingScreen onDissolveEnd={done} />)
      await frames(5)
      now += 30_000
      await ready()
      await step(1000 / 60)
      await fade()
      expect(done).toHaveBeenCalledOnce()
    })

    it('handles ready delivered after rAF resumes from the waiting phase', async () => {
      const done = vi.fn()
      render(<LoadingScreen onDissolveEnd={done} />)
      await frames(130)
      await step(30_000)
      await frames(30)
      await fade()
      expect(done).not.toHaveBeenCalled()
      await ready()
      await step(1000 / 60)
      await fade()
      expect(done).toHaveBeenCalledOnce()
    })

    it('plays the closure after a long foreground wait for backend readiness', async () => {
      const done = vi.fn()
      render(<LoadingScreen onDissolveEnd={done} />)
      await frames(2000)
      await ready()
      await frames(5)
      await fade()
      expect(done).not.toHaveBeenCalled()
      await frames(90)
      await fade()
      expect(done).toHaveBeenCalledOnce()
    })

    it.each(['load', 'timeout'] as const)(
      'keeps the monitor gate held after suspension until %s',
      async release => {
        const done = vi.fn()
        render(<LoadingScreen onDissolveEnd={done} />)
        await frames(5)
        now += 30_000
        await ready(false)
        await step(1000 / 60)
        await fade()
        expect(done).not.toHaveBeenCalled()
        await act(async () => {
          if (release === 'load') {
            useSessionStore.getState().markMonitorLoaded()
          } else {
            useSessionStore.getState().markMonitorTimedOut()
          }
        })
        await fade()
        expect(done).toHaveBeenCalledOnce()
      }
    )

    it('cancels the old animation on unmount and gives the next run its full entrance', async () => {
      const previous = vi.fn()
      const next = vi.fn()
      const view = render(<LoadingScreen onDissolveEnd={previous} />)
      await frames(5)
      view.unmount()
      now += 30_000
      render(<LoadingScreen onDissolveEnd={next} />)
      await ready()
      await frames(5)
      await fade()
      expect(previous).not.toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
      await frames(220)
      await fade()
      expect(previous).not.toHaveBeenCalled()
      expect(next).toHaveBeenCalledOnce()
    })
  }
)
