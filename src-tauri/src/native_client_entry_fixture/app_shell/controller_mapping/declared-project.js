/* global document, window, devicePixelRatio */
;(() => {
  let presses = 0
  let positionlessValue = 50
  let latched = false
  const board = document.createElement('canvas')
  board.id = 'fixture-declared-region'
  board.setAttribute('aria-label', 'Canvas pulse')
  board.style.cssText =
    'position:fixed;left:81vw;top:43vh;width:17vw;height:14vh;z-index:2147483647'
  ;(document.getElementById('fixture-solid-score') ?? document.body).append(
    board
  )

  function paint() {
    const width = board.clientWidth
    const height = board.clientHeight
    const ratio = devicePixelRatio
    board.width = Math.max(1, Math.round(width * ratio))
    board.height = Math.max(1, Math.round(height * ratio))
    const context = board.getContext('2d')
    context.scale(ratio, ratio)
    context.fillStyle = '#21342c'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#fff'
    context.font = '14px sans-serif'
    context.fillText(`Canvas pulse · ${presses}`, 10, 24)
    context.fillText(`Wet mix · ${positionlessValue}`, 10, 45)
    context.fillText(`Latch · ${latched ? 'on' : 'off'}`, 10, 66)
  }

  function pulse() {
    presses++
    paint()
  }

  function setWetMix(value) {
    positionlessValue = value
    paint()
  }

  function setLatch(value) {
    latched = value
    paint()
  }

  board.addEventListener('click', pulse)
  window.addEventListener('resize', paint)
  paint()

  const api = window.PNDSControllerMapping
  const registerPulse = () =>
    api?.register({
      id: 'canvas-pulse',
      name: 'Canvas pulse',
      kind: 'trigger',
      position: () => board.getBoundingClientRect(),
      trigger: pulse,
    })
  let forgetPulse = registerPulse()
  api?.register({
    id: 'wet-mix',
    name: 'Wet mix',
    kind: 'continuous',
    min: 0,
    max: 100,
    step: 5,
    getValue: () => positionlessValue,
    setValue: setWetMix,
  })
  api?.register({
    id: 'latch',
    name: 'Latch',
    kind: 'switch',
    getValue: () => latched,
    setValue: setLatch,
  })
  window.fixtureDeclaredTargets = {
    result: () => ({ presses, wetMix: positionlessValue, latched }),
    removePulse: () => forgetPulse?.(),
    restorePulse: () => {
      const old = forgetPulse
      board.style.left = '79vw'
      forgetPulse = registerPulse()
      old?.()
    },
  }
})()
