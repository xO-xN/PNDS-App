import type { GitVersionGraph } from './tauri-bindings'

/** Keep long parent tracks level; change lanes only in the final column gap. */
export function gitVersionEdgePath(
  from: { x: number; y: number },
  child: { x: number; y: number }
): string {
  if (child.y === from.y) return `M ${from.x} ${from.y} H ${child.x}`
  const dx = child.x - from.x,
    directionX = Math.sign(dx),
    directionY = Math.sign(child.y - from.y),
    bend = child.x - directionX * Math.min(56, Math.abs(dx) / 2),
    radius = Math.min(14, Math.abs(child.y - from.y) / 2, Math.abs(dx) / 4),
    handle = (radius * 2) / 3,
    start = bend - directionX * radius,
    end = bend + directionX * radius
  return `M ${from.x} ${from.y} H ${start} C ${start + directionX * handle} ${from.y} ${bend} ${from.y + directionY * (radius - handle)} ${bend} ${from.y + directionY * radius} V ${child.y - directionY * radius} C ${bend} ${child.y - directionY * (radius - handle)} ${end - directionX * handle} ${child.y} ${end} ${child.y} H ${child.x}`
}

/** Real ancestry assigns lanes; recorded time assigns columns, independently of HEAD. */
export function layoutGitVersions(graph: GitVersionGraph) {
  const versions = new Map(graph.versions.map(version => [version.id, version]))
  const childCounts = new Map([...versions.keys()].map(id => [id, 0]))
  for (const version of versions.values())
    for (const parent of version.parents)
      if (versions.has(parent))
        childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1)
  const compare = (a: string, b: string) =>
    (versions.get(b)?.timestamp ?? 0) - (versions.get(a)?.timestamp ?? 0) ||
    a.localeCompare(b)
  const order = [...versions.keys()].sort(compare)
  const rows = new Map(order.map((id, row) => [id, row]))
  const ready = [...childCounts]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
  const topology: string[] = []
  while (ready.length) {
    ready.sort(compare)
    const id = ready.shift()
    if (!id) break
    topology.push(id)
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
  topology.forEach(id => {
    let lane = lanes.indexOf(id)
    if (lane < 0) {
      lane = lanes.indexOf(null)
      if (lane < 0) lane = lanes.length
    }
    positions.set(id, {
      x: 16 + lane * 18,
      y: 16 + (rows.get(id) ?? 0) * 32,
      lane,
    })
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
