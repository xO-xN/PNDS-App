import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { AssistantThoughtLine } from './AssistantThoughtLine'

const trace = {
  entries: ['Read the saved source.', 'Checking the project.'] as [
    string,
    string,
  ],
  renderEntry: (text: string) => <p>{text}</p>,
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function advance(milliseconds: number) {
  act(() => vi.advanceTimersByTime(milliseconds))
}

function toggleTrace(name: string) {
  const summary = screen.getByLabelText(name)
  const details = summary.closest('details')
  if (!details) throw new Error('Expected a thought trace disclosure')
  fireEvent.click(summary)
  // Deliver the native toggle immediately rather than awaiting jsdom's task.
  fireEvent(details, new Event('toggle'))
  return details
}

it('counts the current run without resetting for phase labels or appended activity', () => {
  const { rerender } = render(
    <AssistantThoughtLine
      {...trace}
      status="pending"
      label="Reading installed help…"
    />
  )
  expect(screen.getByText('0.0s')).toHaveAttribute('aria-hidden', 'true')
  advance(1200)
  expect(screen.getByText('1.2s')).toBeInTheDocument()

  rerender(
    <AssistantThoughtLine
      {...trace}
      entries={[...trace.entries, 'Drafting the reply.']}
      status="pending"
      label="Preparing a reply…"
    />
  )
  expect(screen.getByText('Preparing a reply…')).toBeVisible()
  expect(screen.getByText('1.2s')).toBeInTheDocument()
  advance(60000)
  expect(screen.getByText('1m 1.2s')).toBeInTheDocument()
})

it('freezes the elapsed time and folds the trace on completion, allowing it to reopen', () => {
  const { rerender } = render(
    <AssistantThoughtLine {...trace} status="pending" />
  )
  expect(screen.queryByText(trace.entries[0])).not.toBeInTheDocument()
  const details = toggleTrace('Expand work steps')
  expect(details).toHaveAttribute('open')
  expect(screen.getByText(trace.entries[0])).toBeVisible()
  advance(2300)

  rerender(<AssistantThoughtLine {...trace} status="completed" />)
  expect(screen.getByText('Thought for')).toBeVisible()
  expect(screen.getByText('2.3s')).not.toHaveAttribute('aria-hidden')
  expect(details).not.toHaveAttribute('open')
  expect(screen.queryByText(trace.entries[0])).not.toBeInTheDocument()
  advance(10000)
  expect(screen.getByText('2.3s')).toBeVisible()

  toggleTrace('Expand work steps')
  expect(screen.getByText(trace.entries[0])).toBeVisible()
  expect(screen.getByText(trace.entries[1]).closest('li')).toHaveAttribute(
    'data-done',
    'true'
  )
  toggleTrace('Collapse work steps')
  expect(details).not.toHaveAttribute('open')
})

it('starts a fresh elapsed clock and folds the trace when a settled reply retries', () => {
  const { rerender } = render(
    <AssistantThoughtLine {...trace} status="pending" />
  )
  advance(3700)
  rerender(<AssistantThoughtLine {...trace} status="failed" />)
  expect(screen.getByText('3.7s')).toBeVisible()
  const details = toggleTrace('Expand work steps')
  expect(details).toHaveAttribute('open')

  rerender(<AssistantThoughtLine {...trace} status="pending" />)
  expect(screen.getByText('0.0s')).toBeInTheDocument()
  expect(details).not.toHaveAttribute('open')
  expect(screen.queryByText('3.7s')).not.toBeInTheDocument()
  advance(400)
  expect(screen.getByText('0.4s')).toBeInTheDocument()
})

it('keeps restored history inspectable without inventing an elapsed duration', () => {
  const { container, rerender } = render(
    <AssistantThoughtLine {...trace} status="completed" />
  )
  expect(screen.getByText('Thought process')).toBeVisible()
  expect(container.querySelector('.assistant-thought-line__timer')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  toggleTrace('Expand work steps')
  expect(screen.getByText(trace.entries[0])).toBeVisible()

  rerender(<AssistantThoughtLine {...trace} status="completed" entries={[]} />)
  expect(container).toBeEmptyDOMElement()
})

it.each([
  ['cancelled', 'Thinking paused'],
  ['failed', 'Thinking interrupted'],
] as const)(
  'folds a %s trace and keeps its final step unfinished when reopened',
  (status, label) => {
    const { rerender } = render(
      <AssistantThoughtLine {...trace} status="pending" />
    )
    const details = toggleTrace('Expand work steps')
    advance(900)
    rerender(<AssistantThoughtLine {...trace} status={status} />)
    expect(screen.getByText(label)).toBeVisible()
    expect(details).not.toHaveAttribute('open')
    advance(1000)
    expect(screen.getByText('0.9s')).toBeVisible()

    toggleTrace('Expand work steps')
    expect(screen.getByText(trace.entries[0]).closest('li')).toHaveAttribute(
      'data-done',
      'true'
    )
    const unfinished = screen.getByText(trace.entries[1]).closest('li')
    expect(unfinished).toHaveAttribute('data-done', 'false')
    expect(unfinished?.querySelector('svg')).toBeNull()
  }
)

it('clears the live timer when its thought line unmounts', () => {
  const { unmount } = render(
    <AssistantThoughtLine {...trace} status="pending" entries={[]} />
  )
  expect(vi.getTimerCount()).toBe(1)
  advance(500)
  expect(screen.getByText('0.5s')).toBeVisible()
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
