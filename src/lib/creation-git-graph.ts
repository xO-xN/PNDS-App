import type { GitVersionGraph } from './tauri-bindings'

/** A topological log keeps every child above its parents, independent of clock skew. */
export function layoutGitVersions(graph: GitVersionGraph, working = false) {
  const versions = new Map(graph.versions.map(version => [version.id, version]))
  if (working && graph.head)
    versions.set('working', {
      id: 'working',
      parents: [graph.head],
      timestamp: Number.MAX_SAFE_INTEGER,
      message: '',
      files: [],
    })
  const childCounts = new Map([...versions.keys()].map(id => [id, 0]))
  for (const version of versions.values())
    for (const parent of version.parents)
      if (versions.has(parent))
        childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1)
  const compare = (a: string, b: string) =>
    Number(b === 'working') - Number(a === 'working') ||
    Number(b === graph.head) - Number(a === graph.head) ||
    (versions.get(b)?.timestamp ?? 0) - (versions.get(a)?.timestamp ?? 0) ||
    a.localeCompare(b)
  const ready = [...childCounts]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
  const order: string[] = []
  while (ready.length) {
    ready.sort(compare)
    const id = ready.shift()
    if (!id) break
    order.push(id)
    for (const parent of versions.get(id)?.parents ?? []) {
      if (!childCounts.has(parent)) continue
      const count = (childCounts.get(parent) ?? 0) - 1
      childCounts.set(parent, count)
      if (!count) ready.push(parent)
    }
  }
  const positions = new Map<string, { x: number; y: number; lane: number }>()
  const lanes: (string | null)[] = []
  let maximumLane = 0
  order.forEach((id, row) => {
    let lane = lanes.indexOf(id)
    if (lane < 0) {
      lane = lanes.indexOf(null)
      if (lane < 0) lane = lanes.length
    }
    positions.set(id, { x: 16 + lane * 18, y: 16 + row * 32, lane })
    maximumLane = Math.max(maximumLane, lane)
    lanes[lane] = null
    for (const parent of versions.get(id)?.parents ?? []) {
      if (!versions.has(parent) || lanes.includes(parent)) continue
      let slot = lanes.indexOf(null)
      if (slot < 0) slot = lanes.length
      lanes[slot] = parent
      maximumLane = Math.max(maximumLane, slot)
    }
    while (lanes.at(-1) === null) lanes.pop()
  })
  return {
    positions,
    order,
    width: 32 + maximumLane * 18,
    height: order.length * 32,
  }
}
