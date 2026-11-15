import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import type { GitVersion, GitVersionGraph } from '@/lib/tauri-bindings'
import { CreationGitGraph } from './CreationGitGraph'

const version = (
  id: string,
  parents: string[],
  timestamp: number
): GitVersion => ({
  id,
  message: `Version ${id}`,
  parents,
  timestamp,
  author: 'Creator',
  files: [],
})
const graph: GitVersionGraph = {
  head: 'merge',
  branches: [
    { name: 'main', tip: 'merge' },
    { name: 'experiment', tip: 'fork' },
  ],
  versions: [
    version('merge', ['main', 'fork'], 4),
    version('main', ['root'], 3),
    version('fork', ['root'], 2),
    version('root', [], Number.MAX_VALUE),
  ],
  nextOffset: null,
  limited: false,
}
const defaults = () => ({
  graph,
  selected: 'merge',
  working: false,
  loading: false,
  busy: false,
  onChoose: vi.fn(),
  onMore: vi.fn(),
  scrollRef: createRef<HTMLDivElement>(),
})
afterEach(() => vi.restoreAllMocks())

it('previews both merge parents without changing saved positions or the current version', () => {
  const props = defaults()
  const scrollTo = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  })
  const { container, rerender } = render(<CreationGitGraph {...props} />)
  const saved = [
    ...container.querySelectorAll<HTMLButtonElement>('[data-git-version]'),
  ].map(node => ({
    id: node.dataset.gitVersion,
    x: node.style.insetInlineStart,
    y: node.style.insetBlockStart,
  }))
  rerender(
    <CreationGitGraph
      {...props}
      mergePreview={{ source: 'fork', target: 'merge' }}
    />
  )
  expect(
    container.querySelectorAll('.creation-merge-tree-preview path')
  ).toHaveLength(2)
  expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  for (const version of saved) {
    const node = container.querySelector<HTMLButtonElement>(
      `[data-git-version="${version.id}"]`
    )
    expect(node?.style.insetInlineStart).toBe(version.x)
    expect(node?.style.insetBlockStart).toBe(version.y)
  }
  expect(props.onChoose).not.toHaveBeenCalled()
  expect(scrollTo).toHaveBeenCalledOnce()
  rerender(<CreationGitGraph {...props} />)
  expect(container.querySelector('.creation-merge-tree-preview')).toBeNull()
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 0 })
})

it('places saved versions by timestamp while retaining real fork and merge edges', () => {
  const props = defaults()
  const { container } = render(<CreationGitGraph {...props} />)
  for (const commit of graph.versions) {
    const child = container.querySelector<HTMLButtonElement>(
      `[data-git-version="${commit.id}"]`
    )
    expect(child).not.toBeNull()
    for (const parent of commit.parents) {
      const parentNode = container.querySelector<HTMLButtonElement>(
        `[data-git-version="${parent}"]`
      )
      const parentVersion = graph.versions.find(
        version => version.id === parent
      )
      const parentX = parseFloat(parentNode?.style.insetInlineStart ?? '')
      const childX = parseFloat(child?.style.insetInlineStart ?? '')
      expect(parentVersion?.timestamp).not.toBe(commit.timestamp)
      if ((parentVersion?.timestamp ?? 0) < commit.timestamp)
        expect(parentX).toBeLessThan(childX)
      else expect(parentX).toBeGreaterThan(childX)
      expect(
        container.querySelector(
          `path[data-git-child="${commit.id}"][data-git-parent="${parent}"]`
        )
      ).toBeInTheDocument()
    }
  }
  const main = screen.getByRole('button', { name: /Version main/ })
  const fork = screen.getByRole('button', { name: /Version fork/ })
  expect(main.style.insetBlockStart).not.toBe(fork.style.insetBlockStart)
  expect(container.querySelectorAll('path')).toHaveLength(4)
  for (const path of container.querySelectorAll('path')) {
    const child = container.querySelector<HTMLButtonElement>(
      `[data-git-version="${path.getAttribute('data-git-child')}"]`
    )
    const childX = parseFloat(child?.style.insetInlineStart ?? '') + 52
    // Every edge arrives horizontally, including upward merges and reverse-time edges.
    expect(path.getAttribute('d')).toMatch(new RegExp(` H ${childX}$`))
  }
  expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  expect(container.querySelector('circle.current')).toHaveAttribute('r', '4')
  expect(container.querySelectorAll('circle.selected')).toHaveLength(1)
  expect(screen.queryByText('main')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Locate current|Collapse graph/ })
  ).not.toBeInTheDocument()
  expect(main.querySelector('time')).toHaveAttribute(
    'dateTime',
    new Date(3000).toISOString()
  )
  expect(
    screen.getByRole('button', { name: /Version root/ }).querySelector('time')
  ).toBeNull()
})

