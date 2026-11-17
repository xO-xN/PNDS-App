/* global document, setTimeout, window */
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
    throw new Error('Timed out waiting for browser entry')
  }
  const phase = name =>
    window.webkit.messageHandlers.result.postMessage({ phase: name })
  const panel = () => document.querySelector('[data-pnds-entry]')
  const form = await wait(() => document.querySelector('form'))
  form.requestSubmit()
  const frame = await wait(() =>
    document.querySelector('iframe[data-pnds-current]')
  )
  const view = frame.contentWindow
  await wait(() => view.scoreProof)
  await view.scoreProof
  const original = {
    document: view.document,
    token: view.documentToken,
    timeOrigin: view.performance.timeOrigin,
    ticks: view.localTicks,
  }
  const firstId = view.PNDS_PARTICIPATION.performanceId
  const retained = () => {
    assert(
      frame.contentWindow.document === original.document,
      'The original Document was replaced'
    )
    assert(
      view.documentToken === original.token &&
        view.performance.timeOrigin === original.timeOrigin &&
        view.localTicks > original.ticks,
      'Original memory or clock was lost'
    )
    assert(
      document.querySelectorAll('iframe').length === 1,
      'Unconfirmed project was preloaded'
    )
  }
  phase('first')
  await wait(() => panel()?.dataset.state === 'waiting')
  retained()
  assert(panel().hidden, 'Idle network state obscures the score')
  phase('idle')
  await wait(
    () =>
      panel()?.dataset.performanceId &&
      panel().dataset.performanceId !== firstId
  )
  retained()
  assert(
    !panel().hidden && panel().textContent.includes('Runtime fixture'),
    'New project name is missing'
  )
  const enterButton = document.querySelector('form button')
  enterButton.focus()
  await new Promise(resolve => setTimeout(resolve, 2200))
  assert(
    enterButton.isConnected && document.activeElement === enterButton,
    'Discovery replaced the focused entry action'
  )
  phase('second')
  await wait(() => panel()?.dataset.state === 'waiting')
  retained()
  phase('stopped')
  await wait(
    () =>
      panel()?.dataset.performanceId &&
      panel().dataset.performanceId !== firstId
  )
  retained()
  assert(
    panel().dataset.projectId === view.PNDS_PARTICIPATION.projectId,
    'Same-project restart was not discovered'
  )
  phase('third')
  return {
    passed: true,
    sameDocument: true,
    unsavedMemory: true,
    autonomousClock: true,
    noPreload: true,
    restartedPerformanceRequiresConfirmation: true,
  }
}
