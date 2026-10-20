import { expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  mockBoundingClientRect,
} from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { CreationGitSplit } from './CreationGitSplit'

it('resizes by pointer and keyboard, bounds both panels and restores a canceled drag', () => {
  render(
    <CreationGitSplit graph={<div>Graph</div>} collapsed={false}>
      <div>Difference</div>
    </CreationGitSplit>
  )
  const divider = screen.getByRole('separator')
  const initial = Number(divider.getAttribute('aria-valuenow'))
  fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientY: 100 })
  fireEvent.pointerMove(divider, { pointerId: 1, clientY: 140 })
  expect(Number(divider.getAttribute('aria-valuenow'))).toBe(initial + 40)
  fireEvent.pointerCancel(divider, { pointerId: 1 })
  expect(Number(divider.getAttribute('aria-valuenow'))).toBe(initial)
  fireEvent.pointerDown(divider, { button: 0, pointerId: 2, clientY: 100 })
  fireEvent.pointerMove(divider, { pointerId: 2, clientY: 1000 })
  expect(divider.getAttribute('aria-valuenow')).toBe(
    divider.getAttribute('aria-valuemax')
  )
  fireEvent.pointerUp(divider, { pointerId: 2 })
  fireEvent.keyDown(divider, { key: 'ArrowUp' })
  expect(Number(divider.getAttribute('aria-valuenow'))).toBe(
    Number(divider.getAttribute('aria-valuemax')) - 16
  )
  fireEvent.doubleClick(divider)
  expect(Number(divider.getAttribute('aria-valuenow'))).toBe(initial)
  const frame = divider.parentElement
  if (!frame) throw new Error('Expected graph/difference frame')
  mockBoundingClientRect(frame, { top: 0, width: 500, height: 300 })
  fireEvent(window, new Event('resize'))
  expect(Number(divider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
    Number(divider.getAttribute('aria-valuemax'))
  )
  expect(Number(divider.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(
    Number(divider.getAttribute('aria-valuemin'))
  )
})

it('retains the chosen height through collapse and offers resizing without a drag', () => {
  vi.clearAllMocks()
  const props = { graph: <div>Graph</div>, children: <div>Difference</div> }
  const { rerender } = render(<CreationGitSplit {...props} collapsed={false} />)
  const divider = screen.getByRole('separator')
  fireEvent.keyDown(divider, { key: 'ArrowDown' })
  const height = divider.getAttribute('aria-valuenow')
  rerender(<CreationGitSplit {...props} collapsed />)
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  rerender(<CreationGitSplit {...props} collapsed={false} />)
  expect(divider.getAttribute('aria-valuenow')).toBe(height)
  fireEvent.contextMenu(divider)
  fireEvent.click(
    screen.getByRole('menuitem', { name: 'Increase graph height' })
  )
  expect(Number(divider.getAttribute('aria-valuenow'))).toBeGreaterThan(
    Number(height)
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})
