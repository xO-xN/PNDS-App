/* global document, window, setTimeout, structuredClone, fetch, URL, Event, MutationObserver, addEventListener */
globalThis.verifyBrowserEntry = async function () {
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  let candidateUrl
  new MutationObserver(() => {
    const frame = document.querySelector('[data-pnds-candidate]')
    if (frame?.src && frame.src !== 'about:blank') candidateUrl = frame.src
  }).observe(document.body, { childList: true })
  addEventListener('message', event => {
    if (event.data?.type === 'pnds:preparation-failed')
      window.webkit.messageHandlers.result.postMessage({
        phase: 'candidate-diagnosis',
        url: candidateUrl,
        report: event.data,
        evidence: event.source.__asbsEvidence,
      })
  })
  const attempts = []
  const wait = async (predicate, description) => {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const proof = document.querySelector('[data-pnds-candidate]')
        ?.contentWindow.__asbsEvidence
      if (proof && !attempts.includes(proof)) attempts.push(proof)
      const result = await predicate()
      if (result) return result
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    window.webkit.messageHandlers.result.postMessage({
      phase: 'diagnosis',
      description,
      attempts,
    })
    throw new Error(
      description +
        ': ' +
        document.querySelector('[data-pnds-status]')?.textContent
    )
  }
  const phase = (name, value = {}) =>
    window.webkit.messageHandlers.result.postMessage({ phase: name, ...value })
  const submit = () => document.querySelector('form').requestSubmit()
  await wait(
    () => document.visibilityState === 'visible',
    'visible browser fixture'
  )
  submit()
  const first = await wait(
    () => document.querySelector('[data-pnds-current]'),
    'first score'
  )
  const old = first.contentWindow
  const original = {
    token: old.documentToken,
    origin: old.performance.timeOrigin,
    document: old.document,
    ticks: old.localTicks,
  }
  const firstPerformance = old.PNDS_PARTICIPATION.performanceId
  phase('first')
  await wait(
    () =>
      document.querySelector('[data-pnds-entry]').dataset.performanceId &&
      document.querySelector('[data-pnds-entry]').dataset.performanceId !==
        firstPerformance,
    'ASBS candidate'
  )
  submit()
  candidateUrl = null
  await wait(() => {
    candidateUrl ||= document.querySelector('[data-pnds-candidate]')?.src
    return document
      .querySelector('[data-pnds-status]')
      .textContent.includes('could not prepare')
  }, 'actual missing part fails')
  assert(
    first.contentWindow.document === original.document &&
      old.documentToken === original.token &&
      old.performance.timeOrigin === original.origin &&
      old.localTicks > original.ticks,
    'failed ASBS replaced or stopped old document'
  )
  phase('failed')
  await wait(
    async () =>
      (await fetch(new URL('libraries/A1/A1P15.png', candidateUrl))).ok,
    'resource restored'
  )
  const oldForm = document.querySelector('form')
  const bPerformance =
    document.querySelector('[data-pnds-entry]').dataset.performanceId
  submit()
  await wait(
    () =>
      document.querySelector('[data-pnds-candidate]')?.contentWindow
        .fixtureToken,
    'real ASBS staged page'
  )
  phase('pending')
  await wait(
    () =>
      document.querySelector('[data-pnds-entry]').dataset.performanceId &&
      document.querySelector('[data-pnds-entry]').dataset.performanceId !==
        bPerformance,
    'B changed to C'
  )
  await wait(
    () => !document.querySelector('[data-pnds-candidate]'),
    'retire cancelled ASBS'
  )
  oldForm.dispatchEvent(new Event('submit', { cancelable: true }))
  assert(
    first.contentWindow.document === original.document &&
      old.documentToken === original.token,
    'ASBS candidate race replaced original'
  )
  assert(!document.querySelector('[data-pnds-candidate]'), 'B click entered C')
  const cPerformance =
    document.querySelector('[data-pnds-entry]').dataset.performanceId
  phase('race')
  await wait(
    () =>
      document.querySelector('[data-pnds-entry]').dataset.performanceId &&
      document.querySelector('[data-pnds-entry]').dataset.performanceId !==
        cPerformance,
    'ASBS new performance'
  )
  submit()
  const frame = await wait(() => {
    const current = document.querySelector('[data-pnds-current]')
    return current && current !== first ? current : null
  }, 'ASBS complete resources prepare and hand off')
  const view = frame.contentWindow
  assert(
    view.PNDS_PARTICIPATION.preparation &&
      view.document.querySelectorAll('.group-tile').length === 4,
    'preparation is separate from performer admission'
  )
  view.document.querySelector('.group-tile').click()
  await wait(
    () => view.document.querySelector('.number-tile'),
    'ASBS part choice'
  )
  view.document.querySelector('.number-tile').click()
  await wait(
    () =>
      view.document.querySelector('.preparation-cue')?.dataset.state ===
      'ready',
    'selected part reuses prepared bytes'
  )
  await wait(() => {
    void view.__asbsAdvance(0)
    return view.__asbsEvidence.drawn.some(p => p.endsWith('A1P1.png'))
  }, 'real first bitmap')
  const before = structuredClone(view.__asbsEvidence)
  assert(
    !before.decoded.some(p => p.endsWith('A1P15.png')),
    'middle page already decoded'
  )
  const control = view.io(view.location.origin, {
    ...view.PNDS_PARTICIPATION.socketOptions,
  })
  let state
  control.on('state', value => {
    state = value
  })
  control.on('connect', () => {
    control.emit('monitor')
    control.emit('claim')
  })
  await wait(
    () => state?.conductor?.claimed && state.conductor.id === control.id,
    'actual conductor claim'
  )
  control.emit('start')
  await wait(() => state?.timeline?.state === 'playing', 'actual ASBS timeline')
  await new Promise(resolve => setTimeout(resolve, 100))
  const token = view.fixtureToken,
    timeOrigin = view.performance.timeOrigin
  const main = view.__asbsSockets[0]
  const packets = view.__asbsEvidence.positions
  main.disconnect()
  await view.__asbsAdvance(2000)
  await wait(
    () => view.document.querySelector('.signal-cue'),
    'same-context loss continues autonomously'
  )
  main.connect()
  await wait(
    () => main.connected && view.__asbsEvidence.positions > packets,
    'same-context actual transport recovers'
  )
  await view.__asbsAdvance(0)
  await wait(
    () => !view.document.querySelector('.signal-cue'),
    'same performance realigns'
  )
  assert(
    view.fixtureToken === token && view.performance.timeOrigin === timeOrigin,
    'same-context recovery rebuilt document'
  )
  phase('prepared', { before, sameContextRecovery: true })
  await wait(() => {
    const candidate =
      document.querySelector('[data-pnds-entry]').dataset.performanceId
    return candidate && candidate !== view.PNDS_PARTICIPATION.performanceId
  }, 'new candidate while actual ASBS keeps playing')
  await view.__asbsAdvance(2000)
  assert(
    document.querySelector('[data-pnds-current]') === frame &&
      view.fixtureToken === token &&
      view.performance.timeOrigin === timeOrigin &&
      view.__asbsEvidence.document === before.document,
    'new candidate replaced actual ASBS document'
  )
  const revoked = await fetch(
    view.PNDS_PARTICIPATION.resource('__pnds/context.js')
  )
  assert(
    [409, 410].includes(revoked.status),
    'old ASBS network reached replacement'
  )
  phase('active-candidate', { sameDocument: true, oldNetworkRejected: true })
  assert(
    view.document.visibilityState === 'visible',
    'score must be foreground for full-part rendering'
  )
  await wait(
    () =>
      !view.PNDS_PARTICIPATION.preparationFailure &&
      document.querySelector('[data-pnds-entry]').dataset.state === 'waiting',
    'Host stopped'
  )
  control.close()
  phase('offline-start', { clock: view.performance.now() })
  const origin = view.performance.timeOrigin
  for (
    let tick = 0;
    tick < 6000 && !view.document.querySelector('.finished-cue');
    tick++
  )
    await view.__asbsAdvance(500)
  for (let tick = 0; tick < 30; tick++) await view.__asbsAdvance(0)
  phase('offline-end', { clock: view.performance.now() })
  const after = view.__asbsEvidence
  assert(
    view.performance.timeOrigin === origin &&
      after.document === before.document,
    'ASBS document changed on Host loss'
  )
  assert(
    after.drawn.some(p => p.endsWith('A1P15.png')) &&
      after.drawn.some(p => p.endsWith('A1end.png')),
    'real part did not reach previously undecoded middle and ending'
  )
  assert(
    after.resourceRequests.length === before.resourceRequests.length,
    'scroll requested Host bytes'
  )
  assert(
    view.document.querySelector('.finished-cue'),
    'actual follow engine did not finish'
  )
  return {
    passed: true,
    failureRetainedDocument: true,
    actualAsbs: true,
    before,
    after,
    hostStopped: true,
    sameDocument: true,
    activeAsbsRetainedOnNewCandidate: true,
    oldNetworkRejected: true,
  }
}
