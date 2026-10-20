import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { CreationReadme } from './CreationReadme'
import cover from '@/test/fixtures/readme/cover.txt?raw'

let resized: (() => void) | undefined
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('fits the fixed 1200 × 800 artwork to the available pane on first arrival and resize', () => {
  let width = 800
  let height = 600
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('project-cover-page') ? width : 0
    }
  )
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('project-cover-page') ? height : 0
    }
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: () => void
      constructor(callback: () => void) {
        this.callback = callback
      }
      observe(target: HTMLElement) {
        if (target.classList.contains('project-cover-page'))
          resized = this.callback
      }
      disconnect = vi.fn()
    }
  )
  const view = render(
    <CreationReadme text={cover} root="/score" editable onChange={vi.fn()} />
  )
  const artwork = screen.getByTestId('project-cover-page')
  const frame = screen.getByTestId('cover-content-stage')
  expect(Number(frame.style.getPropertyValue('--cover-scale'))).toBeCloseTo(
    752 / 1200
  )
  width = 400
  act(() => resized?.())
  expect(Number(frame.style.getPropertyValue('--cover-scale'))).toBeCloseTo(
    352 / 1200
  )
  width = 1600
  height = 450
  act(() => resized?.())
  expect(Number(frame.style.getPropertyValue('--cover-scale'))).toBeCloseTo(
    402 / 800
  )
  view.rerender(
    <CreationReadme
      text={cover.replace('Original', 'Updated')}
      root="/score"
      editable
      onChange={vi.fn()}
    />
  )
  expect(screen.getByTestId('project-cover-page')).toBe(artwork)
  expect(Number(frame.style.getPropertyValue('--cover-scale'))).toBeCloseTo(
    402 / 800
  )
  view.unmount()
  vi.unstubAllGlobals()
})

it('edits a cover field from the finished composition without replacing the preview', async () => {
  const change = vi.fn()
  render(
    <CreationReadme text={cover} root="/score" editable onChange={change} />
  )
  const artwork = screen.getByTestId('project-cover-page')
  const trigger = screen.getByRole('button', { name: 'Edit Cover title' })
  fireEvent.click(trigger)
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'Cover title' }),
    { target: { value: 'New title' } }
  )
  expect(change).toHaveBeenCalledWith('title', 'New title')
  expect(screen.getByTestId('project-cover-page')).toBe(artwork)
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(
    screen.queryByRole('textbox', { name: 'Cover title' })
  ).not.toBeInTheDocument()
  expect(screen.getByTestId('project-cover-page')).toBe(artwork)
  // Radix restores focus asynchronously; let it finish before jsdom teardown.
  await waitFor(() => expect(trigger).toHaveFocus())
})
