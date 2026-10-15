import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { CreationSplitter } from './CreationSplitter'

function Harness({ rtl = false }: { rtl?: boolean }) {
  const frame = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={node => {
        frame.current = node
        if (node)
          mockBoundingClientRect(node, {
            left: 0,
            top: 0,
            width: 1000,
            height: 700,
          })
      }}
      style={{ direction: rtl ? 'rtl' : 'ltr' }}
    >
      <CreationSplitter frame={frame} hidden={false} />
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: null },
  })
  vi.mocked(commands.savePreferences).mockResolvedValue({
    status: 'ok',
    data: null,
  })
})

describe('creation splitter interaction', () => {
  it('mirrors arrow-key direction for RTL and resets on double-click', () => {
    render(<Harness rtl />)
    const divider = screen.getByRole('separator')
    divider.style.direction = 'rtl'
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(Number(divider.getAttribute('aria-valuenow'))).toBeGreaterThan(40)
    fireEvent.doubleClick(divider)
    expect(divider).toHaveAttribute('aria-valuenow', '40')
  })

  it('preserves a keyboard choice against a late saved preference and allows retry after a save failure', async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof commands.loadPreferences>>
    ) => void
    vi.mocked(commands.loadPreferences).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    vi.mocked(commands.savePreferences).mockResolvedValueOnce({
      status: 'error',
      error: 'disk full',
    })
    render(<Harness />)
    const divider = screen.getByRole('separator')
    fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not be saved'
    )
    const current = divider.getAttribute('aria-valuenow')
    await act(async () =>
      finish({
        status: 'ok',
        data: { theme: 'system', language: null, assistantMonitorRatio: 0.55 },
      })
    )
    expect(divider).toHaveAttribute('aria-valuenow', current)
    fireEvent.keyDown(divider, { key: 'Home' })
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    )
    expect(divider).toHaveAttribute('aria-valuenow', '40')
  })

  it('drags within readable bounds, saves only on release, and restores a cancelled drag', async () => {
    render(<Harness />)
    const divider = screen.getByRole('separator')
    fireEvent.pointerDown(divider, { pointerId: 3, button: 0 })
    fireEvent.pointerMove(divider, { pointerId: 3, clientX: 400 })
    expect(divider).toHaveAttribute('aria-valuenow', '56')
    expect(commands.savePreferences).not.toHaveBeenCalled()
    fireEvent.pointerUp(divider, { pointerId: 3 })
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledTimes(1)
    )
    fireEvent.pointerDown(divider, { pointerId: 4, button: 0 })
    fireEvent.pointerMove(divider, { pointerId: 4, clientX: 850 })
    expect(divider).toHaveAttribute('aria-valuenow', '37')
    fireEvent.pointerCancel(divider, { pointerId: 4 })
    expect(divider).toHaveAttribute('aria-valuenow', '56')
    expect(commands.savePreferences).toHaveBeenCalledTimes(1)
  })
})
