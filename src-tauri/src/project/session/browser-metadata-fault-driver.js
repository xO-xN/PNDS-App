/* global document, fetch, setTimeout */
globalThis.verifyBrowserEntry = async function () {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const wait = async predicate => {
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      if (await predicate()) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('Metadata fault observation timed out')
  }
  let faultMode = 'healthy'
  const fault = async mode => {
    faultMode = mode
    const response = await fetch(`/__fixture/fault?mode=${mode}`)
    assert(response.ok, 'Could not control the owned metadata fault')
  }
  await wait(() => document.querySelector('form'))
  document.querySelector('form').requestSubmit()
  await wait(() => document.querySelector('iframe[data-pnds-current]'))
  const frame = document.querySelector('iframe[data-pnds-current]')
  const view = frame.contentWindow
  const original = {
    document: view.document,
    token: view.documentToken,
    timeOrigin: view.performance.timeOrigin,
    ticks: view.localTicks,
  }
  const retained = async () => {
    await wait(() => view.localTicks > original.ticks)
    assert(view.document === original.document, 'The real Document changed')
    assert(view.documentToken === original.token, 'Unsaved memory was lost')
    const actualTimeOrigin = view.performance.timeOrigin
    assert(
      actualTimeOrigin === original.timeOrigin,
      `Performance time origin changed: expected=${original.timeOrigin}; actual=${actualTimeOrigin}; delta=${actualTimeOrigin - original.timeOrigin}; documentSame=${view.document === original.document}; tokenSame=${view.documentToken === original.token}; fault=${faultMode}`
    )
    assert(
      document.querySelectorAll('iframe').length === 1,
      'A failure or new Host preloaded a document'
    )
    original.ticks = view.localTicks
  }
  const panel = document.querySelector('[data-pnds-entry]')
  for (const mode of [
    'timeout',
    'http',
    'malformed',
    'incompatible',
    'different',
  ]) {
    await fault(mode)
    await wait(() => panel.dataset.state === 'unavailable')
    await retained()
    assert(panel.hidden, 'An automatic fault obscured the playing score')
    await fault('healthy')
    await wait(() => panel.dataset.state === 'ready')
    await retained()
    assert(panel.hidden, 'Same-performance recovery reopened entry controls')
    const response = await view.fetch(
      view.PNDS_PARTICIPATION.resource('asset.json?part=7')
    )
    assert(response.ok, 'The retained performance could not reconnect')
  }
  return {
    passed: true,
    sameDocument: true,
    unsavedMemory: true,
    advancingClock: true,
    samePerformanceRecovery: true,
    faults: ['timeout', 'http', 'malformed', 'incompatible', 'differentHost'],
  }
}
