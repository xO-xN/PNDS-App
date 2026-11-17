// The piece's common input application. Live input and replay use this state.
const fields = [
  'kind',
  'id',
  'phase',
  'pointerType',
  'x',
  'y',
  'width',
  'height',
  'nx',
  'ny',
]
const clamp = value => Math.max(0, Math.min(1, value))
export function createPerformance({
  publish = () => {
    /* Snapshot subscribers are optional; state application is independent. */
  },
} = {}) {
  const performers = new Map()
  function snapshot() {
    return {
      performers: [...performers].map(([id, contacts]) => ({
        id,
        contacts: [...contacts.values()].map(contact => ({ ...contact })),
      })),
    }
  }
  function prepareInput(performerId, payload) {
    if (
      typeof performerId !== 'string' ||
      !performerId ||
      performerId.length > 256 ||
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.keys(payload).some(key => !fields.includes(key)) ||
      payload.kind !== 'contact' ||
      typeof payload.id !== 'string' ||
      !/^[a-zA-Z0-9:._-]{1,128}$/.test(payload.id) ||
      !['start', 'move', 'end', 'cancel'].includes(payload.phase) ||
      !['mouse', 'touch', 'pen'].includes(payload.pointerType) ||
      !['x', 'y', 'width', 'height', 'nx', 'ny'].every(key =>
        Number.isFinite(payload[key])
      ) ||
      payload.width <= 0 ||
      payload.height <= 0 ||
      payload.width > 100000 ||
      payload.height > 100000 ||
      Math.abs(payload.x) > 1000000 ||
      Math.abs(payload.y) > 1000000 ||
      Math.abs(payload.nx - clamp(payload.x / payload.width)) > 1e-9 ||
      Math.abs(payload.ny - clamp(payload.y / payload.height)) > 1e-9
    )
      return null
    const contacts = performers.get(performerId)
    const current = contacts?.get(payload.id)
    if (payload.phase === 'start') {
      if (
        current ||
        (contacts?.size ?? 0) >= 64 ||
        (payload.pointerType === 'mouse' &&
          [...(contacts?.values() ?? [])].some(
            contact => contact.pointerType === 'mouse'
          ))
      )
        return null
    } else if (!current || current.pointerType !== payload.pointerType)
      return null
    return Object.fromEntries(fields.map(key => [key, payload[key]]))
  }
  function applyEvent(performerId, payload) {
    const event = prepareInput(performerId, payload)
    if (!event) return false
    const contacts = performers.get(performerId) ?? new Map()
    if (event.phase === 'end' || event.phase === 'cancel')
      contacts.delete(event.id)
    else {
      const { kind: _kind, phase: _phase, ...contact } = event
      contacts.set(event.id, contact)
    }
    if (contacts.size) performers.set(performerId, contacts)
    else performers.delete(performerId)
    publish(snapshot())
    return true
  }
  function release(performerId) {
    if (!performers.delete(performerId)) return false
    publish(snapshot())
    return true
  }
  return {
    prepareInput,
    applyEvent,
    release,
    snapshot,
    // Keep contact ownership readable even when an author's richer snapshot fails.
    snapshotInput: snapshot,
  }
}
