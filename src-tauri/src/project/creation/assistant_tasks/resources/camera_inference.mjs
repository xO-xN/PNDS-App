/* global process, URL, document, EventTarget, window, navigator, PNDS_CAMERA_HANDPOSE, cameraProbe, console */
// Real local ml5/model/Worker inference over controlled black pixels; no physical camera claim.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const {
  chromium,
} = require('/Users/xiaoxiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const origin = process.argv[2]
const browser = await chromium.launch({
  executablePath: process.env.PNDS_HANDPOSE_CHROMIUM,
  headless: true,
})
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const external = [],
    models = []
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      external.push(url.href)
      return route.abort()
    }
    if (/model.json|group1-shard/.test(url.pathname)) models.push(url.pathname)
    return route.continue()
  })
  const page = await context.newPage()
  await page.goto(origin)
  await page.addScriptTag({ url: origin + '/libraries/p5.min.js' })
  for (const name of ['handpose-worker-client.js', 'camera-handpose.js'])
    await page.addScriptTag({
      url: origin + '/modules/pnds-camera-handpose/' + name,
    })
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    canvas.getContext('2d').fillRect(0, 0, 64, 64)
    Object.assign(canvas, {
      videoWidth: 64,
      videoHeight: 64,
      readyState: 2,
      play: async () => {
        /* Controlled black-frame source, not a physical camera. */
      },
    })
    const track = new EventTarget()
    track.stop = () => {
      window.cameraProbe.stops++
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    })
    window.cameraProbe = { states: [], samples: [], stops: 0 }
    const owner = PNDS_CAMERA_HANDPOSE.createCameraHandPose({
      video: canvas,
      baseUrl: '/modules/pnds-camera-handpose/',
      onState: value => cameraProbe.states.push(value),
      onSample: sample => {
        cameraProbe.samples.push(sample)
        owner.stop()
      },
    })
    window.cameraOwner = owner
    void owner.start()
  })
  await page.waitForFunction(
    () =>
      window.cameraProbe.samples.length ||
      window.cameraProbe.states.some(value =>
        ['failed', 'denied', 'unavailable'].includes(value.phase)
      ),
    { timeout: 120000 }
  )
  const result = await page.evaluate(() => ({
    ...window.cameraProbe,
    mainThreadMl5: Boolean(window.ml5),
    p5: typeof window.p5,
  }))
  assert.equal(result.samples.length, 1, JSON.stringify(result))
  assert.deepEqual(result.samples[0], { hands: [], actions: [] })
  assert.equal(result.mainThreadMl5, false)
  assert.equal(result.p5, 'function')
  assert.ok(result.stops >= 1)
  assert.ok(result.states.some(value => value.phase === 'inference-ready'))
  assert.deepEqual(external, [])
  assert.equal(new Set(models).size, 4)
  console.log(
    JSON.stringify({
      boundary:
        'real ml5 1.4.0 + complete pinned models in Worker, controlled black frame, no physical camera or hand',
      browser: browser.version(),
      samples: result.samples,
      phases: result.states.map(value => value.phase),
      modelRequests: [...new Set(models)],
      externalRequests: external,
      cameraTrackReleases: result.stops,
      mainThreadMl5: result.mainThreadMl5,
    })
  )
} finally {
  await browser.close()
}
