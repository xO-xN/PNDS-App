import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  act,
  cleanup,
  fireEvent,
  mockBoundingClientRect,
  mockOffsets,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { GlideHighlight } from './glide-highlight'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function FormatSelect({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('png')
  return (
    <Select
      value={value}
      onValueChange={next => {
        setValue(next)
        onChange(next)
      }}
    >
      <SelectTrigger aria-label="Export format">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="png">PNG</SelectItem>
        <SelectItem value="svg" disabled>
          SVG
        </SelectItem>
        <SelectItem value="jpg">JPG</SelectItem>
      </SelectContent>
    </Select>
  )
}

function ActionsMenu({
  onSelect,
  onClose,
}: {
  onSelect: () => void
  onClose: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent onCloseAutoFocus={onClose}>
        <DropdownMenuItem onSelect={onSelect}>Open</DropdownMenuItem>
        <DropdownMenuItem disabled>Unavailable</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked>Show grid</DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={onSelect}>
              Nested action
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

it('keeps hover separate from selection and preserves Select keyboard choice and focus return', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<FormatSelect onChange={onChange} />)
  const trigger = screen.getByRole('combobox', { name: 'Export format' })
  await user.click(trigger)
  const png = await screen.findByRole('option', { name: 'PNG' })
  const jpg = screen.getByRole('option', { name: 'JPG' })
  expect(png).toHaveAttribute('data-state', 'checked')
  expect(screen.getByRole('option', { name: 'SVG' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await user.hover(jpg)
  expect(onChange).not.toHaveBeenCalled()
  expect(png).toHaveAttribute('data-state', 'checked')
  await user.keyboard('{Home}{ArrowDown}')
  expect(jpg).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledExactlyOnceWith('jpg')
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(trigger).toHaveTextContent('JPG')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

it('dismisses Select with Escape without committing the hovered option', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<FormatSelect onChange={onChange} />)
  const trigger = screen.getByRole('combobox', { name: 'Export format' })
  await user.click(trigger)
  await user.hover(await screen.findByRole('option', { name: 'JPG' }))
  await user.keyboard('{Escape}')
  expect(onChange).not.toHaveBeenCalled()
  expect(trigger).toHaveTextContent('PNG')
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('retains checked menu semantics, skips disabled actions and calls the caller close hook', async () => {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<ActionsMenu onSelect={onSelect} onClose={onClose} />)
  const trigger = screen.getByRole('button', { name: 'Actions' })
  await user.click(trigger)
  expect(
    await screen.findByRole('menuitemcheckbox', { name: 'Show grid' })
  ).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('menuitem', { name: 'Unavailable' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await user.keyboard('{Home}{ArrowDown}')
  expect(
    screen.getByRole('menuitemcheckbox', { name: 'Show grid' })
  ).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(onSelect).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('keeps submenu keyboard navigation and action selection intact', async () => {
  const onSelect = vi.fn()
  const user = userEvent.setup()
  render(<ActionsMenu onSelect={onSelect} onClose={vi.fn()} />)
  const trigger = screen.getByRole('button', { name: 'Actions' })
  await user.click(trigger)
  await user.keyboard('{End}{ArrowRight}')
  const nested = await screen.findByRole('menuitem', { name: 'Nested action' })
  expect(nested).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  await waitFor(() => expect(trigger).toHaveFocus())
})

function ListFixture({
  selected = 'first',
  second = true,
  nested = false,
}: {
  selected?: 'first' | 'second'
  second?: boolean
  nested?: boolean
}) {
  return (
    <div className="pnds-glide-list" data-testid="glide-list">
      <GlideHighlight />
      <button
        data-glide-item=""
        data-state={selected === 'first' ? 'checked' : 'unchecked'}
      >
        First
      </button>
      {second && (
        <button
          data-glide-item=""
          data-state={selected === 'second' ? 'checked' : 'unchecked'}
        >
          Second
        </button>
      )}
      <button data-glide-item="" disabled>
        Disabled
      </button>
      {nested && (
        <div className="pnds-glide-list" data-testid="nested-glide-list">
          <GlideHighlight />
          <button data-glide-item="">Nested</button>
        </div>
      )}
    </div>
  )
}

function pinList() {
  const host = screen.getByTestId('glide-list')
  const first = screen.getByRole('button', { name: 'First' })
  const second = screen.getByRole('button', { name: 'Second' })
  const disabled = screen.getByRole('button', { name: 'Disabled' })
  const highlight = host.querySelector<HTMLElement>('.pnds-glide-highlight')
  if (!highlight) throw new Error('Expected a decorative menu highlight')
  mockBoundingClientRect(host, { left: 20, top: 100, width: 200, height: 120 })
  mockOffsets(host, { width: 200, height: 120 })
  mockBoundingClientRect(first, { left: 24, top: 104, width: 192, height: 30 })
  mockBoundingClientRect(second, { left: 24, top: 135, width: 192, height: 40 })
  mockBoundingClientRect(disabled, {
    left: 24,
    top: 176,
    width: 192,
    height: 30,
  })
  fireEvent(window, new Event('resize'))
  return { host, first, second, disabled, highlight }
}

it('glides over actual row bounds, remembers pointer leave, skips disabled rows and jumps for keyboard focus', () => {
  render(<ListFixture />)
  const { host, first, second, disabled, highlight } = pinList()
  expect(highlight).toHaveAttribute('aria-hidden', 'true')
  expect(highlight.style.transform).toBe('translate(4px, 4px)')
  fireEvent.pointerMove(second, { pointerType: 'mouse' })
  expect(highlight.style.transform).toBe('translate(4px, 35px)')
  expect(highlight.style.height).toBe('40px')
  expect(highlight).toHaveAttribute('data-instant', 'false')
  fireEvent.pointerLeave(host)
  expect(highlight.style.transform).toBe('translate(4px, 35px)')
  fireEvent.pointerMove(disabled, { pointerType: 'mouse' })
  expect(highlight.style.transform).toBe('translate(4px, 35px)')
  fireEvent.keyDown(host, { key: 'Home' })
  act(() => first.focus())
  expect(highlight.style.transform).toBe('translate(4px, 4px)')
  expect(highlight).toHaveAttribute('data-instant', 'true')
})

it('keeps the highlight aligned through scrolling and surface entrance scaling', () => {
  render(<ListFixture />)
  const { host, second, highlight } = pinList()
  fireEvent.pointerMove(second, { pointerType: 'mouse' })
  // Scroll changes viewport rects, while the highlight shares content coordinates.
  host.scrollTop = 20
  mockBoundingClientRect(second, { left: 24, top: 115, width: 192, height: 40 })
  fireEvent.scroll(host)
  expect(highlight.style.transform).toBe('translate(4px, 35px)')
  expect(highlight).toHaveAttribute('data-instant', 'true')

  host.scrollTop = 0
  mockBoundingClientRect(host, { left: 20, top: 100, width: 100, height: 60 })
  mockBoundingClientRect(second, {
    left: 22,
    top: 117.5,
    width: 96,
    height: 20,
  })
  fireEvent(window, new Event('resize'))
  expect(highlight.style.transform).toBe('translate(4px, 35px)')
  expect(highlight.style.width).toBe('192px')
  expect(highlight.style.height).toBe('40px')
})

it('keeps nested menu pointer and focus highlights independent', () => {
  render(<ListFixture nested />)
  const { first, highlight } = pinList()
  const nestedHost = screen.getByTestId('nested-glide-list')
  const nested = within(nestedHost).getByRole('button', { name: 'Nested' })
  const nestedHighlight = nestedHost.querySelector<HTMLElement>(
    '.pnds-glide-highlight'
  )
  if (!nestedHighlight) throw new Error('Expected a nested menu highlight')
  mockBoundingClientRect(nestedHost, {
    left: 220,
    top: 135,
    width: 120,
    height: 40,
  })
  mockOffsets(nestedHost, { width: 120, height: 40 })
  mockBoundingClientRect(nested, {
    left: 224,
    top: 139,
    width: 112,
    height: 30,
  })
  fireEvent.pointerMove(first, { pointerType: 'mouse' })
  fireEvent.pointerMove(nested, { pointerType: 'mouse' })
  act(() => nested.focus())
  expect(nestedHighlight.style.transform).toBe('translate(4px, 4px)')
  expect(highlight.style.transform).toBe('translate(4px, 4px)')
})

it('returns from a removed active row to the retained selection', async () => {
  const { rerender } = render(<ListFixture />)
  const { second, highlight } = pinList()
  fireEvent.pointerMove(second, { pointerType: 'mouse' })
  expect(highlight.style.transform).toBe('translate(4px, 35px)')
  rerender(<ListFixture second={false} />)
  await waitFor(() =>
    expect(highlight.style.transform).toBe('translate(4px, 4px)')
  )
})

it('jumps to a new externally controlled selection while the pointer is inactive', async () => {
  const { rerender } = render(<ListFixture />)
  const { highlight } = pinList()
  expect(highlight.style.transform).toBe('translate(4px, 4px)')
  rerender(<ListFixture selected="second" />)
  await waitFor(() =>
    expect(highlight.style.transform).toBe('translate(4px, 35px)')
  )
  expect(highlight).toHaveAttribute('data-instant', 'true')
})

it('remeasures changing row heights inside a bounded menu and releases removed row observations', async () => {
  const callbacks = new Map<Element, () => void>()
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe(target: Element) {
        callbacks.set(target, this.callback)
      }
      unobserve(target: Element) {
        callbacks.delete(target)
      }
      disconnect() {
        callbacks.clear()
        disconnect()
      }
    }
  )
  const { rerender, unmount } = render(<ListFixture />)
  const { first, second, highlight } = pinList()
  fireEvent.pointerMove(second, { pointerType: 'mouse' })

  // The scrolling host stays 120px high while an earlier description wraps.
  mockBoundingClientRect(first, { left: 24, top: 104, width: 192, height: 60 })
  mockBoundingClientRect(second, { left: 24, top: 165, width: 192, height: 40 })
  act(() => callbacks.get(first)?.())
  expect(highlight.style.transform).toBe('translate(4px, 65px)')

  mockBoundingClientRect(second, { left: 24, top: 165, width: 192, height: 64 })
  act(() => callbacks.get(second)?.())
  expect(highlight.style.height).toBe('64px')
  expect(highlight).toHaveAttribute('data-instant', 'true')

  rerender(<ListFixture second={false} />)
  await waitFor(() => expect(callbacks.has(second)).toBe(false))
  rerender(<ListFixture />)
  const replacement = screen.getByRole('button', { name: 'Second' })
  await waitFor(() => expect(callbacks.has(replacement)).toBe(true))
  mockBoundingClientRect(replacement, {
    left: 24,
    top: 165,
    width: 192,
    height: 64,
  })
  fireEvent.pointerMove(replacement, { pointerType: 'mouse' })
  mockBoundingClientRect(replacement, {
    left: 24,
    top: 165,
    width: 192,
    height: 80,
  })
  act(() => callbacks.get(replacement)?.())
  expect(highlight.style.height).toBe('80px')

  unmount()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(callbacks.size).toBe(0)
})
