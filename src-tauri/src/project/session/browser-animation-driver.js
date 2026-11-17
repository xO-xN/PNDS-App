/* global document, window, setTimeout, performance, getComputedStyle, PointerEvent, DOMMatrixReadOnly */
globalThis.verifyBrowserEntry = async function () {
  const forceReducedMotion = globalThis.PNDS_TEST_REDUCED_MOTION === true
  const originalMatchMedia = window.matchMedia
  const entrySheet = [...document.styleSheets].find(sheet =>
    sheet.href?.endsWith('/__pnds/entry.css')
  )
  const reducedRule = [...entrySheet.cssRules].find(rule =>
    rule.media?.mediaText.includes('prefers-reduced-motion: reduce')
  )
  const initialMedia = reducedRule.media.mediaText
  if (forceReducedMotion) {
    // Model the device preference in both production JS and its actual CSS.
    // The owned WK window is the only surface changed by this acceptance test.
    window.matchMedia = query => {
      const result = originalMatchMedia.call(window, query)
      if (query === '(prefers-reduced-motion: reduce)')
        Object.defineProperty(result, 'matches', { value: true })
      return result
    }
    reducedRule.media.mediaText = 'all'
  }
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  const pause = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds))
  const wait = async (predicate, description) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const value = predicate()
      if (value) return value
      await pause(10)
    }
    throw new Error(description)
  }
  const phase = name =>
    window.webkit.messageHandlers.result.postMessage({ phase: name })
  const panel = document.querySelector('[data-pnds-entry]')
  const current = () => document.querySelector('[data-pnds-current]')
  const opacity = element => Number(getComputedStyle(element).opacity)
  const touchMove = (target, count = 1) => {
    const view = target.ownerDocument.defaultView
    const event = new view.Event('touchmove', {
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, 'touches', {
      value: Array.from({ length: count }, (_, identifier) => ({
        identifier,
        clientX: 20 + identifier * 30,
        clientY: 30,
      })),
    })
    target.dispatchEvent(event)
    return event
  }
  const scoreKeepsTouch = frame => {
    assert(panel.hidden, 'Normal-score touch check requires a hidden overlay')
    assert(
      !touchMove(panel).defaultPrevented,
      'A hidden overlay still suppresses touch defaults'
    )
    const body = frame.contentDocument.body
    let received = 0
    const observe = () => received++
    body.addEventListener('touchmove', observe, { passive: true })
    const event = touchMove(body)
    body.removeEventListener('touchmove', observe)
    assert(
      received === 1 && !event.defaultPrevented,
      'Parent entry interfered with the score iframe’s own touch event'
    )
    assert(
      getComputedStyle(frame).touchAction === 'auto' &&
        frame.contentWindow.getComputedStyle(body).touchAction === 'auto',
      'Entry touch-action guard leaked into the score iframe'
    )
  }
  const incomingFade = animation => {
    const frames = animation.effect?.getKeyframes() || []
    const target = animation.effect?.target
    return (
      (target === panel || target === panel.querySelector('.pnds-content')) &&
      frames.length >= 2 &&
      Number(frames[0].opacity) < Number(frames.at(-1).opacity)
    )
  }
  const fades = new Set()
  const collectFades = () => {
    for (const animation of panel.getAnimations({ subtree: true }))
      if (incomingFade(animation)) fades.add(animation)
  }
  await wait(
    () => document.visibilityState === 'visible',
    'Animation fixture must render in a visible browser'
  )
  assert(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ===
      forceReducedMotion,
    'Animation fixture must exercise its requested motion preference'
  )
  document.querySelector('form').requestSubmit()
  const first = await wait(current, 'Initial real score did not prepare')
  scoreKeepsTouch(first)
  const firstPerformance = panel.dataset.performanceId
  phase('first')

  async function candidate(previousPerformance) {
    await wait(() => {
      collectFades()
      return (
        panel.dataset.performanceId &&
        panel.dataset.performanceId !== previousPerformance &&
        !panel.hidden
      )
    }, 'New candidate did not appear')
    // This exercises the actual nonpassive production handler, not iOS's
    // physical browser pull-to-refresh gesture, which macOS WK cannot produce.
    assert(
      touchMove(panel).defaultPrevented,
      'Dragging the entry background leaves its touch default uncancelled'
    )
    assert(
      !touchMove(panel, 2).defaultPrevented,
      'Entry background suppresses the browser’s multitouch zoom gesture'
    )
    const rootStyle = getComputedStyle(document.documentElement)
    const bodyStyle = getComputedStyle(document.body)
    assert(
      rootStyle.overscrollBehaviorY === 'none' ||
        bodyStyle.overscrollBehaviorY === 'none',
      'Entry background has no root overscroll guard'
    )
    assert(
      getComputedStyle(panel).touchAction === 'pinch-zoom',
      'Actionable entry background does not block panning while retaining zoom'
    )
    collectFades()
    const fade = [...fades].at(-1)
    assert(fade, 'New candidate appeared without an opacity fade-in')
    assert(
      fade.effect.getTiming().duration === 640,
      'Candidate fade-in did not use the slower 640ms timing'
    )
    assert(
      opacity(fade.effect.target) < 0.95,
      'New candidate was already fully opaque on first display'
    )
    await fade.finished
    const count = fades.size
    const until = performance.now() + 1200
    while (performance.now() < until) {
      collectFades()
      await pause(15)
    }
    assert(
      fades.size === count,
      'Unchanged candidate discovery restarted the entry fade-in'
    )
    return panel.dataset.performanceId
  }

  async function launch() {
    const ball = panel.querySelector('[data-pnds-ball]')
    const incoming = panel.querySelector('.pnds-incoming')
    const loader = panel.querySelector('[data-pnds-loader]')
    assert(
      opacity(incoming) > 0.99 && opacity(loader) < 0.01,
      'Confirmation did not begin with the entry text visible and loader hidden'
    )
    const rect = ball.getBoundingClientRect()
    const send = (target, type, x, y) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          isPrimary: true,
          pointerId: 4,
          pointerType: 'touch',
          button: 0,
          clientX: x,
          clientY: y,
        })
      )
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2
    send(ball, 'pointerdown', x, y)
    await pause(30)
    send(window, 'pointermove', x + 35, y + 75)
    send(window, 'pointerup', x + 35, y + 75)
    const flight = ball
      .getAnimations()
      .find(animation => animation.effect.getTiming().duration === 420)
    assert(flight, 'Drag did not start the actual 420ms ball flight')
    const loadingFade = loader
      .getAnimations()
      .find(animation => animation.effect.getTiming().duration === 480)
    assert(
      loadingFade,
      'Launching did not immediately start the actual 480ms loader fade'
    )
    const frames = flight.effect.getKeyframes()
    const end = new DOMMatrixReadOnly(frames.at(-1).transform)
    const right = rect.right + end.m41,
      left = rect.left + end.m41,
      bottom = rect.bottom + end.m42,
      top = rect.top + end.m42
    assert(
      right < 0 ||
        left > window.innerWidth ||
        bottom < 0 ||
        top > window.innerHeight,
      'Flight endpoint remains inside the viewport'
    )
    assert(
      frames.every(
        frame => frame.opacity === undefined || Number(frame.opacity) > 0.99
      ),
      'Ball fades out before flying beyond the viewport'
    )
    await pause(150)
    const incomingOpacity = opacity(incoming)
    const loaderOpacity = opacity(loader)
    assert(
      panel.classList.contains('is-launching') &&
        panel.classList.contains('is-loading') &&
        incomingOpacity > 0 &&
        incomingOpacity < 1 &&
        loaderOpacity > 0 &&
        loaderOpacity < 1 &&
        flight.playState === 'running' &&
        opacity(ball) > 0.99,
      'Entry and loader must crossfade while the opaque ball is still flying'
    )
    return { ball, flight, loadingFade }
  }

  async function handoff(previous) {
    const frame = await wait(
      () => document.querySelector('[data-pnds-candidate].is-revealing'),
      'Prepared score did not begin its visible crossfade'
    )
    const reveal = frame.getAnimations().find(animation => {
      const frames = animation.effect.getKeyframes()
      return (
        animation.effect.getTiming().duration === 640 &&
        Number(frames[0].opacity) === 0 &&
        Number(frames.at(-1).opacity) === 1
      )
    })
    const dismiss = panel.getAnimations().find(animation => {
      const frames = animation.effect.getKeyframes()
      return (
        animation.effect.getTiming().duration === 480 &&
        Number(frames[0].opacity) === 1 &&
        Number(frames.at(-1).opacity) === 0
      )
    })
    assert(reveal && dismiss, 'Loading-to-score handoff skipped its crossfade')
    assert(
      frame.inert &&
        current() === previous &&
        previous.isConnected &&
        panel.getAttribute('aria-busy') === 'true',
      'Crossfade gave input or document ownership to the new score too early'
    )
    assert(
      panel.classList.contains('is-loading') &&
        opacity(panel.querySelector('.pnds-incoming')) < 0.01 &&
        opacity(panel.querySelector('[data-pnds-instruction]')) < 0.01,
      'Handoff made the old entry text reappear'
    )
    await pause(240)
    assert(
      frame.inert &&
        current() === previous &&
        opacity(frame) > 0 &&
        opacity(frame) < 1 &&
        opacity(panel) > 0 &&
        opacity(panel) < 1,
      'Handoff cut directly between loading and the score instead of fading'
    )
    await Promise.all([reveal.finished, dismiss.finished])
    await wait(
      () => current() === frame && !frame.inert && panel.hidden,
      'Crossfaded score did not acquire input after animation and verification'
    )
    await wait(
      () => !previous.isConnected,
      'Retained old score was not retired after the completed handoff'
    )
    scoreKeepsTouch(frame)
    return frame
  }

  const secondPerformance = await candidate(firstPerformance)
  const launched = await launch()
  await launched.flight.finished
  await wait(
    () => panel.classList.contains('is-loading'),
    'Loading phase disappeared while the score was still preparing'
  )
  const loader = panel.querySelector('[data-pnds-loader]')
  const spinner = panel.querySelector('[data-pnds-spinner]')
  await launched.loadingFade.finished
  assert(
    touchMove(panel).defaultPrevented,
    'Preparing entry stopped guarding background panning'
  )
  assert(
    opacity(loader) > 0.99 &&
      opacity(panel.querySelector('.pnds-incoming')) < 0.01 &&
      opacity(panel.querySelector('[data-pnds-instruction]')) < 0.01,
    'Loading phase did not fade to only the fixed center loader'
  )
  assert(
    current() === first && first.inert,
    'Loading replaced the old Document'
  )
  const spin = spinner.getAnimations()[0]
  assert(
    spin && spin.effect.getTiming().iterations === Infinity,
    'Loader has no continuous rotation animation'
  )
  const before = getComputedStyle(spinner).transform
  const beforeTime = spin.currentTime
  await pause(170)
  assert(
    spin.currentTime > beforeTime &&
      getComputedStyle(spinner).transform !== before,
    'Rendered spinner remains stationary during real preparation'
  )
  // Activate the production reduced-motion CSS by changing only its media
  // condition; never change the user's system preference or the rule contents.
  const originalMedia = reducedRule.media.mediaText
  try {
    reducedRule.media.mediaText = 'all'
    const reducedSpin = await wait(() => {
      const animation = spinner.getAnimations()[0]
      return animation?.effect.getTiming().duration === 1600 && animation
    }, 'Production reduced-motion CSS removed the loading rotation')
    assert(
      reducedSpin.effect.getTiming().iterations === Infinity,
      'Reduced-motion loader does not rotate continuously'
    )
    const reducedBefore = getComputedStyle(spinner).transform
    const reducedBeforeTime = reducedSpin.currentTime
    await pause(170)
    assert(
      reducedSpin.currentTime > reducedBeforeTime &&
        getComputedStyle(spinner).transform !== reducedBefore,
      'Reduced-motion production spinner remains stationary'
    )
  } finally {
    reducedRule.media.mediaText = originalMedia
  }
  phase('loading')
  const second = await handoff(first)
  phase('second')
  await candidate(secondPerformance)
  const fast = await launch()
  const ready = await wait(() => {
    const frame = document.querySelector('[data-pnds-candidate]')
    return frame?.contentWindow.PNDS_PARTICIPATION?.preparation && frame
  }, 'Fast candidate did not report its actual preparation')
  assert(
    fast.flight.playState === 'running' && current() === second && ready.inert,
    'Fast preparation cancelled the active flight or adopted too early'
  )
  await fast.flight.finished
  if (fast.loadingFade.playState !== 'finished')
    assert(
      current() === second &&
        ready.inert &&
        !ready.classList.contains('is-revealing') &&
        !panel.classList.contains('is-handoff'),
      'Fast preparation started its handoff before the remaining loader fade'
    )
  await fast.loadingFade.finished
  await handoff(second)
  reducedRule.media.mediaText = initialMedia
  window.matchMedia = originalMatchMedia
  return {
    passed: true,
    fadeInOncePerCandidate: true,
    offscreenFlight: true,
    loadingOverlapsFlight: true,
    rotatingLoader: true,
    reducedMotionLoaderRotates: true,
    fastPreparationWaitsForFlight: true,
    fastPreparationWaitsForLoaderFade: true,
    loadingToScoreCrossfadesBeforeInput: true,
    reducedMotionPreference: forceReducedMotion,
    overlayTouchDefaultPrevented: true,
    scoreIframeKeepsTouch: true,
  }
}
