import { useState, type FormEvent } from 'react'
import type * as MotionReact from 'motion/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  mockBoundingClientRect,
  render,
  screen,
} from '@/test/test-utils'
import i18n from '@/i18n/config'
import type { AssistantMode } from '@/lib/tauri-bindings'
import { AssistantModeSwitch } from './AssistantModeSwitch'

vi.mock('motion/react', async importOriginal => {
  const actual = await importOriginal<typeof MotionReact>()
  return {
    ...actual,
    animate: vi.fn(
      (value: { set: (target: number) => void }, target: number) => {
        value.set(target)
        return Promise.resolve()
      }
    ),
  }
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  )
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await i18n.changeLanguage('en')
})

function Harness({ onChange }: { onChange: (mode: AssistantMode) => void }) {
  const [value, setValue] = useState<AssistantMode>('discussion')
  return (
    <AssistantModeSwitch
      value={value}
      disabled={false}
      onChange={next => {
        onChange(next)
        setValue(next)
      }}
    />
  )
}

function measureSwitch() {
  const group = screen.getByRole('radiogroup', { name: 'Mode' })
  const discussion = screen.getByRole('radio', { name: 'Discussion' })
  const work = screen.getByRole('radio', { name: 'Work' })
  mockBoundingClientRect(group, { left: 20, top: 0, width: 204, height: 30 })
  mockBoundingClientRect(discussion, {
    left: 22,
    top: 2,
    width: 100,
    height: 26,
  })
  mockBoundingClientRect(work, { left: 122, top: 2, width: 100, height: 26 })
  for (const button of [discussion, work]) {
    const captured = new Set<number>()
    vi.spyOn(button, 'setPointerCapture').mockImplementation(id => {
      captured.add(id)
    })
    vi.spyOn(button, 'hasPointerCapture').mockImplementation(id =>
      captured.has(id)
    )
    vi.spyOn(button, 'releasePointerCapture').mockImplementation(id => {
      captured.delete(id)
    })
  }
  fireEvent(window, new Event('resize'))
  return { group, discussion, work }
}

function pointer(
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  target: Element,
  clientX: number,
  time: number
) {
  const event = createEvent[type](target, {
    pointerId: 1,
    button: 0,
    clientX,
  })
  Object.defineProperty(event, 'timeStamp', { value: time })
  fireEvent(target, event)
}

it('selects by click, Enter and Space once per change without submitting the composer form', async () => {
  const onChange = vi.fn()
  const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
  const user = userEvent.setup()
  render(
    <form onSubmit={onSubmit}>
      <Harness onChange={onChange} />
    </form>
  )
  const { discussion, work } = measureSwitch()
  expect(screen.getAllByRole('radio')).toHaveLength(2)
  expect(discussion).toHaveAttribute('aria-checked', 'true')
  expect(discussion).toHaveAttribute('tabindex', '0')
  expect(work).toHaveAttribute('tabindex', '-1')
  await user.click(discussion)
  expect(onChange).not.toHaveBeenCalled()
  await user.click(work)
  expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
  expect(work).toHaveAttribute('aria-checked', 'true')
  discussion.focus()
  await user.keyboard('{Enter}')
  work.focus()
  await user.keyboard(' ')
  expect(onChange.mock.calls).toEqual([['edit'], ['discussion'], ['edit']])
  expect(onSubmit).not.toHaveBeenCalled()
})

it('keeps one tab stop and moves selection and focus with arrows, Home and End', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness onChange={onChange} />)
  const { discussion, work } = measureSwitch()
  await user.tab()
  expect(discussion).toHaveFocus()
  await user.keyboard('{ArrowRight}')
  expect(work).toHaveFocus()
  expect(work).toHaveAttribute('tabindex', '0')
  expect(discussion).toHaveAttribute('tabindex', '-1')
  await user.keyboard('{ArrowLeft}')
  expect(discussion).toHaveFocus()
  await user.keyboard('{End}')
  expect(work).toHaveFocus()
  await user.keyboard('{Home}')
  expect(discussion).toHaveFocus()
  await user.keyboard('{ArrowDown}{ArrowUp}')
  expect(discussion).toHaveFocus()
  expect(onChange.mock.calls).toEqual([
    ['edit'],
    ['discussion'],
    ['edit'],
    ['discussion'],
    ['edit'],
    ['discussion'],
  ])
})

it('reflects external controlled updates without requesting another change', () => {
  const onChange = vi.fn()
  const { rerender } = render(
    <AssistantModeSwitch
      value="discussion"
      disabled={false}
      onChange={onChange}
    />
  )
  const { discussion, work } = measureSwitch()
  rerender(
    <AssistantModeSwitch value="edit" disabled={false} onChange={onChange} />
  )
  expect(work).toHaveAttribute('aria-checked', 'true')
  expect(work).toHaveAttribute('tabindex', '0')
  expect(discussion).toHaveAttribute('aria-checked', 'false')
  expect(onChange).not.toHaveBeenCalled()
})

it('blocks pointer, click and keyboard changes while disabled', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(
    <AssistantModeSwitch value="discussion" disabled onChange={onChange} />
  )
  const { group, discussion, work } = measureSwitch()
  expect(group).toHaveAttribute('aria-disabled', 'true')
  expect(discussion).toBeDisabled()
  expect(work).toBeDisabled()
  await user.click(work)
  fireEvent.keyDown(group, { key: 'End' })
  pointer('pointerDown', discussion, 72, 0)
  pointer('pointerMove', group, 172, 500)
  pointer('pointerUp', group, 172, 600)
  expect(onChange).not.toHaveBeenCalled()
})

