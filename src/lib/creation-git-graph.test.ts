import { expect, it } from 'vitest'
import { gitVersionEdgePath, layoutGitVersions } from './creation-git-graph'
import type { GitVersion, GitVersionGraph } from './tauri-bindings'
const v = (id: string, parents: string[], timestamp = 1): GitVersion => ({
  id,
  parents,
  timestamp,
  message: id,
  author: 'Creator',
  files: [],
})

it('keeps an older checked-out leaf before newer versions without moving saved coordinates', () => {
  const graph: GitVersionGraph = {
    head: 'older',
    branches: [
      { name: 'old', tip: 'older' },
      { name: 'main', tip: 'newer' },
    ],
    versions: [
      { ...v('older', ['root']), timestamp: 1 },
      { ...v('newer', ['middle']), timestamp: 3 },
      { ...v('middle', ['root']), timestamp: 2 },
      { ...v('root', []), timestamp: 0 },
    ],
    nextOffset: null,
    limited: false,
  }
  const older = layoutGitVersions(graph)
  expect(older.order).toEqual(['newer', 'middle', 'older', 'root'])
  const newer = layoutGitVersions({
    ...graph,
    head: 'newer',
    versions: [...graph.versions].reverse(),
  })
  expect(newer.order).toEqual(older.order)
  for (const version of graph.versions)
    expect(newer.positions.get(version.id)).toEqual(
      older.positions.get(version.id)
    )
})

it('orders saved columns by timestamp even when a parent clock is ahead of its children', () => {
  const graph: GitVersionGraph = {
    head: 'child',
    branches: [],
    versions: [
      { ...v('parent', []), timestamp: 30 },
      { ...v('child', ['parent']), timestamp: 10 },
      { ...v('sibling', ['parent']), timestamp: 20 },
    ],
    nextOffset: null,
    limited: false,
  }
  const result = layoutGitVersions(graph)
  expect(result.order).toEqual(['parent', 'sibling', 'child'])
  expect(result.positions.get('parent')?.y).toBeLessThan(
    result.positions.get('child')?.y ?? 0
  )
})

