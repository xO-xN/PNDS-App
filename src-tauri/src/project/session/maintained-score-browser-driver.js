// Actual maintenance pages, production public entry and native WK prompt UI.
/* global document, window, setTimeout, FIXTURE_SCORE, MutationObserver, location, fetch, URL */
globalThis.verifyBrowserEntry = async function () {
  const { id, monitorUrl } = FIXTURE_SCORE
  const pause = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async (test, label) => {
    const end = Date.now() + 12000
    while (!(await test())) {
      if (Date.now() > end)
        throw Error(
          `${id}: ${label}; ${document.querySelector('[data-pnds-status]')?.textContent}`
        )
      await pause()
    }
  }
  const signal = phase =>
    window.webkit.messageHandlers.result.postMessage({ phase })
  const current = () => document.querySelector('iframe[data-pnds-current]')
  const enter = async () => {
    const form = document.querySelector('form')
    if (!form) throw Error(`${id}: missing explicit entry`)
    form.requestSubmit()
    await wait(
      () => current()?.contentWindow.PNDS_PARTICIPATION?.preparation,
      'page preparation'
    )
    return current().contentWindow
  }
  window.webkit.messageHandlers.result.postMessage({
    phase: 'prompt-answer',
    answer: '1',
  })
  let win = await enter()
  await wait(() => win.document.querySelector('canvas'), 'real canvas')
  const context = win.PNDS_PARTICIPATION
  const connect = async (origin, options) => {
    const socket = win.io(origin, options)
    await wait(() => socket.connected, 'real Socket.IO connection')
    return socket
  }
  let claimKey, choiceKey, claim, choice
  let musicalEvidence
  if (id === 'inarticulate-iii') {
    await wait(
      () => win.eval('selectionMade && userType === "1"'),
      'actual role prompt admission'
    )
    claimKey = context.storageKey('inarticulate-iii.player-claim')
    choiceKey = context.storageKey('inarticulate-iii.player-id')
    const observer = await connect(win.location.origin, {
      ...context.socketOptions,
    })
    let point
    observer.on('pointSend', packet => (point = packet))
    win.eval('socket').emit('point', {
      main: { x: 100, y: 200 },
      relX: 0.25,
      relY: 0.75,
      amp: { x: 20, y: 30, length: 0.4 },
    })
    await wait(
      () => point?.main?.x === 100 && point.main.y === 200,
      'original point broadcast'
    )
    musicalEvidence = { pointReceived: true, clientId: point.clientId }
    observer.close()
  } else if (id === 'inarticulate-iv') {
    const control = await connect(win.location.origin, {
      ...context.socketOptions,
    })
    control.emit('start', { startBPM: 21 })
    await wait(() => win.eval('started && BPM === 21'), 'original start event')
    control.emit('pause')
    await wait(() => win.eval('paused'), 'original pause event')
    const position = win.eval('nowMs()')
    win.eval('socket').disconnect().connect()
    await wait(
      () => win.eval('socket.connected && paused'),
      'same-performance reconnect'
    )
    await pause(100)
    if (Math.abs(win.eval('nowMs()') - position) > 100)
      throw Error('IV paused score moved')
    musicalEvidence = { startBpm: 21, pausedReconnect: true }
    control.close()
  } else {
    await wait(() => win.eval('playerJoined'), 'actual Runes admission')
    // This is the existing conductor connection on the internal monitor listener.
    const conductor = await connect(monitorUrl, {
      transports: ['websocket'],
      auth: { runesScoreRole: 'conductor' },
    })
    const score = await new Promise(resolve =>
      conductor.emit('runes:score:sync', {}, resolve)
    )
    const item = score.items[0]
    const number = (item.point + 1) % 10
    win.document.querySelector(`[data-number="${number}"]`).click()
    await new Promise(resolve =>
      conductor.emit(
        'runes:score:command',
        { playhead: item.startTime + 500, playing: false },
        resolve
      )
    )
    await wait(
      () => win.eval('currentReference !== null'),
      'real visible score element'
    )
    const observer = win.PNDSPlayers.connectObserver({
      io: win.io,
      origin: win.location.origin,
      events: { state: 'runes:state' },
      socketOptions: { ...context.socketOptions },
    })
    await wait(() => observer.connected, 'touch observer')
    const canvas = win.document.getElementById('canvas-host')
    const bounds = canvas.getBoundingClientRect()
    const pointer = (type, offset) =>
      canvas.dispatchEvent(
        new win.PointerEvent(type, {
          pointerId: 42,
          pointerType: 'touch',
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width / 2 + offset,
          clientY: bounds.top + bounds.height / 2,
          buttons: type === 'pointerup' ? 0 : 1,
        })
      )
    pointer('pointerdown', 0)
    await pause(80)
    pointer('pointermove', 20)
    await wait(
      () => observer.state?.touches?.some(touch => touch.number === number),
      'real pointer reaches Host musical state'
    )
    musicalEvidence = {
      pointerReachedHost: true,
      number,
      touch: observer.state.touches.find(touch => touch.number === number),
    }
    pointer('pointerup', 20)
    await wait(
      () => !observer.state.touches.some(touch => touch.number === number),
      'touch release'
    )
    claimKey = context.storageKey('runes.performerClaim')
    choiceKey = context.storageKey('runes.performerNumber')
    conductor.close()
    observer.close()
  }
  if (claimKey) {
    claim = win.localStorage.getItem(claimKey)
    choice = win.localStorage.getItem(choiceKey)
    if (!claim || choice === null)
      throw Error(`${id}: no scoped durable identity`)
    for (const key of [
      'inarticulate-iii.player-claim',
      'inarticulate-iii.player-id',
      'runes.performerClaim',
      'runes.performerNumber',
    ]) {
      if (win.localStorage.getItem(key) !== null)
        throw Error('Native legacy storage key leaked into public browser')
    }
    const previousDocument = current().contentDocument
    win.location.reload()
    await wait(
      () =>
        current().contentDocument !== previousDocument &&
        current().contentWindow.PNDS_PARTICIPATION?.preparation &&
        current().contentWindow.eval(
          id === 'inarticulate-iii'
            ? 'typeof selectionMade !== "undefined" && selectionMade'
            : 'typeof player !== "undefined" && player?.joined && player.recovered'
        ),
      'same-performance claim recovery'
    )
    win = current().contentWindow
    if (
      win.localStorage.getItem(claimKey) !== claim ||
      win.localStorage.getItem(choiceKey) !== choice
    )
      throw Error('Same-performance reload lost project identity')
  }
  const origin = win.location.origin
  const requests = win.performance
    .getEntriesByType('resource')
    .map(resource => resource.name)
  if (requests.some(url => !url.startsWith(origin + context.basePath)))
    throw Error(`Resource escaped confirmed scope: ${JSON.stringify(requests)}`)
  const documentBefore = current().contentDocument
  const timeOrigin = win.performance.timeOrigin
  signal('first')
  await wait(
    () =>
      document.querySelector('[data-pnds-entry]')?.hidden === false &&
      document.querySelector('form'),
    'new performance discovery'
  )
  if (
    current().contentDocument !== documentBefore ||
    win.performance.timeOrigin !== timeOrigin
  )
    throw Error('Stop/restart replaced the active Document')
  if ((await win.fetch(context.resource('__pnds/health'))).status !== 409)
    throw Error('Old run authorization reached replacement')
  const oldFrame = current()
  let failedCandidate, preparationFailure
  const observer = new MutationObserver(() => {
    const frame = document.querySelector('iframe[data-pnds-candidate]')
    if (frame && frame.src !== 'about:blank')
      failedCandidate = { frame, url: frame.src, source: frame.contentWindow }
  })
  observer.observe(document.body, { childList: true })
  window.addEventListener('message', event => {
    if (
      event.origin === location.origin &&
      event.source === failedCandidate?.source &&
      event.data?.type === 'pnds:preparation-failed'
    )
      preparationFailure = event.data
  })
  document.querySelector('form').requestSubmit()
  await wait(
    () =>
      preparationFailure &&
      document.querySelector('form button[type="submit"]:not(:disabled)'),
    'required stylesheet failure'
  )
  if (current() !== oldFrame || oldFrame.contentDocument !== documentBefore)
    throw Error('Missing required CSS destroyed original Document')
  observer.disconnect()
  signal('stylesheet-failed')
  await wait(
    async () =>
      (
        await fetch(new URL(FIXTURE_SCORE.stylesheet, failedCandidate.url), {
          cache: 'no-store',
        })
      ).ok,
    'required stylesheet recovery'
  )
  await wait(
    () => document.querySelector('form button[type="submit"]:not(:disabled)'),
    'retry control enabled'
  )
  window.webkit.messageHandlers.result.postMessage({
    phase: 'retry-diagnostic',
    stylesheet: new URL(FIXTURE_SCORE.stylesheet, failedCandidate.url).href,
    retired: !failedCandidate.frame.isConnected,
  })
  document.querySelector('form').requestSubmit()
  await wait(
    () =>
      current() !== oldFrame &&
      current()?.contentWindow.PNDS_PARTICIPATION?.preparation,
    'explicit same-project reentry'
  )
  const replacement = current().contentWindow
  if (replacement.PNDS_PARTICIPATION.performanceId === context.performanceId)
    throw Error('Restart reused authorization')
  if (claimKey) {
    await wait(
      () =>
        Boolean(replacement.localStorage.getItem(claimKey)) &&
        replacement.localStorage.getItem(choiceKey) === choice,
      'project identity restore'
    )
    await wait(
      () =>
        replacement.eval(
          id === 'inarticulate-iii' ? 'selectionMade' : 'playerJoined'
        ),
      'restored project admission'
    )
    if (
      id === 'inarticulate-iii' &&
      replacement.localStorage.getItem(claimKey) !== claim
    )
      throw Error('III restart lost its client-owned durable claim')
  }
  const evidence = {
    passed: true,
    id,
    prepared: context.preparation,
    dynamicMonitor: monitorUrl,
    requests: requests.length,
    allResourcesScoped: true,
    musicalEvidence,
    sameDocumentUntilExplicitEntry: true,
    staleRunRejected: true,
    missingStylesheetRetainedDocument: true,
    samePerformanceClaimRestored: Boolean(claimKey),
    projectSelectionRestored: Boolean(choiceKey),
    claimRotatedOnProjectRestart: Boolean(
      claimKey && replacement.localStorage.getItem(claimKey) !== claim
    ),
    anonymous: !claimKey,
  }
  window.webkit.messageHandlers.result.postMessage({
    phase: 'evidence',
    ...evidence,
  })
  return evidence
}
