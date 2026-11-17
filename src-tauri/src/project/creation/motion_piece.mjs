// Authored composition used by the public chat-task test; never a Blank default.
import { createPerformance as createInput } from './state.js'
import deviceMotion from '../modules/pnds-device-motion/device-motion.js'
const { normalizeMotion } = deviceMotion

export function createPerformance({ publish }) {
  const input = createInput({ publish: () => changed() })
  const motion = new Map()
  const copy = value => JSON.parse(JSON.stringify(value))
  const snapshot = () => ({
    ...input.snapshot(),
    motion: [...motion].map(([id, value]) => ({ id, ...copy(value) })),
  })
  const changed = () => publish(snapshot())
  function applySample(id, sample) {
    const value = motion.get(id) ?? { signals: {}, rotation: { x: 0, y: 0 } }
    value.signals[sample.kind] = sample
    if (sample.kind === 'tilt') {
      if (sample.value.beta !== null) value.rotation.x = sample.value.beta
      if (sample.value.gamma !== null) value.rotation.y = sample.value.gamma
    }
    if (sample.kind === 'acceleration') {
      // This test work deliberately maps acceleration X to Y rotation.
      if (sample.value.x !== null) value.rotation.y = sample.value.x * 10
    }
    motion.set(id, value)
  }
  function restoreWork(saved, members, { liveIds, currentState }) {
    if (!Array.isArray(saved.motion))
      throw new Error('Invalid recorded motion state')
    const recorded = new Set(members.map(member => member.id))
    const live = new Set(liveIds)
    const restored = new Map()
    for (const [entries, allowed, prefix] of [
      [saved.motion, recorded, 'replay:'],
      [currentState.motion ?? [], live, ''],
    ]) {
      for (const entry of entries) {
        if (!allowed.has(entry.id)) continue
        if (
          restored.has(prefix + entry.id) ||
          !entry.signals ||
          !entry.rotation ||
          !Number.isFinite(entry.rotation.x) ||
          !Number.isFinite(entry.rotation.y)
        )
          throw new Error('Invalid recorded motion source')
        for (const [kind, sample] of Object.entries(entry.signals)) {
          if (normalizeMotion(sample)?.kind !== kind)
            throw new Error('Invalid recorded motion feature')
        }
        restored.set(
          prefix + entry.id,
          copy({ signals: entry.signals, rotation: entry.rotation })
        )
      }
    }
    motion.clear()
    for (const [id, value] of restored) motion.set(id, value)
    changed()
  }
  return {
    ...input,
    snapshot,
    prepareAction: normalizeMotion,
    applyWork(event) {
      if (event.kind === 'action') {
        const sample = normalizeMotion(event.payload)
        if (!sample) throw new Error('Invalid recorded motion action')
        applySample(event.sourceId, sample)
        changed()
      } else if (event.kind === 'leave' || event.kind === 'release') {
        motion.delete(event.sourceId)
        changed()
      }
    },
    restoreWork,
    releaseWork() {
      motion.clear()
      changed()
    },
  }
}
