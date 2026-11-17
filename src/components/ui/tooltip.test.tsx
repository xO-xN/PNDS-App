import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { TooltipHint, TooltipProvider } from './tooltip'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

afterEach(async () => {
  cleanup()
  await new Promise(resolve => setTimeout(resolve, 0))
})

const user = () => userEvent.setup()

it('waits the full hover delay for every control after another hint was shown', async () => {
  const input = user()
  render(
    <TooltipProvider>
      <TooltipHint content="First action">
        <button>First</button>
      </TooltipHint>
      <TooltipHint content="Second action">
        <button>Second</button>
      </TooltipHint>
    </TooltipProvider>
  )
  await input.hover(screen.getByRole('button', { name: 'First' }))
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(await screen.findByRole('tooltip')).toHaveTextContent('First action')
  await input.unhover(screen.getByRole('button', { name: 'First' }))
  // Leave Radix's pointer corridor; jsdom otherwise places every box at 0,0.
  await input.pointer({
    target: document.body,
    coords: { clientX: 1000, clientY: 1000 },
  })
  await input.hover(screen.getByRole('button', { name: 'Second' }))
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Second action')
})

it('cancels a pending hint when the pointer leaves before the delay', async () => {
  const input = user()
  render(
    <TooltipHint content="Saved files only">
      <button>Run</button>
    </TooltipHint>
  )
  const button = screen.getByRole('button', { name: 'Run' })
  await input.hover(button)
  await input.unhover(button)
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

it('does not retain a hidden open state when there is no extra hint', async () => {
  const input = user()
  const { rerender } = render(
    <TooltipHint content={undefined}>
      <button>Send</button>
    </TooltipHint>
  )
  const button = screen.getByRole('button', { name: 'Send' })
  await input.hover(button)
  await new Promise(resolve => setTimeout(resolve, 600))
  await input.unhover(button)
  rerender(
    <TooltipHint content="Retry sending">
      <button>Send</button>
    </TooltipHint>
  )
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

it('shows hints immediately on keyboard focus and dismisses with Escape', async () => {
  const input = user()
  render(
    <TooltipHint content="Pause the task and keep saved changes">
      <button aria-label="Pause" />
    </TooltipHint>
  )
  await input.tab()
  expect(screen.getByRole('tooltip')).toHaveTextContent('keep saved changes')
  expect(screen.getByRole('button', { name: 'Pause' })).not.toHaveAttribute(
    'title'
  )
  await input.keyboard('{Escape}')
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  const button = screen.getByRole('button', { name: 'Pause' })
  expect(button).toHaveFocus()
  await input.hover(button)
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'keep saved changes'
  )
})

it('preserves a popup trigger, its ref and its click action without extra buttons', async () => {
  const input = user()
  function Popup() {
    const trigger = useRef<HTMLButtonElement>(null)
    return (
      <Popover>
        <TooltipHint content="File actions">
          <PopoverTrigger asChild>
            <button ref={trigger}>More</button>
          </PopoverTrigger>
        </TooltipHint>
        <PopoverContent>
          <button onClick={() => trigger.current?.focus()}>Return focus</button>
        </PopoverContent>
      </Popover>
    )
  }
  render(<Popup />)
  await input.tab()
  expect(screen.getByRole('tooltip')).toHaveTextContent('File actions')
  expect(screen.getAllByRole('button')).toHaveLength(1)
  await input.click(screen.getByRole('button', { name: 'More' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  await input.click(screen.getByRole('button', { name: 'Return focus' }))
  expect(screen.getByRole('button', { name: 'More' })).toHaveFocus()
})

it('dismisses a keyboard hint when the action prevents its default click', async () => {
  const input = user()
  let presses = 0
  render(
    <TooltipHint content="Pause the task">
      <button
        onClick={event => {
          event.preventDefault()
          presses += 1
        }}
      >
        Pause
      </button>
    </TooltipHint>
  )
  await input.tab()
  expect(screen.getByRole('tooltip')).toHaveTextContent('Pause the task')
  await input.keyboard('{Enter}')
  expect(presses).toBe(1)
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

it('reveals complete text only when its visible label is truncated', async () => {
  const input = user()
  render(
    <TooltipHint content="Complete chat title" overflowOnly>
      <button>
        <span className="truncate">Complete chat title</span>
      </button>
    </TooltipHint>
  )
  const label = screen.getByText('Complete chat title')
  Object.defineProperties(label, {
    clientWidth: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: 100 },
  })
  await input.tab()
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  await input.tab()
  Object.defineProperty(label, 'scrollWidth', { value: 200 })
  await input.tab({ shift: true })
  expect(screen.getByRole('tooltip')).toHaveTextContent('Complete chat title')
})
