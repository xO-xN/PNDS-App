import { expect, it } from 'vitest'
import { layoutGitVersions } from './creation-git-graph'
import type { GitVersion, GitVersionGraph } from './tauri-bindings'
const v = (id: string, parents: string[]): GitVersion => ({
  id,
  parents,
  timestamp: 1,
  message: id,
  files: [],
})
it('lays out real forks and merges without treating time order as ancestry', () => {
  const graph: GitVersionGraph = {
    head: 'd',
    branches: [
      { name: 'main', tip: 'c' },
      { name: 'try', tip: 'd' },
    ],
    versions: [v('d', ['a']), v('c', ['b']), v('b', ['a']), v('a', [])],
    nextOffset: null,
    limited: false,
  }
  const result = layoutGitVersions(graph)
  expect(result.positions.get('d')?.y).toBeLessThan(
    result.positions.get('a')?.y ?? 0
  )
  expect(result.positions.get('d')?.lane).not.toBe(
    result.positions.get('b')?.lane
  )
  const merged = layoutGitVersions({
    ...graph,
    head: 'e',
    versions: [v('e', ['c', 'd']), ...graph.versions],
  })
  for (const version of [v('e', ['c', 'd']), ...graph.versions]) {
    for (const parent of version.parents)
      expect(merged.positions.get(version.id)?.y).toBeLessThan(
        merged.positions.get(parent)?.y ?? 0
      )
  }
})
it('keeps paged missing ancestry as a boundary rather than inventing an edge', () => {
  const result = layoutGitVersions({
    head: 'c',
    branches: [],
    versions: [v('c', ['not-loaded'])],
    nextOffset: 60,
    limited: false,
  })
  expect(result.positions.has('not-loaded')).toBe(false)
  expect(result.positions.get('c')?.x).toBe(16)
  expect(result.order).toEqual(['c'])
})

it('keeps a long linear history at one lane and puts saved changes above HEAD', () => {
  const versions = Array.from({ length: 1200 }, (_, index) => ({
    ...v(String(index), index ? [String(index - 1)] : []),
    timestamp: 1200 - index,
  }))
  const graph = {
    head: '1199',
    branches: [],
    versions,
    nextOffset: null,
    limited: false,
  }
  const result = layoutGitVersions(graph, true)
  expect(result.order.slice(0, 3)).toEqual(['working', '1199', '1198'])
  expect(result.width).toBe(32)
  expect(result.positions.get('0')?.y).toBeGreaterThan(
    result.positions.get('1199')?.y ?? 0
  )
  expect(result.positions.size).toBe(1201)
})
