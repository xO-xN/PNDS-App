// A gesture confirms only the identity that was displayed when it began.
// The entry owner keeps confirmation, page preparation and navigation authority.
globalThis.createPndsEntryGesture = ({
  ball,
  arrow,
  band,
  onConfirm,
  onIntent = () => undefined,
}) => {
  const document = ball.ownerDocument
  const view = document.defaultView
  const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)')
  const rest = { x: 120, y: 110 }
  const listeners = []
  let binding = { key: null, enabled: false, busy: false }
  let bindingEpoch = 0
  let motionEpoch = 0
  let grip = null
  let pull = { x: 0, y: 0 }
  let frame = 0
  let hintAnimation = null
  let flightAnimation = null
  let hintedKey = null
  let confirmed = false
  let disposed = false
  let lastIntent = ''

  const usable = () =>
    !disposed && binding.enabled && !binding.busy && binding.key && !confirmed
  const matches = (event, mode) =>
    grip &&
    grip.mode === mode &&
    (mode === 'mouse' || grip.id === event.pointerId) &&
    !(event.timeStamp < grip.started)
  const hasIntent = speed =>
    Math.hypot(pull.x, pull.y) >= 18 ||
    (Math.hypot(pull.x, pull.y) >= 8 && speed >= 0.22)

  function emitIntent(armed = false, dragging = false, light = false) {
    const next = JSON.stringify([armed, dragging, light])
    if (next === lastIntent) return
    lastIntent = next
    onIntent({ armed, dragging, light })
  }
  function listen(target, type, handler) {
    target.addEventListener(type, handler)
    listeners.push(() => target.removeEventListener(type, handler))
  }
  function paint(x, y) {
    pull = { x, y }
    ball.style.transform = `translate(${x}px, ${y}px)`
    const socket = 40,
      edge = 35,
      distance = Math.hypot(x, y)
    if (distance <= socket - edge) {
      band.setAttribute(
        'd',
        `M${rest.x - socket},${rest.y}a${socket},${socket} 0 1,0 ${socket * 2},0a${socket},${socket} 0 1,0 ${-socket * 2},0Z`
      )
    } else {
      const theta = Math.atan2(y, x),
        normal = Math.acos((socket - edge) / distance)
      const point = (cx, cy, radius, angle) =>
        `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`
      band.setAttribute(
        'd',
        `M${point(rest.x, rest.y, socket, theta + normal)}L${point(rest.x + x, rest.y + y, edge, theta + normal)}A${edge},${edge} 0 0,0 ${point(rest.x + x, rest.y + y, edge, theta - normal)}L${point(rest.x, rest.y, socket, theta - normal)}A${socket},${socket} 0 1,0 ${point(rest.x, rest.y, socket, theta + normal)}Z`
      )
    }
    arrow.style.transform =
      grip && distance > 2
        ? `rotate(${(Math.atan2(-x, y) * 180) / Math.PI}deg)`
        : 'rotate(0deg)'
  }
  function stopMotion() {
    motionEpoch += 1
    view.cancelAnimationFrame(frame)
    frame = 0
    hintAnimation?.cancel()
    flightAnimation?.cancel()
    hintAnimation = flightAnimation = null
  }
  function releaseCapture() {
    const previous = grip
    grip = null
    if (previous?.id != null && ball.hasPointerCapture?.(previous.id))
      ball.releasePointerCapture(previous.id)
  }
  function syncDisabled() {
    ball.disabled = !usable()
  }
  function reset() {
    releaseCapture()
    stopMotion()
    confirmed = false
    paint(0, 0)
    if (!disposed) emitIntent()
    syncDisabled()
  }
  function hint() {
    if (!usable() || hintedKey === binding.key) return
    hintedKey = binding.key
    if (reducedMotion.matches) return
    hintAnimation = arrow.animate(
      [0, -24, 24, -12, 8, 0].map(angle => ({
        transform: `rotate(${angle}deg)`,
      })),
      { duration: 680, easing: 'ease-in-out' }
    )
  }
  function springHome(from, light = false) {
    releaseCapture()
    stopMotion()
    emitIntent(false, false, light)
    if (reducedMotion.matches) {
      paint(0, 0)
      return
    }
    const start = view.performance.now(),
      epoch = motionEpoch
    const tick = now => {
      if (disposed || epoch !== motionEpoch) return
      const elapsed = Math.min((now - start) / 1000, 0.55)
      const spring = Math.exp(-12 * elapsed) * Math.cos(17 * elapsed)
      paint(from.x * spring, from.y * spring)
      if (elapsed < 0.55) frame = view.requestAnimationFrame(tick)
      else {
        frame = 0
        paint(0, 0)
      }
    }
    frame = view.requestAnimationFrame(tick)
  }
  function launch(from, speed) {
    stopMotion()
    paint(0, 0)
    if (reducedMotion.matches) return
    const distance = Math.hypot(from.x, from.y)
    const direction = distance
      ? { x: -from.x / distance, y: -from.y / distance }
      : { x: 0, y: -1 }
    const reach = Math.min(360, 140 + distance + speed * 110)
    arrow.style.transform = `rotate(${(Math.atan2(direction.x, -direction.y) * 180) / Math.PI}deg)`
    flightAnimation = ball.animate(
      [
        { transform: `translate(${from.x}px,${from.y}px)`, opacity: 1 },
        {
          transform: `translate(${direction.x * reach}px,${direction.y * reach}px)`,
          opacity: 0,
        },
      ],
      {
        duration: 420,
        easing: 'cubic-bezier(.18,.7,.25,1)',
        fill: 'forwards',
      }
    )
  }
  function confirm(from, speed) {
    if (!usable()) return
    const key = binding.key,
      epoch = bindingEpoch
    confirmed = true
    releaseCapture()
    const accepted = onConfirm(key) === true
    if (disposed || epoch !== bindingEpoch) return
    if (accepted) {
      launch(from, speed)
      emitIntent()
    } else {
      confirmed = false
      springHome(from)
    }
    syncDisabled()
  }
  function startGrip(event, mode) {
    if (!usable() || grip || event.button !== 0) return
    event.preventDefault()
    stopMotion()
    paint(0, 0)
    grip = {
      mode,
      id: mode === 'mouse' ? null : event.pointerId,
      key: binding.key,
      epoch: bindingEpoch,
      started: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      samples: [
        { x: event.clientX, y: event.clientY, t: view.performance.now() },
      ],
    }
    if (mode === 'pointer') {
      try {
        ball.setPointerCapture?.(event.pointerId)
      } catch {
        // Window listeners still own the gesture if capture is unavailable.
      }
    }
    ball.focus({ preventScroll: true })
    emitIntent(false, true)
  }
  function sample(event) {
    const now = view.performance.now()
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      grip.lastX = event.clientX
      grip.lastY = event.clientY
    }
    grip.samples.push({ x: grip.lastX, y: grip.lastY, t: now })
    grip.samples = grip.samples.filter(value => now - value.t <= 100)
    const oldest = grip.samples[0],
      elapsed = now - oldest.t
    const speed =
      elapsed >= 8
        ? Math.hypot(grip.lastX - oldest.x, grip.lastY - oldest.y) / elapsed
        : 0
    const x = grip.lastX - grip.x,
      y = grip.lastY - grip.y,
      raw = Math.hypot(x, y)
    const radius = raw <= 72 ? raw : 72 + 46 * Math.tanh((raw - 72) / 46)
    const scale = raw ? radius / raw : 1
    paint(x * scale, y * scale)
    return speed
  }
  function move(event, mode) {
    if (!matches(event, mode)) return
    const speed = sample(event)
    emitIntent(hasIntent(speed), true)
  }
  function release(event, mode, cancelled = false) {
    if (!matches(event, mode)) return
    if (mode === 'mouse' && !cancelled && event.button !== 0) return
    const speed = cancelled ? 0 : sample(event)
    const from = { ...pull }
    const valid =
      !cancelled &&
      usable() &&
      grip.key === binding.key &&
      grip.epoch === bindingEpoch &&
      hasIntent(speed)
    releaseCapture()
    if (valid) confirm(from, speed)
    else springHome(from, !cancelled)
  }
  function cancel() {
    if (grip) springHome({ ...pull })
  }

  listen(ball, 'pointerdown', event => {
    if (event.isPrimary) startGrip(event, 'pointer')
  })
  // Safari may close a native select popup without delivering pointerdown.
  listen(ball, 'mousedown', event => startGrip(event, 'mouse'))
  listen(view, 'pointermove', event => move(event, 'pointer'))
  listen(view, 'pointerup', event => release(event, 'pointer'))
  listen(view, 'pointercancel', event => release(event, 'pointer', true))
  listen(view, 'mousemove', event => move(event, 'mouse'))
  listen(view, 'mouseup', event => release(event, 'mouse'))
  listen(ball, 'lostpointercapture', event => {
    if (matches(event, 'pointer') && !ball.hasPointerCapture?.(event.pointerId))
      release(event, 'pointer', true)
  })
  listen(view, 'blur', cancel)
  listen(document, 'visibilitychange', () => {
    if (document.hidden) cancel()
  })
  listen(ball, 'keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!event.repeat) confirm({ ...pull }, 0)
    } else if (event.key === 'Escape' && grip) {
      event.preventDefault()
      cancel()
    }
  })
  listen(document, 'keydown', event => {
    if (event.key === 'Escape' && grip) {
      event.preventDefault()
      cancel()
    }
  })
  listen(ball, 'click', event => {
    event.preventDefault()
    if (event.detail === 0) confirm({ ...pull }, 0)
  })

  paint(0, 0)
  syncDisabled()
  return {
    update(next) {
      if (disposed) return
      const changed = binding.key !== next.key
      const recovering = binding.busy && !next.busy
      const blocking =
        (!binding.busy && next.busy) ||
        (binding.enabled && !next.enabled && !next.busy)
      binding = { ...next }
      if (changed) {
        bindingEpoch += 1
        hintedKey = null
      }
      if (changed || recovering || blocking) reset()
      syncDisabled()
      hint()
    },
    reset,
    dispose() {
      if (disposed) return
      disposed = true
      reset()
      listeners.splice(0).forEach(remove => remove())
    },
  }
}
