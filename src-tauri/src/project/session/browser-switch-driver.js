/* global document, setTimeout, window, location, KeyboardEvent */
globalThis.verifyBrowserEntry = async function () {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const wait = async (predicate, timeout = 20000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const value = await predicate()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error(
      'Timed out waiting for switch: ' +
        document.querySelector('[data-pnds-status]')?.textContent
    )
  }
  const phase = name =>
    window.webkit.messageHandlers.result.postMessage({ phase: name })
  const panel = () => document.querySelector('[data-pnds-entry]')
  const strings = JSON.parse(
    document.querySelector('#pnds-entry-context').textContent
  ).strings
  const submit = () => {
    const form = document.querySelector('form')
    form.querySelector('button').focus()
    form.requestSubmit()
  }
  submit()
  const first = await wait(() =>
    document.querySelector('iframe[data-pnds-current]')
  )
  const oldView = first.contentWindow
  const oldDocument = oldView.document
  const oldToken = oldView.documentToken
  const oldTimeOrigin = oldView.performance.timeOrigin
  const oldState = oldView.scoreState
  const firstPerformance = oldView.PNDS_PARTICIPATION.performanceId
  const retained = () => {
    assert(
      first.contentWindow.document === oldDocument &&
        oldView.documentToken === oldToken &&
        oldView.performance.timeOrigin === oldTimeOrigin,
      'Failed/cancelled switch rebuilt the original Document'
    )
    assert(
      first.hasAttribute('data-pnds-current') &&
        first.inert === !panel().hidden &&
        (panel().hidden
          ? document.activeElement === first
          : document.activeElement !== first &&
            first.classList.contains('is-obscured')),
      'Original input was not gated by the candidate overlay'
    )
  }
  // Establish a real trusted-input audio graph before the new candidate locks
  // interaction. The overlay preserves this graph until a successful handoff.
  const initialInputs = oldState.inputs
  phase('input')
  await wait(() => oldState.inputs === initialInputs + 1)
  await wait(() => oldView.scoreAudio?.state === 'running')
  const oldAudio = oldView.scoreAudio
  phase('first')
  await wait(
    () =>
      panel().dataset.performanceId &&
      panel().dataset.performanceId !== firstPerformance
  )
  const failedPerformance = panel().dataset.performanceId
  submit()
  await wait(
    () =>
      document
        .querySelector('[data-pnds-status]')
        .textContent.includes(strings.preparationFailed),
    6000
  )
  retained()
  phase('failed')
  await wait(
    () =>
      panel().dataset.performanceId &&
      panel().dataset.performanceId !== failedPerformance
  )
  submit()
  const pending = await wait(() => {
    const frame = document.querySelector('[data-pnds-candidate]')
    return frame?.contentWindow.scoreState?.connections === 2 ? frame : null
  })
  const pendingState = pending.contentWindow.scoreState
  const pendingWorker = pending.contentWindow.scoreWorker
  const originalInputs = oldState.inputs
  phase('input')
  await new Promise(resolve => setTimeout(resolve, 150))
  assert(
    oldState.inputs === originalInputs && pendingState.inputs === 0,
    'An obscured original or preparing candidate received performance input'
  )
  const context = pending.contentWindow.PNDS_PARTICIPATION
  const report = {
    type: 'pnds:prepared',
    protocolVersion: 1,
    hostId: context.hostId,
    projectId: context.projectId,
    performanceId: context.performanceId,
    resourceScope: 'page',
  }
  // Root-window reports cannot impersonate the candidate, even with valid IDs.
  window.postMessage(report, location.origin)
  // The actual candidate still cannot prepare for a different performance.
  pending.contentWindow.eval(
    `parent.postMessage(${JSON.stringify({ ...report, performanceId: 'f'.repeat(64) })},location.origin)`
  )
  await new Promise(resolve => setTimeout(resolve, 150))
  retained()
  assert(
    pending.inert && document.activeElement !== pending,
    'Preparing candidate took performance input'
  )
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  )
  await wait(() => !pending.isConnected)
  retained()
  const cancelledTicks = pendingState.ticks
  await new Promise(resolve => setTimeout(resolve, 150))
  assert(
    pendingState.ticks === cancelledTicks,
    'Cancelled candidate kept its autonomous clock'
  )
  let workerResponded = false
  pendingWorker.onmessage = () => {
    workerResponded = true
  }
  pendingWorker.postMessage('probe')
  await new Promise(resolve => setTimeout(resolve, 150))
  assert(!workerResponded, 'Cancelled candidate kept its Worker alive')
  phase('cancelled')
  submit()
  const replacement = await wait(() => {
    const frame = document.querySelector('[data-pnds-current]')
    return frame && frame !== first ? frame : null
  })
  await wait(() => !first.isConnected)
  await wait(() => oldAudio.state !== 'running')
  const retiredAudioTime = oldAudio.currentTime
  const retiredTicks = oldState.ticks
  await new Promise(resolve => setTimeout(resolve, 150))
  assert(
    oldState.ticks === retiredTicks,
    'Retired Document kept its autonomous clock'
  )
  assert(
    oldAudio.currentTime === retiredAudioTime,
    'Retired document kept rendering its AudioContext'
  )
  assert(
    replacement.contentWindow.PNDS_PARTICIPATION.preparation?.resourceScope ===
      'page',
    'Replacement happened without required resources'
  )
  assert(
    !replacement.inert && document.activeElement === replacement,
    'Input did not transfer to the current page'
  )
  assert(
    panel().hidden && panel().dataset.admission === 'unknown',
    'Prepared page was misreported as admitted or left permanent controls'
  )
  const newState = replacement.contentWindow.scoreState
  const newInputs = newState.inputs
  const retiredInputs = oldState.inputs
  phase('input')
  await wait(() => newState.inputs === newInputs + 1)
  assert(
    oldState.inputs === retiredInputs,
    'Retired document also received performance input'
  )
  phase('second')
  return {
    passed: true,
    failedCandidatePreservedDocument: true,
    cancelledCandidateRetired: true,
    preparationSourceVerified: true,
    inputTransferred: true,
    inputBlockedDuringEntry: true,
    oldClockRetired: true,
    admission: 'unknown',
  }
}
