/* global document, window, setTimeout, Event, fetch, location */
globalThis.verifyBrowserEntry = async function () {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const wait = async predicate => {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      const value = await predicate()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error('Timed out waiting for candidate race')
  }
  const phase = name =>
    window.webkit.messageHandlers.result.postMessage({ phase: name })
  const panel = () => document.querySelector('[data-pnds-entry]')
  document.querySelector('form').requestSubmit()
  const first = await wait(() => document.querySelector('[data-pnds-current]'))
  const original = {
    document: first.contentWindow.document,
    token: first.contentWindow.documentToken,
    timeOrigin: first.contentWindow.performance.timeOrigin,
    ticks: first.contentWindow.localTicks,
  }
  const firstId = first.contentWindow.PNDS_PARTICIPATION.performanceId
  const firstUrl = first.src
  let probe = 0
  const retained = async () => {
    probe++
    assert(
      document.querySelector('[data-pnds-current]') === first,
      `Active frame changed at probe ${probe}`
    )
    assert(
      first.contentWindow.document === original.document,
      `Real Document changed at probe ${probe}`
    )
    assert(
      first.contentWindow.documentToken === original.token,
      `Unsaved token changed at probe ${probe}`
    )
    assert(
      first.contentWindow.performance.timeOrigin === original.timeOrigin,
      `Time origin changed at probe ${probe}`
    )
    // Adjacent browser tasks can observe the same timer turn. Wait for the
    // autonomous clock itself, while retaining the identity assertions above.
    await wait(() => first.contentWindow.localTicks > original.ticks)
    original.ticks = first.contentWindow.localTicks
  }
  phase('first')
  await wait(
    () =>
      panel().dataset.performanceId && panel().dataset.performanceId !== firstId
  )
  const bId = panel().dataset.performanceId
  const oldForm = document.querySelector('form')
  oldForm.requestSubmit()
  const b = await wait(() => {
    const frame = document.querySelector('[data-pnds-candidate]')
    return frame?.contentWindow.scoreState?.connections === 2 ? frame : null
  })
  const oldContext = b.contentWindow.PNDS_PARTICIPATION
  const late = {
    type: 'pnds:prepared',
    protocolVersion: 1,
    hostId: oldContext.hostId,
    projectId: oldContext.projectId,
    performanceId: oldContext.performanceId,
    resourceScope: 'page',
  }
  await retained()
  phase('pending')
  await wait(
    () => panel().dataset.performanceId && panel().dataset.performanceId !== bId
  )
  await wait(() => !b.isConnected)
  await retained()
  assert(
    !document.querySelector('[data-pnds-candidate]'),
    'New C was loaded automatically after B changed'
  )
  // Even a retained handler for the old B control cannot spend that action on C.
  oldForm.dispatchEvent(new Event('submit', { cancelable: true }))
  window.postMessage(late, location.origin)
  await wait(() => !document.querySelector('form button').disabled)
  await retained()
  assert(
    !document.querySelector('[data-pnds-candidate]'),
    'Stale B action loaded C'
  )
  assert(
    (await fetch(firstUrl + 'asset.json?forbidden-old-race=1')).status === 409,
    'Retained A reached replacement C'
  )
  const worker = await new Promise(resolve => {
    first.contentWindow.scoreWorker.onmessage = event => resolve(event.data)
    first.contentWindow.scoreWorker.postMessage('probe')
  })
  assert(worker.status !== 200, 'Retained A Worker reached replacement C')
  document.querySelector('form').requestSubmit()
  const c = await wait(() => {
    const frame = document.querySelector('[data-pnds-current]')
    return frame && frame !== first ? frame : null
  })
  assert(
    c.contentWindow.PNDS_PARTICIPATION.performanceId ===
      panel().dataset.performanceId,
    'Explicit C action entered another candidate'
  )
  await wait(() => !first.isConnected)
  window.postMessage(late, location.origin)
  await new Promise(resolve => setTimeout(resolve, 150))
  assert(
    document.querySelector('[data-pnds-current]') === c,
    'Late B report revived a retired candidate'
  )
  phase('second')
  return {
    passed: true,
    displayedCandidateBound: true,
    pendingBChangedToC: true,
    noImplicitCEntry: true,
    lateResultsIgnored: true,
    originalDocumentRetained: true,
    oldNetworkFenced: true,
  }
}
