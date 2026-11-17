// Author-saved test composition. This file is never a default Blank asset.
export function createPiece({
  publish = () => {
    /* Consumers can also inspect the actual work snapshot explicitly. */
  },
} = {}) {
  const voices = new Map()
  const selections = new Map()
  let positionMs = 0,
    playing = false,
    anchorAt = globalThis.performance.now(),
    clock = 'live',
    replayAt = 0,
    releaseFailureArmed = false
  const now = () => (clock === 'live' ? globalThis.performance.now() : replayAt)
  const positionAt = at =>
    positionMs + (playing ? Math.max(0, at - anchorAt) : 0)
  const validPosition = value => Number.isFinite(value) && value >= 0
  const validSource = value => typeof value === 'string' && value.length > 0
  function snapshot() {
    return {
      transport: { positionMs: positionAt(now()), playing },
      releaseFailureArmed,
      voices: [...voices].flatMap(([sourceId, contacts]) =>
        [...contacts].map(([contactId, gain]) => ({
          sourceId,
          contactId,
          gain,
        }))
      ),
      selections: [...selections].map(([sourceId, value]) => ({
        sourceId,
        value,
      })),
    }
  }
  const changed = () => publish(snapshot())
  function prepareConductor(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return null
    if (
      ['play', 'pause'].includes(payload.kind) &&
      Object.keys(payload).every(key => key === 'kind')
    )
      return { kind: payload.kind }
    if (
      payload.kind === 'seek' &&
      validPosition(payload.positionMs) &&
      Object.keys(payload).every(key => ['kind', 'positionMs'].includes(key))
    )
      return { kind: 'seek', positionMs: payload.positionMs }
    return null
  }
  function prepareAction(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return null
    if (
      payload.kind === 'selection' &&
      Number.isInteger(payload.value) &&
      payload.value >= 1 &&
      payload.value <= 9 &&
      Object.keys(payload).every(key => ['kind', 'value'].includes(key))
    )
      return { kind: 'selection', value: payload.value }
    if (
      ['fail', 'arm-release-failure'].includes(payload.kind) &&
      Object.keys(payload).every(key => key === 'kind')
    )
      return { kind: payload.kind }
    return null
  }
  function restore(saved, members, { liveIds = [], current = null } = {}) {
    if (
      !saved ||
      !validPosition(saved.transport?.positionMs) ||
      typeof saved.transport?.playing !== 'boolean' ||
      !Array.isArray(saved.selections) ||
      !Array.isArray(members)
    )
      throw new Error('Invalid authored recording state')
    const allowed = new Set()
    for (const member of members) {
      if (!validSource(member?.id) || allowed.has(member.id))
        throw new Error('Invalid authored recorded member')
      allowed.add(member.id)
    }
    const restored = new Map()
    for (const selection of saved.selections) {
      if (!allowed.has(selection?.sourceId)) continue
      const value = prepareAction({ kind: 'selection', value: selection.value })
      if (!value || restored.has(`replay:${selection.sourceId}`))
        throw new Error('Invalid authored recorded selection')
      restored.set(`replay:${selection.sourceId}`, value.value)
    }
    const currentLive = new Set(liveIds)
    if (current !== null) {
      if (!Array.isArray(current?.selections))
        throw new Error('Invalid authored live selection state')
      for (const selection of current.selections) {
        if (!currentLive.has(selection?.sourceId)) continue
        const value = prepareAction({
          kind: 'selection',
          value: selection.value,
        })
        if (!value || restored.has(selection.sourceId))
          throw new Error('Invalid authored live selection')
        restored.set(selection.sourceId, value.value)
      }
    }
    // Held effects are rebuilt by the same input application after restore;
    // the recorded snapshot itself cannot bypass native pass membership.
    voices.clear()
    selections.clear()
    for (const [sourceId, value] of restored) selections.set(sourceId, value)
    positionMs = saved.transport.positionMs
    playing = saved.transport.playing
    anchorAt = 0
    replayAt = 0
    clock = 'replay'
    releaseFailureArmed = saved.releaseFailureArmed === true
    changed()
  }
  function eventTime(event) {
    if (event.atMs === null) return null
    if (
      !Number.isSafeInteger(event.atMs) ||
      event.atMs < 0 ||
      (clock === 'replay' && event.atMs < replayAt)
    )
      throw new Error('Invalid authored event time')
    replayAt = event.atMs
    return event.atMs
  }
  function apply(event) {
    if (!event || typeof event !== 'object')
      throw new Error('Invalid authored event')
    const atMs = eventTime(event)
    if (event.kind === 'conductor') {
      const command = prepareConductor(event.payload)
      if (!command || event.sourceId !== null)
        throw new Error('Invalid authored conductor change')
      const at = atMs ?? globalThis.performance.now()
      const current = positionAt(
        clock === 'live' ? globalThis.performance.now() : at
      )
      positionMs = command.kind === 'seek' ? command.positionMs : current
      playing =
        command.kind === 'play'
          ? true
          : command.kind === 'pause'
            ? false
            : playing
      anchorAt = at
      clock = atMs === null ? 'live' : 'replay'
    } else {
      if (!validSource(event.sourceId))
        throw new Error('Invalid authored performer')
      if (event.kind === 'input') {
        const contact = event.payload
        if (
          contact?.kind !== 'contact' ||
          typeof contact.id !== 'string' ||
          !contact.id ||
          !['start', 'move', 'end', 'cancel'].includes(contact.phase) ||
          !Number.isFinite(contact.nx) ||
          contact.nx < 0 ||
          contact.nx > 1
        )
          throw new Error('Invalid authored contact')
        const contacts = voices.get(event.sourceId) ?? new Map()
        if (
          (contact.phase === 'start' && contacts.has(contact.id)) ||
          (contact.phase !== 'start' && !contacts.has(contact.id))
        )
          throw new Error('Invalid authored contact lifecycle')
        if (contact.phase === 'end' || contact.phase === 'cancel')
          contacts.delete(contact.id)
        else contacts.set(contact.id, contact.nx)
        if (contacts.size) voices.set(event.sourceId, contacts)
        else voices.delete(event.sourceId)
      } else if (event.kind === 'action') {
        const action = prepareAction(event.payload)
        if (!action) throw new Error('Invalid authored action')
        if (action.kind === 'fail') throw new Error('Authored work failure')
        if (action.kind === 'arm-release-failure') releaseFailureArmed = true
        else selections.set(event.sourceId, action.value)
      } else if (event.kind === 'join' || event.kind === 'selection') {
        // Metadata changes membership/choice only; it never replays a musical
        // action or recreates a voice already applied through the input path.
        const value =
          event.kind === 'join' ? event.payload?.selection : event.payload
        if (value === null) selections.delete(event.sourceId)
        else {
          const selection = prepareAction({ kind: 'selection', value })
          if (!selection) throw new Error('Invalid authored selection metadata')
          selections.set(event.sourceId, selection.value)
        }
      } else if (event.kind === 'leave' || event.kind === 'release') {
        voices.delete(event.sourceId)
        if (event.kind === 'leave') selections.delete(event.sourceId)
      } else throw new Error('Unknown authored event')
    }
    changed()
  }
  function release() {
    const failAfterRelease = releaseFailureArmed
    releaseFailureArmed = false
    positionMs = positionAt(now())
    playing = false
    anchorAt = globalThis.performance.now()
    clock = 'live'
    voices.clear()
    changed()
    if (failAfterRelease) throw new Error('Authored release failure')
  }
  function advance(elapsedMs) {
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs < replayAt)
      throw new Error('Invalid authored advance')
    replayAt = elapsedMs
    changed()
  }
  return {
    snapshot,
    restore,
    apply,
    release,
    advance,
    prepareConductor,
    prepareAction,
    selectionFor: sourceId => selections.get(sourceId) ?? null,
  }
}