it('breaks equal timestamp ties by identifier independently of HEAD and input order', () => {
  const graph: GitVersionGraph = {
    head: 'b',
    branches: [],
    versions: [v('b', []), v('a', [])],
    nextOffset: null,
    limited: false,
  }
  expect(layoutGitVersions(graph).order).toEqual(['a', 'b'])
  expect(
    layoutGitVersions({
      ...graph,
      head: 'a',
      versions: [...graph.versions].reverse(),
    }).order
  ).toEqual(['a', 'b'])
})
it('lays out real forks and merges without treating time order as ancestry', () => {
  const graph: GitVersionGraph = {
    head: 'd',
    branches: [
      { name: 'main', tip: 'c' },
      { name: 'try', tip: 'd' },
    ],
    versions: [
      v('d', ['a'], 4),
      v('c', ['b'], 3),
      v('b', ['a'], 2),
      v('a', [], 1),
    ],
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
    versions: [v('e', ['c', 'd'], 5), ...graph.versions],
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

it('keeps a long linear history at one lane with HEAD before its parents', () => {
  const versions = Array.from({ length: 1200 }, (_, index) => ({
    ...v(String(index), index ? [String(index - 1)] : []),
    timestamp: index,
  }))
  const graph = {
    head: '1199',
    branches: [],
    versions,
    nextOffset: null,
    limited: false,
  }
  const result = layoutGitVersions(graph)
  expect(result.order.slice(0, 3)).toEqual(['1199', '1198', '1197'])
  expect(result.width).toBe(32)
  expect(result.positions.get('0')?.y).toBeGreaterThan(
    result.positions.get('1199')?.y ?? 0
  )
  expect(result.positions.size).toBe(1200)
})

interface Point {
  x: number
  y: number
}

// Sample the rendered SVG, independently of the helper's control-point arithmetic.
function sampleEdge(path: string): Point[] {
  const tokens = path.match(/[A-Z]|-?\d*\.?\d+(?:e[+-]?\d+)?/g) ?? [],
    points: Point[] = []
  let cursor = 0,
    current = { x: 0, y: 0 }
  const number = () => Number(tokens[cursor++])
  while (cursor < tokens.length) {
    const command = tokens[cursor++]
    if (command === 'M') {
      current = { x: number(), y: number() }
      points.push(current)
      continue
    }
    const start = current
    if (command === 'H' || command === 'V') {
      const end =
        command === 'H'
          ? { x: number(), y: current.y }
          : { x: current.x, y: number() }
      for (let step = 1; step <= 80; step++) {
        const t = step / 80
        points.push({
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
        })
      }
      current = end
    } else if (command === 'C') {
      const first = { x: number(), y: number() },
        second = { x: number(), y: number() },
        end = { x: number(), y: number() }
      for (let step = 1; step <= 80; step++) {
        const t = step / 80,
          remaining = 1 - t
        points.push({
          x:
            remaining ** 3 * start.x +
            3 * remaining ** 2 * t * first.x +
            3 * remaining * t ** 2 * second.x +
            t ** 3 * end.x,
          y:
            remaining ** 3 * start.y +
            3 * remaining ** 2 * t * first.y +
            3 * remaining * t ** 2 * second.y +
            t ** 3 * end.y,
        })
      }
      current = end
    } else throw new Error(`Unexpected SVG command: ${command}`)
  }
  return points
}

it('keeps a distant merge branch clear of intermediate and destination labels', () => {
  const source = { x: 288, y: 64 },
    current = { x: 512, y: 20 },
    merged = { x: 624, y: 20 },
    labels = [source, { x: 400, y: 20 }, current, merged]
  for (const parent of [source, current]) {
    const points = sampleEdge(gitVersionEdgePath(parent, merged))
    expect(points[0]).toEqual(parent)
    expect(points.at(-1)).toEqual(merged)
    for (const point of points) {
      // Fixed 104px names and their following dates, including half the stroke.
      expect(
        labels.some(
          label =>
            point.x >= label.x - 52.75 &&
            point.x <= label.x + 52.75 &&
            point.y >= label.y + 6.25 &&
            point.y <= label.y + 39.75
        )
      ).toBe(false)
      if (point.x < merged.x - 112) expect(point.y).toBe(parent.y)
    }
  }
})

it('mirrors the same bounded turn for reverse-time and upward or downward edges', () => {
  const from = { x: 288, y: 64 },
    child = { x: 624, y: 20 },
    forward = sampleEdge(gitVersionEdgePath(from, child)),
    backward = sampleEdge(
      gitVersionEdgePath({ x: 624, y: 64 }, { x: 288, y: 20 })
    ),
    downward = sampleEdge(
      gitVersionEdgePath({ x: 288, y: 20 }, { x: 624, y: 64 })
    )
  forward.forEach((point, index) => {
    expect(backward[index]?.x).toBeCloseTo(from.x + child.x - point.x)
    expect(backward[index]?.y).toBeCloseTo(point.y)
    expect(downward[index]?.x).toBeCloseTo(point.x)
    expect(downward[index]?.y).toBeCloseTo(from.y + child.y - point.y)
  })
  for (const points of [forward, backward, downward])
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(from.x)
      expect(point.x).toBeLessThanOrEqual(child.x)
      expect(point.y).toBeGreaterThanOrEqual(child.y)
      expect(point.y).toBeLessThanOrEqual(from.y)
    }
})

it('bounds the turn inside short edges and leaves a level track straight', () => {
  expect(gitVersionEdgePath({ x: 0, y: 20 }, { x: 112, y: 20 })).toBe(
    'M 0 20 H 112'
  )
  for (const point of sampleEdge(
    gitVersionEdgePath({ x: 0, y: 44 }, { x: 24, y: 0 })
  )) {
    expect(point.x).toBeGreaterThanOrEqual(0)
    expect(point.x).toBeLessThanOrEqual(24)
    expect(point.y).toBeGreaterThanOrEqual(0)
    expect(point.y).toBeLessThanOrEqual(44)
  }
})

it('routes a prospective two-parent merge exactly as the resulting saved node', () => {
  const graph: GitVersionGraph = {
    head: 'main',
    branches: [],
    versions: [
      v('main', ['middle'], 4),
      v('middle', ['root'], 3),
      v('fork', ['root'], 2),
      v('root', [], 1),
    ],
    nextOffset: null,
    limited: false,
  }
  const before = layoutGitVersions(graph),
    after = layoutGitVersions({
      ...graph,
      head: 'merge',
      versions: [v('merge', ['main', 'fork'], 5), ...graph.versions],
    }),
    point = (layout: typeof before, id: string) => ({
      x: 64 + (layout.order.length - 1 - layout.order.indexOf(id)) * 112,
      y: 20 + (layout.positions.get(id)?.lane ?? 0) * 44,
    }),
    preview = {
      x: 64 + before.order.length * 112,
      y: point(before, graph.head ?? '').y,
    }
  for (const parent of ['main', 'fork'])
    expect(gitVersionEdgePath(point(before, parent), preview)).toBe(
      gitVersionEdgePath(point(after, parent), point(after, 'merge'))
    )
  expect(before.order).toEqual(['main', 'middle', 'fork', 'root'])
  expect(after.order).toEqual(['merge', ...before.order])
})
