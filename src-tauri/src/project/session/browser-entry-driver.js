/* global setTimeout, fetch, URL, location, document, window */
globalThis.verifyBrowserEntry = async function () {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const wait = async predicate => {
    const deadline = Date.now() + 25000
    while (Date.now() < deadline) {
      const value = await predicate()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error('Timed out waiting for Host transition')
  }
  const metadata = () =>
    fetch('/__pnds/participation').then(response => response.json())
  assert(
    document
      .querySelector('meta[name="viewport"]')
      .content.includes('viewport-fit=cover'),
    'The public outer document must permit an edge-to-edge score viewport'
  )
  const first = await metadata()
  const firstRun = first.performance.performanceId
  const open = async info => {
    const form = await wait(() => {
      const candidate = document.querySelector('form')
      return candidate?.action.includes(info.performance.performanceId)
        ? candidate
        : null
    })
    const confirmation = new URL(form.getAttribute('action'), location.origin)
      .href
    const enterButton = form.querySelector('button')
    enterButton.focus()
    assert(
      document.activeElement === enterButton,
      'Entry management must retain keyboard focus'
    )
    assert(
      window.getComputedStyle(form).userSelect !== 'none',
      'Score gesture policy must not suppress management text selection'
    )
    form.requestSubmit()
    const frame = await wait(() => {
      const current = document.querySelector('iframe[data-pnds-current]')
      return current?.contentWindow.PNDS_PARTICIPATION?.performanceId ===
        info.performance.performanceId
        ? current
        : null
    })
    const view = frame.contentWindow
    const box = frame.getBoundingClientRect()
    assert(
      box.left === 0 &&
        box.top === 0 &&
        box.width === window.innerWidth &&
        box.height === window.innerHeight,
      `Score frame has an outer gutter: ${JSON.stringify(box.toJSON())}`
    )
    assert(
      view.innerWidth === window.innerWidth &&
        view.innerHeight === window.innerHeight,
      'The score document must receive the complete outer viewport'
    )
    const proof = await wait(
      async () => view.scoreProof && (await view.scoreProof)
    )
    assert(
      proof.worker.path === '/asset.json?worker=7',
      'Real worker query escaped context'
    )
    assert(
      proof.asset.path === '/asset.json?part=7',
      'Resource query escaped context'
    )
    assert(proof.preparation.resourceScope === 'page', 'Preparation missing')
    assert(
      proof.preparation.performanceId === info.performance.performanceId,
      'Preparation belongs to wrong performance'
    )
    return {
      frame,
      view,
      confirmation,
      url: frame.src,
      performanceId: info.performance.performanceId,
    }
  }
  const a = await open(first)
  const state = {
    document: a.view.document,
    token: a.view.documentToken,
    origin: a.view.performance.timeOrigin,
    ticks: a.view.localTicks,
  }
  const key = a.view.PNDS_PARTICIPATION.storageKey('claim')
  a.view.localStorage.setItem(key, 'claim-A')
  window.webkit.messageHandlers.result.postMessage({
    phase: 'first',
    state: { token: state.token, origin: state.origin, ticks: state.ticks },
    hostId: first.hostId,
    projectId: first.performance.projectId,
  })
  const second = await wait(async () => {
    const info = await metadata()
    return info.performance && info.performance.performanceId !== firstRun
      ? info
      : null
  })
  assert(
    a.view.document === state.document &&
      a.view.documentToken === state.token &&
      a.view.performance.timeOrigin === state.origin &&
      a.view.localTicks > state.ticks,
    'Discovery destroyed the old real Document or its clock'
  )
  for (const relative of [
    'asset.json?forbidden-old-http=1',
    'socket.io/?EIO=4&transport=polling&forbidden-old-polling=1',
  ]) {
    assert(
      !(await fetch(a.url + relative)).ok,
      'Old document reached replacement via ' + relative
    )
  }
  const worker = await new Promise(resolve => {
    a.view.scoreWorker.onmessage = event => resolve(event.data)
    a.view.scoreWorker.postMessage('probe')
  })
  assert(worker.status !== 200, 'Old live Worker reached replacement')
  await new Promise((resolve, reject) => {
    const socket = a.view.io(location.origin, {
      ...a.view.PNDS_PARTICIPATION.socketOptions,
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000,
      query: { 'forbidden-old-ws': '1' },
    })
    socket.on('connect', () => {
      socket.close()
      reject(new Error('Old WebSocket reached replacement'))
    })
    socket.on('connect_error', () => {
      socket.close()
      resolve()
    })
  })
  assert(
    (await fetch(a.confirmation, { method: 'POST' })).status === 409,
    'Old confirmation joined replacement'
  )
  const b = await open(second)
  await wait(() => !a.frame.isConnected)
  document.cookie = 'pnds-fixture=replaced;path=/'
  assert(
    b.view.localStorage.getItem(
      b.view.PNDS_PARTICIPATION.storageKey('claim')
    ) === null,
    'Project B inherited A identity'
  )
  b.view.localStorage.setItem(
    b.view.PNDS_PARTICIPATION.storageKey('claim'),
    'claim-B'
  )
  window.webkit.messageHandlers.result.postMessage({
    phase: 'second',
    preservedUntilEntry: true,
    oldWorkerStatus: worker.status,
  })
  const third = await wait(async () => {
    const info = await metadata()
    return info.performance &&
      info.performance.performanceId !== second.performance.performanceId
      ? info
      : null
  })
  const again = await open(third)
  await wait(() => !b.frame.isConnected)
  assert(
    third.performance.projectId === first.performance.projectId,
    'Expected same project on reentry'
  )
  assert(
    again.view.localStorage.getItem(
      again.view.PNDS_PARTICIPATION.storageKey('claim')
    ) === 'claim-A',
    'Same project did not recover stable identity'
  )
  assert(
    again.view.PNDS_PARTICIPATION.performanceId !== a.performanceId,
    'New performance reused authorization'
  )
  window.webkit.messageHandlers.result.postMessage({
    phase: 'third',
    restored: true,
  })
  return {
    passed: true,
    actualShellControls: true,
    worker: true,
    polling: true,
    websocket: true,
    oldDocument: true,
    identityRestored: true,
  }
}
