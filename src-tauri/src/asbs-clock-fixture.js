/* global window, addEventListener, performance, setInterval, CanvasRenderingContext2D, URL, location, setTimeout */
;(() => {
  const frames = new Map(),
    blobNames = new WeakMap(),
    bitmapNames = new WeakMap()
  let next = 0,
    clock = 0
  window.fixtureToken = Math.random().toString(36)
  window.fixtureTicks = 0
  window.fixtureKeys = 0
  setInterval(() => window.fixtureTicks++, 10)
  addEventListener('keydown', () => window.fixtureKeys++)
  const evidence = (window.__asbsEvidence = {
    decoded: [],
    drawn: [],
    live: 0,
    peak: 0,
    errors: [],
    document: Math.random().toString(36),
    resourceRequests: [],
  })
  addEventListener('error', event => evidence.errors.push(event.message))
  const originalError = window.console.error.bind(window.console)
  window.console.error = (...args) => {
    evidence.errors.push(args.map(String).join(' '))
    originalError(...args)
  }
  Object.defineProperty(performance, 'now', { value: () => clock })
  window.requestAnimationFrame = callback => {
    frames.set(++next, callback)
    return next
  }
  window.cancelAnimationFrame = id => frames.delete(id)
  window.__asbsAdvance = async milliseconds => {
    clock += milliseconds
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(clock)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  window.__asbsSockets = []
  let socketFactory
  Object.defineProperty(window, 'io', {
    configurable: true,
    get: () => socketFactory,
    set(value) {
      socketFactory = (...args) => {
        const socket = value(...args)
        window.__asbsSockets.push(socket)
        socket.on('position', () => {
          evidence.positions = (evidence.positions || 0) + 1
        })
        socket.on('connect', () => {
          evidence.connections = (evidence.connections || 0) + 1
        })
        return socket
      }
    },
  })
  const originalFetch = window.fetch
  window.fetch = async (...args) => {
    const response = await originalFetch(...args)
    const url = new URL(args[0], location.href)
    if (url.pathname.includes('/libraries/')) {
      evidence.resourceRequests.push(url.pathname)
      if (!response.ok)
        evidence.errors.push('HTTP ' + response.status + ' ' + url.pathname)
      const originalBlob = response.blob.bind(response)
      response.blob = async () => {
        const blob = await originalBlob()
        blobNames.set(blob, url.pathname)
        return blob
      }
    }
    return response
  }
  const originalBitmap = window.createImageBitmap
  if (originalBitmap)
    window.createImageBitmap = async (...args) => {
      const bitmap = await originalBitmap(...args)
      const name = blobNames.get(args[0])
      bitmapNames.set(bitmap, name)
      evidence.decoded.push(name)
      evidence.live++
      evidence.peak = Math.max(evidence.peak, evidence.live)
      const originalClose = bitmap.close.bind(bitmap)
      let closed = false
      bitmap.close = () => {
        if (!closed) {
          closed = true
          evidence.live--
        }
        originalClose()
      }
      return bitmap
    }
  const objectNames = new Map()
  const originalObjectUrl = URL.createObjectURL.bind(URL)
  URL.createObjectURL = blob => {
    const url = originalObjectUrl(blob)
    objectNames.set(url, blobNames.get(blob))
    return url
  }
  const originalDecode = window.HTMLImageElement.prototype.decode
  window.HTMLImageElement.prototype.decode = async function () {
    await originalDecode.call(this)
    const name = objectNames.get(this.src)
    if (name) {
      bitmapNames.set(this, name)
      evidence.decoded.push(name)
    }
  }
  const originalDraw = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
    const name = bitmapNames.get(image)
    if (name && !evidence.drawn.includes(name)) evidence.drawn.push(name)
    return originalDraw.call(this, image, ...args)
  }
})()
