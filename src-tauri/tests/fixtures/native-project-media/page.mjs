const copy = await (await fetch('/copy.json')).json()
const query = new URLSearchParams(location.search)
const t = copy[query.get('lang')] ?? copy.en
document.documentElement.lang = query.get('lang') ?? 'en'
const element = id => document.getElementById(id)
for (const [id, key] of Object.entries({
  title: 'title',
  context: 'context',
  'camera-label': 'camera',
  'microphone-label': 'microphone',
  'start-camera': 'startCamera',
  'start-microphone': 'startMicrophone',
  stop: 'stop',
})) {
  element(id).textContent = t[key]
}
const consumer =
  globalThis.PNDS_MEDIA_SURFACE?.captureAllowed === false ||
  query.get('surface') === 'venue'
const role = globalThis.PNDS_MEDIA_SURFACE?.role ?? document.body.dataset.role
element('inputs').hidden = consumer
element('status').textContent = consumer ? t.consumer : t.idle
element('observations').textContent = t.observations
element('results').textContent = t.noResults
let identity = null
if (!consumer) {
  try {
    identity = localStorage.getItem('native-media-identity')
    if (!identity) {
      identity = `${role}-${crypto.randomUUID()}`
      localStorage.setItem('native-media-identity', identity)
    }
    element('identity').textContent = t.identity + identity
  } catch {
    identity = null
    element('start-camera').disabled = true
    element('start-microphone').disabled = true
    element('status').textContent = t.storage
  }
}
const owners = { camera: null, microphone: null }
const generations = { camera: 0, microphone: 0 }
const result = { cameraBrightness: null, microphoneRms: null }
let live = true

function release(kind) {
  const owner = owners[kind]
  owners[kind] = null
  if (!owner) return
  clearInterval(owner.timer)
  owner.worker?.terminate()
  owner.stream.getTracks().forEach(track => track.stop())
  void owner.context?.close()
  if (kind === 'camera') element('video').srcObject = null
  result[kind === 'camera' ? 'cameraBrightness' : 'microphoneRms'] = null
}

async function devices() {
  const list = await navigator.mediaDevices.enumerateDevices()
  for (const [kind, type] of [
    ['camera', 'videoinput'],
    ['microphone', 'audioinput'],
  ]) {
    const select = element(kind)
    const selected = select.value
    select.replaceChildren(new Option(t.default, ''))
    for (const device of list.filter(device => device.kind === type)) {
      select.add(
        new Option(
          device.label || `${t[kind]} ${select.options.length}`,
          device.deviceId
        )
      )
    }
    select.value = [...select.options].some(option => option.value === selected)
      ? selected
      : ''
  }
}

async function enable(kind) {
  if (!live || consumer || !identity) return
  const generation = ++generations[kind]
  const selected = element(kind).value
  let acquired = null
  try {
    acquired = await navigator.mediaDevices.getUserMedia({
      video:
        kind === 'camera'
          ? selected
            ? { deviceId: { exact: selected } }
            : true
          : false,
      audio:
        kind === 'microphone'
          ? selected
            ? { deviceId: { exact: selected } }
            : true
          : false,
    })
    if (!live || generation !== generations[kind]) {
      acquired.getTracks().forEach(track => track.stop())
      return
    }
    release(kind)
    const owner = { stream: acquired }
    owners[kind] = owner
    if (kind === 'camera') {
      const video = element('video')
      video.srcObject = acquired
      await video.play()
      if (!live || owners[kind] !== owner) return
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 24
      const context = canvas.getContext('2d', { willReadFrequently: true })
      owner.worker = new Worker('/analysis-worker.mjs', { type: 'module' })
      owner.worker.onmessage = event => {
        if (live && owners[kind] === owner) result.cameraBrightness = event.data
      }
      owner.timer = setInterval(() => {
        if (!live || owners[kind] !== owner || video.readyState < 2) return
        context.drawImage(video, 0, 0, 32, 24)
        const pixels = context.getImageData(0, 0, 32, 24).data
        owner.worker.postMessage(pixels, [pixels.buffer])
      }, 200)
    } else {
      owner.context = new AudioContext()
      const source = owner.context.createMediaStreamSource(acquired)
      const analyser = owner.context.createAnalyser()
      source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      await owner.context.resume()
      if (!live || owners[kind] !== owner) return
      owner.timer = setInterval(() => {
        if (!live || owners[kind] !== owner) return
        analyser.getFloatTimeDomainData(samples)
        result.microphoneRms = Math.min(
          1,
          Math.sqrt(
            samples.reduce((sum, sample) => sum + sample * sample, 0) /
              samples.length
          )
        )
      }, 200)
    }
    element('status').textContent = t.active
    await devices()
  } catch (error) {
    if (!live || generation !== generations[kind]) {
      acquired?.getTracks().forEach(track => track.stop())
      return
    }
    if (owners[kind]?.stream === acquired) release(kind)
    else acquired?.getTracks().forEach(track => track.stop())
    element('status').textContent = t.failed + error.name
  }
}

element('start-camera').onclick = () => {
  void enable('camera')
}
element('start-microphone').onclick = () => {
  void enable('microphone')
}
element('stop').onclick = () => {
  for (const kind of Object.keys(owners)) {
    generations[kind]++
    release(kind)
  }
  element('status').textContent = t.idle
}
if (!consumer)
  void devices().catch(error => {
    element('status').textContent = t.failed + error.name
  })

// Only derived numbers cross the project connection. Projection does not
// instantiate an AudioContext, camera stream or analysis Worker.
let polling = false
const poll = setInterval(async () => {
  if (!live || polling) return
  polling = true
  try {
    if (!consumer && identity)
      await fetch('/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: identity, ...result }),
      })
    const results = await (await fetch('/results')).json()
    if (live)
      element('results').textContent = results.length
        ? JSON.stringify(results, null, 2)
        : t.noResults
  } catch {
    if (live) {
      element('status').textContent = t.network
      element('results').textContent = t.noResults
    }
  } finally {
    polling = false
  }
}, 250)

addEventListener(
  'pagehide',
  () => {
    live = false
    clearInterval(poll)
    for (const kind of Object.keys(owners)) {
      generations[kind]++
      release(kind)
    }
  },
  { once: true }
)