it('separates inspection from the current version and only draws real working changes', () => {
  const props = {
    ...defaults(),
    graph: {
      ...graph,
      versions: graph.versions.map(commit =>
        commit.id === 'root' ? { ...commit, timestamp: 1 } : commit
      ),
    },
  }
  const { container, rerender } = render(<CreationGitGraph {...props} />)
  const current = screen.getByRole('button', { name: /Version merge/ })
  fireEvent.click(screen.getByRole('button', { name: /Version fork/ }))
  expect(props.onChoose).toHaveBeenCalledWith('fork')
  expect(current).toHaveAttribute('aria-current', 'true')
  expect(current).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.queryByRole('button', { name: /Unrecorded changes/ })
  ).not.toBeInTheDocument()

  rerender(<CreationGitGraph {...props} working selected="working" />)
  const working = screen.getByRole('button', { name: /Unrecorded changes/ })
  expect(working).toHaveAttribute('aria-pressed', 'true')
  expect(working).not.toHaveAttribute('aria-current')
  expect(parseFloat(working.style.insetInlineStart)).toBe(
    parseFloat(current.style.insetInlineStart) + 112
  )
  expect(working.style.insetBlockStart).toBe(current.style.insetBlockStart)
  expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  expect(
    container.querySelector(
      'path[data-git-child="working"][data-git-parent="merge"]'
    )
  ).toHaveClass('pending')
  fireEvent.click(working)
  expect(props.onChoose).toHaveBeenLastCalledWith('working')

  rerender(<CreationGitGraph {...props} />)
  expect(
    screen.queryByRole('button', { name: /Unrecorded changes/ })
  ).not.toBeInTheDocument()
  expect(container.querySelector('path.pending')).toBeNull()
})

it('keeps older leaf checkouts on the time axis and forks working changes away from reused lanes', () => {
  const props = defaults()
  const historical: GitVersionGraph = {
    ...graph,
    head: 'newer',
    branches: [
      { name: 'old', tip: 'older' },
      { name: 'main', tip: 'newer' },
    ],
    versions: [
      version('newer', ['new-root'], 4),
      version('new-root', [], 3),
      version('older', ['old-root'], 2),
      version('old-root', [], 1),
    ],
  }
  const { container, rerender } = render(
    <CreationGitGraph {...props} graph={historical} selected="newer" />
  )
  const node = (id: string) =>
    container.querySelector<HTMLButtonElement>(`[data-git-version="${id}"]`)
  const savedPositions = historical.versions.map(commit => ({
    id: commit.id,
    x: node(commit.id)?.style.insetInlineStart,
    y: node(commit.id)?.style.insetBlockStart,
  }))
  const switched = { ...historical, head: 'older' }
  rerender(<CreationGitGraph {...props} graph={switched} selected="older" />)
  expect(parseFloat(node('older')?.style.insetInlineStart ?? '')).toBeLessThan(
    parseFloat(node('new-root')?.style.insetInlineStart ?? '')
  )
  expect(node('older')?.style.insetBlockStart).toBe(
    node('new-root')?.style.insetBlockStart
  )
  rerender(
    <CreationGitGraph {...props} graph={switched} selected="working" working />
  )
  expect(node('working')?.style.insetInlineStart).toBe(
    node('new-root')?.style.insetInlineStart
  )
  expect(node('working')?.style.insetBlockStart).not.toBe(
    node('new-root')?.style.insetBlockStart
  )
  for (const saved of savedPositions) {
    expect(node(saved.id)?.style.insetInlineStart).toBe(saved.x)
    expect(node(saved.id)?.style.insetBlockStart).toBe(saved.y)
  }
  expect(
    container.querySelector('path.pending[data-git-parent="older"]')
  ).toBeInTheDocument()
})