it('commits a drag only on release and suppresses its trailing click', () => {
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  const { group, discussion, work } = measureSwitch()
  pointer('pointerDown', discussion, 72, 0)
  pointer('pointerMove', group, 172, 500)
  expect(onChange).not.toHaveBeenCalled()
  pointer('pointerUp', group, 172, 700)
  expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
  expect(work).toHaveAttribute('aria-checked', 'true')
  expect(work).toHaveFocus()
  fireEvent.click(discussion, { detail: 1 })
  expect(onChange).toHaveBeenCalledTimes(1)
})

it.each([
  { direction: 'LTR', gesture: 'toward Work', delta: 5, changes: true },
  { direction: 'LTR', gesture: 'outward', delta: -5, changes: false },
  { direction: 'RTL', gesture: 'toward Work', delta: -5, changes: true },
  { direction: 'RTL', gesture: 'outward', delta: 5, changes: false },
])(
  'handles a short $direction flick $gesture without requiring midpoint crossing',
  ({ direction, delta, changes }) => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const { group, discussion, work } = measureSwitch()
    const rtl = direction === 'RTL'
    if (rtl) {
      group.dir = 'rtl'
      mockBoundingClientRect(discussion, {
        left: 122,
        top: 2,
        width: 100,
        height: 26,
      })
      mockBoundingClientRect(work, {
        left: 22,
        top: 2,
        width: 100,
        height: 26,
      })
      fireEvent(window, new Event('resize'))
    }
    const start = rtl ? 172 : 72
    // 5px in 40ms passes the flick threshold but its projection stays in this slot.
    pointer('pointerDown', discussion, start, 1000)
    pointer('pointerMove', group, start + delta, 1040)
    pointer('pointerUp', group, start + delta, 1041)
    if (changes) expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
    else expect(onChange).not.toHaveBeenCalled()
    expect(work).toHaveAttribute('aria-checked', String(changes))
    expect(discussion).toHaveAttribute('aria-checked', String(!changes))
  }
)

it.each(['pointerCancel', 'lostPointerCapture'] as const)(
  'abandons the drag on %s and allows a later deliberate selection',
  cancellation => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const { group, discussion, work } = measureSwitch()
    pointer('pointerDown', discussion, 72, 0)
    pointer('pointerMove', group, 172, 500)
    fireEvent[cancellation](discussion, { pointerId: 1 })
    pointer('pointerUp', group, 172, 700)
    expect(onChange).not.toHaveBeenCalled()
    expect(discussion).toHaveAttribute('aria-checked', 'true')
    expect(discussion.releasePointerCapture).toHaveBeenCalledWith(1)
    fireEvent.click(discussion, { detail: 1 })
    pointer('pointerDown', work, 172, 1000)
    pointer('pointerUp', work, 172, 1100)
    fireEvent.click(work, { detail: 1 })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
  }
)

it('abandons a live drag when disabled and does not revive it after enabling', () => {
  const onChange = vi.fn()
  const { rerender } = render(
    <AssistantModeSwitch
      value="discussion"
      disabled={false}
      onChange={onChange}
    />
  )
  const { group, discussion, work } = measureSwitch()
  pointer('pointerDown', discussion, 72, 0)
  pointer('pointerMove', group, 172, 500)
  rerender(
    <AssistantModeSwitch value="discussion" disabled onChange={onChange} />
  )
  pointer('pointerUp', group, 172, 700)
  expect(discussion.releasePointerCapture).toHaveBeenCalledWith(1)
  expect(onChange).not.toHaveBeenCalled()
  rerender(
    <AssistantModeSwitch
      value="discussion"
      disabled={false}
      onChange={onChange}
    />
  )
  pointer('pointerUp', group, 172, 900)
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(work, { detail: 0 })
  expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
})

it('keeps an external mode change when it interrupts a drag and an old click follows', () => {
  const onChange = vi.fn()
  const { rerender } = render(
    <AssistantModeSwitch
      value="discussion"
      disabled={false}
      onChange={onChange}
    />
  )
  const { group, discussion, work } = measureSwitch()
  pointer('pointerDown', discussion, 72, 0)
  pointer('pointerMove', group, 172, 500)
  rerender(
    <AssistantModeSwitch value="edit" disabled={false} onChange={onChange} />
  )
  pointer('pointerUp', discussion, 172, 700)
  fireEvent.click(discussion, { detail: 1 })
  expect(work).toHaveAttribute('aria-checked', 'true')
  expect(onChange).not.toHaveBeenCalled()
})

it('updates localized names and hints while preserving radio selection', async () => {
  const onChange = vi.fn()
  render(
    <AssistantModeSwitch value="edit" disabled={false} onChange={onChange} />
  )
  measureSwitch()
  await act(() => i18n.changeLanguage('zh-CN'))
  expect(screen.getByRole('radiogroup', { name: '模式' })).toBeInTheDocument()
  const work = screen.getByRole('radio', { name: '工作' })
  expect(work).toHaveAttribute('aria-checked', 'true')
  await userEvent.hover(work)
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    i18n.t('assistant.mode.editHint')
  )
  expect(work).not.toHaveAttribute('title')
  expect(screen.getByRole('radio', { name: '讨论' })).toHaveAttribute(
    'aria-checked',
    'false'
  )
  expect(screen.getAllByRole('radio')).toHaveLength(2)
  expect(onChange).not.toHaveBeenCalled()
})
