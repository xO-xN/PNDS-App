import { createRef } from 'react'
import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { CreationGitGraph } from './CreationGitGraph'

it('keeps row names readable without a legend or zoom and inspects real fork nodes', () => {
  const choose = vi.fn()
  render(
    <CreationGitGraph
      graph={{
        head: 'b',
        branches: [{ name: 'main', tip: 'b' }],
        versions: [
          {
            id: 'b',
            message: 'Deepseek start',
            parents: ['a'],
            timestamp: 2,
            files: [],
          },
          {
            id: 'a',
            message: 'Initial project',
            parents: [],
            timestamp: Number.MAX_VALUE,
            files: [],
          },
        ],
        nextOffset: null,
        limited: false,
      }}
      selected="b"
      working
      loading={false}
      busy={false}
      collapsed={false}
      onCollapsedChange={vi.fn()}
      onChoose={choose}
      onMore={vi.fn()}
      scrollRef={createRef<HTMLDivElement>()}
    />
  )
  const version = screen.getByRole('button', { name: /Deepseek start/ })
  expect(version).toHaveAttribute('aria-current', 'true')
  expect(version).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: /Initial project/ }))
  expect(choose).toHaveBeenCalledWith('a')
  fireEvent.click(screen.getByRole('button', { name: /Unrecorded changes/ }))
  expect(choose).toHaveBeenCalledWith('working')
  expect(screen.queryByText(/Filled dot/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /100%/ })).not.toBeInTheDocument()
})
