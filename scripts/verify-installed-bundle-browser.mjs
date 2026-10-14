#!/usr/bin/env node
// Invoked after actual pack/install by the ignored Rust acceptance seam.
import assert from 'node:assert/strict'
import process from 'node:process'
import { createRequire } from 'node:module'

const options = {}
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index]
  if (
    ![
      '--playwright-module',
      '--browser-executable',
      '--origin',
      '--expected-version',
    ].includes(key) ||
    !process.argv[index + 1]
  )
    throw new Error(`Unknown or incomplete argument: ${key}`)
  options[key] = process.argv[++index]
}
for (const key of [
  '--playwright-module',
  '--browser-executable',
  '--origin',
  '--expected-version',
])
  assert.ok(options[key], `Required: ${key}`)
const origin = new URL(options['--origin'])
assert.equal(origin.protocol, 'http:')
assert.equal(origin.hostname, '127.0.0.1')
const { chromium } = createRequire(import.meta.url)(
  options['--playwright-module']
)
const browser = await chromium.launch({
  executablePath: options['--browser-executable'],
  headless: true,
  args: [
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
  ],
})
const timeout = setTimeout(() => {
  void browser.close()
}, 30000)
try {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  })
  let blocked = 0
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin.origin)
      return route.continue()
    blocked++
    return route.abort('internetdisconnected')
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  async function verifyDrawing() {
    await page.waitForFunction(
      () => {
        const canvas = globalThis.document.querySelector('canvas')
        const pixel = canvas?.getContext('2d')?.getImageData(5, 5, 1, 1).data
        return (
          pixel &&
          pixel[0] === 20 &&
          pixel[1] === 40 &&
          pixel[2] === 60 &&
          pixel[3] === 255
        )
      },
      undefined,
      { timeout: 10000 }
    )
    const result = await page.evaluate(() => {
      const canvas = globalThis.document.querySelector('canvas')
      return {
        pixel: [...canvas.getContext('2d').getImageData(5, 5, 1, 1).data],
        width: canvas.width,
        height: canvas.height,
        version: globalThis.p5.VERSION,
      }
    })
    assert.deepEqual(result.pixel, [20, 40, 60, 255])
    assert.equal(result.version, options['--expected-version'])
    assert.equal(result.width, 64)
    assert.equal(result.height, 64)
    assert.deepEqual(errors, [])
    return result
  }
  await page.goto(origin.href, { waitUntil: 'load', timeout: 10000 })
  const cold = await verifyDrawing()
  // Demonstrate that the browser's outside-origin denial is effective.
  const unavailable = await page.evaluate(async () => {
    try {
      await fetch('https://offline-proof.invalid/')
      return false
    } catch {
      return true
    }
  })
  assert.ok(unavailable)
  assert.equal(blocked, 1)
  await page.reload({ waitUntil: 'load', timeout: 10000 })
  const refreshed = await verifyDrawing()
  process.stdout.write(
    JSON.stringify({
      cold,
      refreshed,
      outsideRequestsBlocked: blocked,
      browser: await browser.version(),
    }) + '\n'
  )
  await context.close()
} finally {
  clearTimeout(timeout)
  await browser.close()
}
