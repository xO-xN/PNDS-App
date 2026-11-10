// Editable score mapping. Admission, claim ownership and capture belong to the existing project channel.
function createHandPoseWork({ publish = () => {} } = {}) {
  const sources = new Map()
  const clone = value => JSON.parse(JSON.stringify(value))
  function prepareAction(payload) {
    if (!payload || payload.kind !== 'camera-handpose' || Object.keys(payload).some(key => !['kind', 'hands', 'actions'].includes(key)) || !Array.isArray(payload.hands) || payload.hands.length > 2 || !Array.isArray(payload.actions) || payload.actions.length > 8) return null
    for (const hand of payload.hands) {
      if (!hand || !Array.isArray(hand.keypoints) || hand.keypoints.length !== 21 || typeof hand.pinch !== 'boolean' || typeof hand.open !== 'boolean' || (hand.pinch && hand.open) || !['Left', 'Right', 'Unknown'].includes(hand.handedness) || Object.keys(hand).some(key => !['keypoints', 'pinch', 'open', 'handedness'].includes(key))) return null
      for (const point of hand.keypoints) if (!point || Object.keys(point).some(key => !['x', 'y', 'z'].includes(key)) || ![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 10) || (point.z !== null && (!Number.isFinite(point.z) || Math.abs(point.z) > 10))) return null
    }
    for (const action of payload.actions) if (!action || Object.keys(action).some(key => !['hand', 'type'].includes(key)) || !Number.isInteger(action.hand) || action.hand < 0 || action.hand > 1 || !['pinch-start', 'pinch-end', 'open-start', 'open-end'].includes(action.type)) return null
    return clone(payload)
  }
  function snapshotWork() {
    return { cameraSources: [...sources].map(([sourceId, sample]) => ({ sourceId, sample: clone(sample), markers: sample.hands.map(hand => ({ x: hand.keypoints[0].x, y: hand.keypoints[0].y, color: hand.pinch ? 'pinch' : hand.open ? 'open' : 'neutral' })) })) }
  }
  const changed = () => publish(snapshotWork())
  function applyWork(event) {
    if (event.kind === 'action') {
      const sample = prepareAction(event.payload)
      if (!sample || typeof event.sourceId !== 'string' || !event.sourceId) throw new Error('Invalid camera work event')
      sources.set(event.sourceId, sample)
      changed()
    } else if (['leave', 'release'].includes(event.kind)) { sources.delete(event.sourceId); changed() }
  }
  function restoreWork(saved, members, { liveIds = [], currentState = null } = {}) {
    if (!Array.isArray(saved.cameraSources) || !Array.isArray(members)) throw new Error('Invalid camera work snapshot')
    const restored = new Map()
    const allowed = new Set(members.map(member => member.id))
    for (const value of saved.cameraSources) {
      if (!allowed.has(value.sourceId)) continue
      const sample = prepareAction(value.sample)
      if (!sample || restored.has(`replay:${value.sourceId}`)) throw new Error('Invalid recorded camera state')
      restored.set(`replay:${value.sourceId}`, sample)
    }
    for (const value of currentState?.cameraSources ?? []) {
      if (!liveIds.includes(value.sourceId)) continue
      const sample = prepareAction(value.sample)
      if (!sample) throw new Error('Invalid live camera state')
      restored.set(value.sourceId, sample)
    }
    sources.clear()
    for (const [source, sample] of restored) sources.set(source, sample)
    changed()
  }
  return { prepareAction, applyWork, snapshotWork, restoreWork, releaseWork() { sources.clear(); changed() } }
}
module.exports = { createHandPoseWork }
