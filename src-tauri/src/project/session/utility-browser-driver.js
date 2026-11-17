/* global setTimeout, document, window */
// Actual installed utility pages in an ordinary browser; no native identity headers.
globalThis.verifyBrowserEntry = async function () {
  const { id, version } = globalThis.FIXTURE_UTILITY
  const pause = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async (test, label) => {
    const end = Date.now() + 15000
    while (!test()) {
      if (Date.now() > end)
        throw Error(
          `${id}: ${label}; ${document.querySelector('[data-pnds-status]')?.textContent}`
        )
      await pause()
    }
  }
  const signal = (phase, facts = {}) =>
    window.webkit.messageHandlers.result.postMessage({ phase, ...facts })
  const current = () => document.querySelector('iframe[data-pnds-current]')
  const form = document.querySelector('form')
  if (!form) throw Error(`${id}: missing explicit confirmation`)
  form.requestSubmit()
  await wait(
    () => current()?.contentWindow.PNDS_PARTICIPATION?.preparation,
    'real page preparation'
  )
  const frame = current(),
    win = frame.contentWindow,
    context = win.PNDS_PARTICIPATION
  const documentBefore = frame.contentDocument,
    timeOrigin = win.performance.timeOrigin
  let claimKey, claim, identity, behavior
  if (id === 'multichannel-signal-generator') {
    frame.style.inlineSize = '375px'
    const tone = win.document.querySelector('#rack button'),
      master = win.document.getElementById('master'),
      channel = win.document.getElementById('channel-volume-1')
    await wait(() => tone && !tone.disabled, 'server-authoritative controls')
    const channelBounds = channel.getBoundingClientRect()
    const phoneControls = {
      viewportWidth: win.innerWidth,
      channelWidth: channelBounds.width,
      channelHeight: channelBounds.height,
      gridColumns: win.getComputedStyle(
        win.document.getElementById('channel-volumes')
      ).gridTemplateColumns,
    }
    master.value = '300'
    master.dispatchEvent(new win.Event('input', { bubbles: true }))
    tone.click()
    channel.value = '400'
    channel.dispatchEvent(new win.Event('input', { bubbles: true }))
    let state
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await (await win.fetch(context.resource('api/state'))).json()
      if (
        state.masterValue === 0.3 &&
        state.tones[0].on &&
        state.tones[0].volume === 0.4
      )
        break
      await pause()
    }
    if (
      state.masterValue !== 0.3 ||
      !state.tones[0].on ||
      state.tones[0].volume !== 0.4
    )
      throw Error('Actual tone/master controls did not reach Host')
    const runId = state.runId
    // Rust reads and alternates controls on the actual internal monitor API.
    signal('controls', { runId, revision: state.revision })
    await wait(
      () =>
        !tone.classList.contains('active') &&
        master.value === '450' &&
        channel.value === '700',
      'monitor changes reach the same phone controls'
    )
    const after = await (await win.fetch(context.resource('api/state'))).json()
    if (after.runId !== runId)
      throw Error('Alternating controls restarted the engine')
    behavior = {
      toneChannelAndMasterControls: true,
      monitorAndPhoneShareRun: true,
      runId,
      downstreamMuted: true,
      hardwareSoundVerified: false,
      phoneControls,
    }
  } else if (id === 'local-network-diagnostics') {
    const socket = win.io(win.location.origin, { ...context.socketOptions })
    let state
    socket.on(win.PNDS.events.state, next => {
      state = next
    })
    await wait(() => socket.connected, 'actual observer connection')
    socket.emit(win.PNDS.events.diagStart)
    identity = win.eval('clientId')
    await wait(
      () => state?.diag?.clients?.[identity]?.metrics?.samples >= 3,
      'real performer probe/ack measurements'
    )
    behavior = {
      performerId: identity,
      metrics: state.diag.clients[identity].metrics,
    }
    claimKey = context.storageKey(win.PNDS.tokenKey)
    socket.close()
  } else if (id === 'telematic-network-diagnostics') {
    await wait(
      () =>
        win.document.getElementById('f-node') &&
        win.document.getElementById('map-svg'),
      'actual map and diagnostic controls'
    )
    const socket = win.io(win.location.origin, { ...context.socketOptions })
    let state
    socket.on(win.PNDS.events.state, next => {
      state = next
    })
    await wait(
      () => socket.connected && state,
      'actual internet diagnostic state'
    )
    if (state.configured || state.leg !== null || state.overall !== null)
      throw Error('Unconfigured local fixture claimed a public HUB measurement')
    if (!win.document.getElementById('land-layer').childElementCount)
      throw Error('Bundled land geometry did not render')
    behavior = {
      actualDiagnosticSnapshot: true,
      localMapRendered: true,
      hubConfigured: false,
      internetMeasurementClaimed: false,
    }
    socket.close()
  } else {
    identity = win.eval('deviceId')
    claimKey = context.storageKey(win.PNDS.tokenKey)
    if (win.isSecureContext !== false)
      throw Error('LAN HTTP fixture unexpectedly became a secure context')
    if (!/HTTPS/.test(win.document.querySelector('.capture-guide').textContent))
      throw Error('HTTP capture limitation is missing')
    if (win.navigator.mediaDevices?.getUserMedia)
      throw Error('Insecure LAN unexpectedly exposes media capture')
    const phases = []
    // Load the actual worker/runtime/models without acquiring a camera or
    // fabricating sensor samples. Unsupported engines report their real limit.
    const model = win.eval('createHandposeModel')(
      {
        maxHands: 1,
        runtime: 'tfjs',
        modelType: 'lite',
        detectorModelUrl: context.resource(
          'vendor/handpose/detector/model.json'
        ),
        landmarkModelUrl: context.resource(
          'vendor/handpose/landmark/model.json'
        ),
      },
      phase => phases.push(phase)
    )
    await model.ready
    model.dispose()
    behavior = {
      deviceId: identity,
      insecureHttpExplained: true,
      actualWorkerModelsLoaded: true,
      phases,
      hardwareCaptureVerified: false,
    }
  }
  if (claimKey) {
    claim = win.localStorage.getItem(claimKey)
    if (!claim) throw Error(`${id}: missing scoped durable claim`)
    if (win.localStorage.getItem(win.PNDS.tokenKey) !== null)
      throw Error('Public page wrote an unscoped claim')
  }
  const requests = win.performance
    .getEntriesByType('resource')
    .map(item => item.name)
  if (
    requests.some(
      url => !url.startsWith(win.location.origin + context.basePath)
    )
  )
    throw Error(`Resource escaped confirmed scope: ${JSON.stringify(requests)}`)
  signal('first')
  await wait(
    () =>
      !document.querySelector('[data-pnds-entry]')?.hidden &&
      document.querySelector('form'),
    'same-project restart discovery'
  )
  if (
    current().contentDocument !== documentBefore ||
    win.performance.timeOrigin !== timeOrigin
  )
    throw Error('Stop/restart destroyed original document')
  if ((await win.fetch(context.resource('__pnds/health'))).status !== 409)
    throw Error('Retired grant reached replacement run')
  document.querySelector('form').requestSubmit()
  await wait(
    () =>
      current() !== frame &&
      current()?.contentWindow.PNDS_PARTICIPATION?.preparation,
    'explicit reentry'
  )
  const replacement = current().contentWindow
  if (replacement.PNDS_PARTICIPATION.performanceId === context.performanceId)
    throw Error('Restart reused performance identity')
  if (claimKey) {
    if (replacement.localStorage.getItem(claimKey) !== claim)
      throw Error('Reentry lost Host/project claim')
    const recovered = replacement.eval(
      id === 'local-network-diagnostics' ? 'clientId' : 'deviceId'
    )
    if (recovered !== identity)
      throw Error('Reentry changed recovered device identity')
  }
  const evidence = {
    passed: true,
    id,
    version,
    behavior,
    allPageResourcesScoped: true,
    resourceCount: requests.length,
    documentPreservedUntilExplicitEntry: true,
    staleGrantRejected: true,
    scopedClaimRestored: Boolean(claimKey),
    preparation: context.preparation,
  }
  signal('evidence', evidence)
  return evidence
}