it('forks new working changes beside an older HEAD without extending or moving its descendants', () => {
  const props = defaults()
  const historical: GitVersionGraph = {
    ...graph,
    head: 'root',
    branches: [{ name: 'main', tip: 'tip' }],
    versions: [
      version('tip', ['child'], 3),
      version('child', ['root'], 2),
      version('root', [], 1),
    ],
  }
  const { container, rerender } = render(
    <CreationGitGraph {...props} graph={historical} selected="root" />
  )
  const node = (id: string) =>
    container.querySelector<HTMLButtonElement>(`[data-git-version="${id}"]`)
  const savedPositions = historical.versions.map(commit => ({
    id: commit.id,
    x: node(commit.id)?.style.insetInlineStart,
    y: node(commit.id)?.style.insetBlockStart,
  }))
  rerender(
    <CreationGitGraph
      {...props}
      graph={historical}
      selected="working"
      working
    />
  )
  for (const saved of savedPositions) {
    expect(node(saved.id)?.style.insetInlineStart).toBe(saved.x)
    expect(node(saved.id)?.style.insetBlockStart).toBe(saved.y)
  }
  expect(parseFloat(node('working')?.style.insetInlineStart ?? '')).toBe(
    parseFloat(node('root')?.style.insetInlineStart ?? '') + 112
  )
  expect(node('working')?.style.insetBlockStart).not.toBe(
    node('child')?.style.insetBlockStart
  )
  expect(
    container.querySelector('path.pending[data-git-parent="root"]')
  ).toBeInTheDocument()
  expect(
    container.querySelector('path.pending[data-git-parent="tip"]')
  ).toBeNull()
  rerender(
    <CreationGitGraph {...props} graph={historical} selected="tip" working />
  )
  expect(
    container.querySelector('path.pending[data-git-parent="root"]')
  ).toBeInTheDocument()
  expect(parseFloat(node('working')?.style.insetInlineStart ?? '')).toBe(
    parseFloat(node('root')?.style.insetInlineStart ?? '') + 112
  )
  rerender(<CreationGitGraph {...props} graph={historical} selected="root" />)
  expect(node('working')).toBeNull()
  for (const saved of savedPositions) {
    expect(node(saved.id)?.style.insetInlineStart).toBe(saved.x)
    expect(node(saved.id)?.style.insetBlockStart).toBe(saved.y)
  }
})

it('locates a new selection while preserving graph scroll during ordinary updates', () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
  const props = defaults()
  const { rerender } = render(<CreationGitGraph {...props} />)
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  scroll.mockClear()
  const viewport = props.scrollRef.current
  expect(viewport).not.toBeNull()
  if (!viewport) return
  viewport.scrollLeft = 120
  viewport.scrollTop = 10
  rerender(<CreationGitGraph {...props} graph={{ ...graph }} loading />)
  expect(scroll).not.toHaveBeenCalled()
  expect(viewport.scrollLeft).toBe(120)
  expect(viewport.scrollTop).toBe(10)
  rerender(<CreationGitGraph {...props} selected="fork" />)
  expect(scroll).toHaveBeenCalledTimes(1)
  expect(scroll.mock.contexts[0]).toBe(
    screen.getByRole('button', { name: /Version fork/ })
  )
})

it('keeps unloaded ancestry explicit and exposes bounded history pagination', () => {
  const props = defaults()
  const paged: GitVersionGraph = {
    ...graph,
    versions: [version('merge', ['not-loaded'], 1)],
    nextOffset: 60,
    limited: true,
  }
  const { container, rerender } = render(
    <CreationGitGraph {...props} graph={paged} />
  )
  expect(
    screen.getByLabelText('Earlier relationships not loaded')
  ).toBeInTheDocument()
  expect(
    container.querySelector('path[data-git-parent="not-loaded"]')
  ).toBeNull()
  expect(
    screen.getByLabelText(/1,200-commit browsing limit/)
  ).toBeInTheDocument()
  const more = screen.getByRole('button', { name: 'Load earlier versions' })
  fireEvent.click(more)
  expect(props.onMore).toHaveBeenCalledTimes(1)
  rerender(<CreationGitGraph {...props} graph={paged} loading />)
  expect(more).toBeDisabled()
  rerender(<CreationGitGraph {...props} graph={paged} busy />)
  expect(more).toBeDisabled()
})
