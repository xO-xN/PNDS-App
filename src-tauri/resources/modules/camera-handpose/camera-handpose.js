/* global HandPoseWorkerClient */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.PNDS_CAMERA_HANDPOSE = factory()
})(globalThis, function () {
  function createHandFeatures() {
    let previous = new Map()
    return (hands, width, height) => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Array.isArray(hands) || hands.length > 2) throw new Error('Invalid HandPose frame')
      const next = hands.map(hand => {
        if (!Array.isArray(hand.keypoints) || hand.keypoints.length !== 21) throw new Error('Invalid HandPose landmarks')
        const keypoints = hand.keypoints.map(point => {
          if (![point.x, point.y].every(Number.isFinite)) throw new Error('Invalid HandPose coordinate')
          return { x: point.x / width, y: point.y / height, z: Number.isFinite(point.z) ? point.z / width : null }
        })
        const distance = (a, b) => Math.hypot(keypoints[a].x - keypoints[b].x, (keypoints[a].y - keypoints[b].y) * height / width)
        const scale = distance(0, 9)
        if (scale <= 0) throw new Error('Invalid HandPose palm size')
        const pinch = distance(4, 8) / scale < 0.35
        const open = [8, 12, 16, 20].every(index => distance(0, index) > distance(0, index - 2) * 1.2) && !pinch
        return { keypoints, handedness: ['Left', 'Right'].includes(hand.handedness) ? hand.handedness : 'Unknown', pinch, open }
      })
      // Discrete edges belong to unique model Left/Right labels, not unstable array order.
      const stable = new Map()
      for (const name of ['Left', 'Right']) {
        const matching = next.filter(hand => hand.handedness === name)
        if (matching.length === 1) stable.set(name, matching[0])
      }
      const actions = []
      for (const [hand, name] of ['Left', 'Right'].entries()) {
        for (const [key, start, end] of [['pinch', 'pinch-start', 'pinch-end'], ['open', 'open-start', 'open-end']]) {
          if (Boolean(previous.get(name)?.[key]) !== Boolean(stable.get(name)?.[key])) actions.push({ hand, type: stable.get(name)?.[key] ? start : end })
        }
      }
      previous = stable
      return { hands: next, actions }
    }
  }

  function createCameraHandPose({ video, baseUrl, onSample, onState = () => {}, projection = false, isOwner = () => true, platform = globalThis }) {
    const base = new URL(baseUrl, platform.location.href)
    if (base.origin !== platform.location.origin) throw new Error('Camera assets must be same-origin')
    let generation = 0, stream = null, model = null, frame = null, stopped = false, waiting = null
    const state = (phase, error = null, input = null) => onState({ phase, error, input })
    const release = () => {
      generation += 1
      const cancel = waiting
      waiting = null
      cancel?.(new Error('Camera activation cancelled'))
      if (frame !== null) platform.cancelAnimationFrame(frame)
      frame = null
      model?.dispose()
      model = null
      const owned = stream
      stream = null
      owned?.getTracks().forEach(track => track.stop())
      video.srcObject = null
    }
    const stop = () => { release(); state('stopped') }
    const background = () => { if (platform.document.hidden) { release(); state('background') } }
    const leave = () => { stopped = true; release() }
    platform.document.addEventListener('visibilitychange', background)
    platform.addEventListener('pagehide', leave)
    async function start({ deviceId, facingMode = 'user' } = {}) {
      release()
      const owner = generation
      const allowed = () => !projection && isOwner() && platform.PNDS_MEDIA_SURFACE?.captureAllowed !== false && new URL(platform.location.href).searchParams.get('surface') !== 'venue'
      const current = () => !stopped && generation === owner && !platform.document.hidden && allowed()
      const active = () => {
        if (current()) return true
        if (generation === owner) { release(); state('paused') }
        return false
      }
      if (stopped || !allowed() || platform.document.hidden) { state('unavailable', 'This page does not own camera capture'); return false }
      if (!platform.isSecureContext || !platform.navigator.mediaDevices?.getUserMedia) { state('restricted', 'A trusted secure context is required'); return false }
      if (!platform.HandPoseWorkerClient?.supported(platform)) { state('unavailable', 'Worker canvas support is required'); return false }
      state('requesting-camera')
      if (!active()) return false
      try {
        const acquired = await platform.navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facingMode } } })
        if (!active()) { acquired.getTracks().forEach(track => track.stop()); return false }
        stream = acquired
        const settings = stream.getVideoTracks?.()[0]?.getSettings?.() ?? {}
        state('camera-selected', null, { requestedFacingMode: deviceId ? null : facingMode, deviceId: settings.deviceId ?? null, facingMode: settings.facingMode ?? null })
        if (!active()) return false
        for (const track of stream.getTracks()) track.addEventListener('ended', () => { if (current()) { release(); state('device-lost') } })
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play()
        if (!active()) return false
        state('waiting-frame')
        if (!active()) return false
        await new Promise((resolve, reject) => {
          waiting = reject
          const started = platform.performance.now()
          const poll = () => {
            if (!active()) return reject(new Error('Camera activation cancelled'))
            if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) { waiting = null; return resolve() }
            if (platform.performance.now() - started > 10000) return reject(new Error('Camera produced no frame'))
            frame = platform.requestAnimationFrame(poll)
          }
          poll()
        })
        if (!active()) return false
        state('frame-ready')
        if (!active()) return false
        const created = platform.HandPoseWorkerClient.createModel({ runtime: 'tfjs', modelType: 'lite', maxHands: 2, flipped: false, detectorModelUrl: new URL('handpose/detector/model.json', base).href, landmarkModelUrl: new URL('handpose/landmark/model.json', base).href }, { platform, workerUrl: new URL('handpose-worker.js', base).href, scriptSrc: new URL('ml5.js', base).href, onProgress: phase => { if (active()) state(phase) } })
        if (!active()) { created.dispose(); return false }
        model = created
        const ownedModel = created
        await ownedModel.ready
        if (!active()) return false
        state('model-ready')
        if (!active()) return false
        const derive = createHandFeatures()
        const tick = async () => {
          if (!active()) return
          try {
            const { hands, width, height } = await ownedModel.detect(video)
            if (!active()) return
            const result = derive(hands, width, height)
            state('inference-ready')
            if (!active()) return
            onSample(result)
            if (active()) frame = platform.requestAnimationFrame(tick)
          } catch (error) { if (active()) { release(); state('failed', error.message) } }
        }
        void tick()
        return true
      } catch (error) {
        if (active()) { release(); state(error.name === 'NotAllowedError' ? 'denied' : error.name === 'NotFoundError' ? 'unavailable' : 'failed', error.message) }
        return false
      }
    }
    return {
      start, stop,
      async devices() { return (await platform.navigator.mediaDevices?.enumerateDevices() ?? []).filter(device => device.kind === 'videoinput').map(({ deviceId, label }) => ({ deviceId, label })) },
      dispose() { leave(); platform.document.removeEventListener('visibilitychange', background); platform.removeEventListener('pagehide', leave) },
    }
  }
  function mountCameraControls({ element, baseUrl, send, canSend = () => false, messages, onState = () => {}, platform = globalThis }) {
    for (const key of ['enable', 'stop', 'input', 'front', 'back', 'unnamed']) if (typeof messages?.[key] !== 'string' || !messages[key]) throw new Error(`Missing camera control message: ${key}`)
    const make = name => platform.document.createElement(name)
    const panel = make('section'), video = make('video'), enable = make('button'), stop = make('button'), label = make('label'), select = make('select'), status = make('p')
    enable.type = stop.type = 'button'
    enable.textContent = messages.enable; stop.textContent = messages.stop
    label.append(messages.input, select)
    for (const [value, text] of [['__user', messages.front], ['__environment', messages.back]]) { const option = make('option'); option.value = value; option.textContent = text; select.append(option) }
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    video.hidden = true
    panel.append(label, enable, stop, status, video)
    element.append(panel)
    let version = 0
    const owner = createCameraHandPose({ video, baseUrl, platform, onSample: sample => { if (canSend()) send({ kind: 'camera-handpose', ...sample }) }, onState: value => { status.textContent = messages[value.phase] ?? value.phase; onState(value) } })
    const activate = async () => {
      const current = ++version
      const selected = select.value
      const started = await owner.start(selected.startsWith('__') ? { facingMode: selected.slice(2) } : { deviceId: selected })
      if (!started || current !== version) return
      try {
        const devices = await owner.devices()
        if (current !== version) return
        for (const option of [...select.options]) if (!option.value.startsWith('__')) option.remove()
        for (const device of devices) { const option = make('option'); option.value = device.deviceId; option.textContent = device.label || messages.unnamed; select.append(option) }
        select.value = selected
      } catch (error) { onState({ phase: 'device-list-failed', error: error.message }) }
    }
    enable.addEventListener('click', activate)
    select.addEventListener('change', activate)
    stop.addEventListener('click', () => { version++; owner.stop() })
    return { owner, dispose() { version++; owner.dispose(); panel.remove() } }
  }
  return { createHandFeatures, createCameraHandPose, mountCameraControls }
})
