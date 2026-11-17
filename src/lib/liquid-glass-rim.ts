/*!
 * @license MIT
 * Rainbow-rim content optics, adapted from liquid-glass.js v1.0.0.
 * https://github.com/gentpan/liquidglass/blob/main/lib/liquid-glass.js
 * The full license is also distributed at /licenses/LIQUID-GLASS.txt via public/.
 * The approved prototype's optical model is unchanged; backdrop, pointer,
 * arbitrary lens position and public parameter mutation APIs are omitted.
 *
MIT License

Copyright (c) 2026 gentpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

 */

const NS = 'http://www.w3.org/2000/svg'
const XLINK = 'http://www.w3.org/1999/xlink'
const NEUTRAL = 128
const MAP_CACHE_SIZE = 48
const OPTICS = Object.freeze({
  bezel: 1,
  curvature: 2.5,
  ior: 1.5,
  invert: false,
  chroma: 0.12,
  specular: 0.25,
  specularWidth: 2,
  lightAngle: -120,
})
type LensParameters = typeof OPTICS & {
  width: number
  height: number
  radius: number
  refraction: number
}
type Engine = 'blink' | 'webkit' | 'gecko' | 'unknown'

function detectEngine(): Engine {
  if (typeof navigator === 'undefined') return 'unknown'
  const brands = (
    navigator as Navigator & {
      userAgentData?: { brands: { brand: string }[] }
    }
  ).userAgentData?.brands
  if (brands?.some(b => /Chromium/.test(b.brand))) return 'blink'
  const ua = navigator.userAgent
  if (/Firefox\//.test(ua)) return 'gecko'
  if (/AppleWebKit\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua))
    return 'webkit'
  return /Chrome\//.test(ua) ? 'blink' : 'unknown'
}

const profileCache = new Map<string, Float32Array>()

// The glass surface and Snell-law profile are copied from the approved engine.
function profileTable(curvature: number, ior: number) {
  const key = `${curvature}|${ior}`
  let table = profileCache.get(key)
  if (table) return table
  const N = 512
  table = new Float32Array(N + 1)
  let max = 0
  for (let i = 0; i <= N; i++) {
    const s = Math.min(i / N, 1 - 1e-6)
    const a = Math.pow(1 - s, curvature)
    const slope =
      Math.pow(1 - s, curvature - 1) *
      Math.pow(Math.max(1 - a, 1e-9), 1 / curvature - 1)
    const theta = Math.atan(slope)
    const refracted = Math.asin(Math.sin(theta) / ior)
    const bend = Math.tan(theta - refracted)
    table[i] = bend
    if (bend > max) max = bend
  }
  for (let i = 0; i <= N; i++) table[i] = (table[i] ?? 0) / (max || 1)
  table[N] = 0
  profileCache.set(key, table)
  return table
}

/**
 * Paint the displacement map for the SVG content filter into a canvas.
 */
function renderLensMap(p: LensParameters, scale: number) {
  const w = Math.max(2, Math.round(p.width * scale))
  const h = Math.max(2, Math.round(p.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable')
  const image = ctx.createImageData(w, h)
  const px = image.data

  const sx = p.width / w // CSS px per map pixel (x); equals 1 / scale up to rounding
  const sy = p.height / h
  const hw = p.width / 2
  const hh = p.height / 2
  const r = Math.max(0, Math.min(p.radius, hw, hh))
  const bezel = Math.max(0.5, p.bezel * Math.min(hw, hh))
  const table = profileTable(p.curvature, p.ior)
  const N = table.length - 1
  const rimWidth = Math.max(0.5, p.specularWidth)
  const aa = Math.max(sx, sy) // one map pixel of anti-aliasing at the rim
  const angle = (p.lightAngle * Math.PI) / 180
  const lx = Math.cos(angle)
  const ly = Math.sin(angle)
  const dir = p.invert ? -1 : 1

  // The rounded rectangle is symmetric in both axes: compute the top-left quadrant only and mirror
  // it, flipping the sign of the x bend across the vertical axis and of the y bend across the
  // horizontal axis. This keeps per-frame regeneration (squish, resize) inside the frame budget.
  const qw = Math.ceil(w / 2)
  const qh = Math.ceil(h / 2)
  for (let j = 0; j < qh; j++) {
    const y = (j + 0.5) * sy - hh // <= 0
    for (let i = 0; i < qw; i++) {
      const x = (i + 0.5) * sx - hw // <= 0
      // Signed distance to the rounded rectangle, evaluated on |p|.
      const qx = -x - (hw - r)
      const qy = -y - (hh - r)
      const ox = Math.max(qx, 0)
      const oy = Math.max(qy, 0)
      const corner = Math.hypot(ox, oy)
      const dist = corner + Math.min(Math.max(qx, qy), 0) - r // < 0 inside
      const alpha = Math.min(1, Math.max(0, 0.5 - dist / aa))
      if (alpha <= 0) continue // transparent: composited over neutral grey in the filter

      // Outward normal on |p| (points away from the centre).
      let nx
      let ny
      if (qx > 0 && qy > 0) {
        nx = ox / corner
        ny = oy / corner
      } else if (qx > qy) {
        nx = 1
        ny = 0
      } else {
        nx = 0
        ny = 1
      }

      const inset = Math.max(0, -dist)
      const s = inset / bezel
      const m = s >= 1 ? 0 : (table[Math.min(N, Math.round(s * N))] ?? 0)
      // Convex glass samples from further inside (towards the centre) near the rim.
      const bx = Math.round(127 * m * nx * dir)
      const by = Math.round(127 * m * ny * dir)

      // Rim highlight: a crisp line plus a softer inner glow, brightest where the rim faces the
      // light, with a dimmer reflection on the far side.
      const crisp = Math.max(0, 1 - inset / rimWidth)
      const glow = Math.max(0, 1 - inset / (rimWidth * 5))
      const rim = p.specular * (crisp * crisp + 0.3 * glow * glow)
      const a = Math.round(alpha * 255)

      const i2 = w - 1 - i
      const j2 = h - 1 - j
      // top-left: outward normal (-nx, -ny); sample towards +x/+y (inward)
      write(
        px,
        (j * w + i) * 4,
        NEUTRAL + bx,
        NEUTRAL + by,
        rimLight(rim, -nx * lx - ny * ly),
        a
      )
      if (i2 !== i)
        write(
          px,
          (j * w + i2) * 4,
          NEUTRAL - bx,
          NEUTRAL + by,
          rimLight(rim, nx * lx - ny * ly),
          a
        )
      if (j2 !== j)
        write(
          px,
          (j2 * w + i) * 4,
          NEUTRAL + bx,
          NEUTRAL - by,
          rimLight(rim, -nx * lx + ny * ly),
          a
        )
      if (i2 !== i && j2 !== j)
        write(
          px,
          (j2 * w + i2) * 4,
          NEUTRAL - bx,
          NEUTRAL - by,
          rimLight(rim, nx * lx + ny * ly),
          a
        )
    }
  }
  ctx.putImageData(image, 0, 0)
  return { canvas, width: w, height: h, scale }
}

// Blue channel for a rim pixel: `facing` is n·L for its outward normal.
function rimLight(rim: number, facing: number) {
  const shade = 0.12 + 0.88 * (facing > 0 ? facing : -0.4 * facing)
  return NEUTRAL + Math.round(127 * Math.min(1, rim * shade))
}

function write(
  px: Uint8ClampedArray,
  o: number,
  r: number,
  g: number,
  b: number,
  a: number
) {
  px[o] = r
  px[o + 1] = g
  px[o + 2] = b
  px[o + 3] = a
}

interface MapEntry {
  url: string
  decoded: boolean
  ready: Promise<boolean>
}
const mapCache = new Map<string, MapEntry>()

function lensMap(p: LensParameters, scale: number) {
  // Optics are fixed; only dimensions/radius/resolution can change this map.
  const key = `${p.width}|${p.height}|${p.radius}|${scale}`
  const cached = mapCache.get(key)
  if (cached) {
    mapCache.delete(key)
    mapCache.set(key, cached)
    return cached
  }
  const url = renderLensMap(p, scale).canvas.toDataURL('image/png')
  const image = new Image()
  const entry: MapEntry = { url, decoded: false, ready: Promise.resolve(false) }
  image.src = url
  entry.ready = image.decode().then(
    () => {
      entry.decoded = true
      return true
    },
    () => {
      if (mapCache.get(key) === entry) mapCache.delete(key)
      return false
    }
  )
  if (mapCache.size >= MAP_CACHE_SIZE) {
    const oldest = mapCache.keys().next().value
    if (oldest !== undefined) mapCache.delete(oldest)
  }
  mapCache.set(key, entry)
  return entry
}

let svgRoot: SVGSVGElement | null = null
let svgDefs: SVGDefsElement | null = null
function defsNode() {
  if (svgRoot?.isConnected && svgDefs) return svgDefs
  svgRoot = document.createElementNS(NS, 'svg')
  svgRoot.setAttribute('aria-hidden', 'true')
  svgRoot.setAttribute('width', '0')
  svgRoot.setAttribute('height', '0')
  // display:none breaks referenced SVG filters in some engines.
  svgRoot.style.cssText =
    'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  svgDefs = document.createElementNS(NS, 'defs')
  svgRoot.appendChild(svgDefs)
  document.body.appendChild(svgRoot)
  return svgDefs
}
function removeFilter(filter: SVGElement) {
  filter.remove()
  if (svgDefs && !svgDefs.hasChildNodes()) {
    svgRoot?.remove()
    svgRoot = null
    svgDefs = null
  }
}
function node(name: string, attrs: Record<string, string | number>) {
  const element = document.createElementNS(NS, name)
  for (const [key, value] of Object.entries(attrs))
    element.setAttribute(key, String(value))
  return element
}
const CHANNELS = [
  '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
  '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
  '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
]

// Fixed content graph: neutral map -> per-channel bend -> rim light -> lens mask.
function buildGraph(filter: SVGElement, engine: Engine) {
  const lensRect: SVGElement[] = []
  const add = (
    name: string,
    attrs: Record<string, string | number>,
    inLens = true
  ) => {
    const element = node(name, attrs)
    filter.appendChild(element)
    if (inLens) lensRect.push(element)
    return element
  }
  add('feFlood', {
    'flood-color': 'rgb(128,128,128)',
    'flood-opacity': '1',
    result: 'neutral',
  })
  const image = add('feImage', {
    preserveAspectRatio: 'none',
    result: 'lensShape',
  })
  add('feComposite', {
    in: 'lensShape',
    in2: 'neutral',
    operator: 'over',
    result: 'map',
  })
  const aspect =
    engine === 'webkit'
      ? add('feColorMatrix', { in: 'map', type: 'matrix', result: 'bend' })
      : null
  const displace = CHANNELS.map((values, index) => {
    const displacement = add('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: aspect ? 'bend' : 'map',
      xChannelSelector: 'R',
      yChannelSelector: 'G',
    })
    add('feColorMatrix', { type: 'matrix', values, result: `ch${index}` })
    return displacement
  })
  // Three premultiplied channels require the spectrum's opaque theme background.
  add('feComposite', {
    in: 'ch0',
    in2: 'ch1',
    operator: 'arithmetic',
    k1: 0,
    k2: 1,
    k3: 1,
    k4: 0,
    result: 'rg',
  })
  add('feComposite', {
    in: 'rg',
    in2: 'ch2',
    operator: 'arithmetic',
    k1: 0,
    k2: 1,
    k3: 1,
    k4: 0,
    result: 'refracted',
  })
  add('feColorMatrix', {
    in: 'map',
    type: 'matrix',
    values: `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 2 0 ${-(2 * NEUTRAL) / 255}`,
    result: 'rim',
  })
  add('feComposite', {
    in: 'rim',
    in2: 'refracted',
    operator: 'arithmetic',
    k1: 0,
    k2: 1,
    k3: 1,
    k4: 0,
    result: 'lit',
  })
  add('feComposite', {
    in: 'lit',
    in2: 'lensShape',
    operator: 'in',
    result: 'lens',
  })
  add(
    'feComposite',
    {
      in: 'SourceGraphic',
      in2: 'lensShape',
      operator: 'out',
      result: 'outside',
    },
    false
  )
  add('feComposite', { in: 'lens', in2: 'outside', operator: 'over' }, false)
  return { image, aspect, displace, lensRect }
}

// objectBoundingBox is required by WebKit; these are the upstream per-axis corrections.
function bendScale(px: number, width: number, height: number, engine: Engine) {
  if (engine === 'webkit') {
    const min = Math.min(width, height)
    return { scale: (2 * px) / min, kx: min / width, ky: min / height }
  }
  if (engine === 'gecko')
    return {
      scale: (2 * px) / Math.sqrt((width * width + height * height) / 2),
      kx: 1,
      ky: 1,
    }
  return { scale: (2 * px) / width, kx: 1, ky: 1 }
}
function setRect(element: SVGElement, width: number, height: number) {
  element.setAttribute('x', '0')
  element.setAttribute('y', '0')
  element.setAttribute('width', String(width))
  element.setAttribute('height', String(height))
}

let uid = 0

/** Refract a decorative spectrum only. Its parent must mask the output to the rim. */
export function createRimLens(target: HTMLElement): { destroy(): void } {
  const originalFilter = target.style.filter
  const originalClip = target.style.clipPath
  const engine = detectEngine()
  const base = `pnds-rim-${++uid}`
  let filter: SVGElement | null = null
  let graph: ReturnType<typeof buildGraph> | null = null
  let observer: ResizeObserver | null = null
  let frame = 0
  let timers: ReturnType<typeof setTimeout>[] = []
  let destroyed = false
  let version = 0
  let request = 0
  let wanted: MapEntry | null = null
  let shown: MapEntry | null = null

  function resetAppearance() {
    target.style.filter = originalFilter
    target.style.clipPath = originalClip
    delete target.dataset.rimOptics
  }
  function stop() {
    if (destroyed) return
    destroyed = true
    if (frame) cancelAnimationFrame(frame)
    timers.forEach(clearTimeout)
    observer?.disconnect()
    if (filter) removeFilter(filter)
    resetAppearance()
  }
  function schedule() {
    if (!destroyed && !frame) frame = requestAnimationFrame(flush)
  }
  function show(entry: MapEntry) {
    if (destroyed || !graph) return
    shown = entry
    graph.image.setAttribute('href', entry.url)
    graph.image.setAttributeNS(XLINK, 'xlink:href', entry.url)
    // WebKit caches an empty filter before feImage's separate data-URL load finishes.
    timers.forEach(clearTimeout)
    timers = [60, 250].map(ms => setTimeout(schedule, ms))
  }
  function flush() {
    frame = 0
    if (destroyed) return
    try {
      const width = target.offsetWidth
      const height = target.offsetHeight
      if (width < 1 || height < 1) {
        resetAppearance()
        return // ResizeObserver retries when the button becomes visible.
      }
      const ratio = height / 160
      const p: LensParameters = {
        ...OPTICS,
        width,
        height,
        radius: 137 * ratio,
        refraction: 60 * ratio,
      }
      const dpr = window.devicePixelRatio || 1
      const entry = lensMap(p, Math.min(dpr, 2))
      if (!filter) {
        filter = node('filter', {
          filterUnits: 'objectBoundingBox',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          primitiveUnits: 'objectBoundingBox',
          'color-interpolation-filters': 'sRGB',
        })
        graph = buildGraph(filter, engine)
        defsNode().appendChild(filter)
      }
      if (wanted !== entry) {
        wanted = entry
        const seq = ++request
        if (entry.decoded) show(entry)
        else
          void entry.ready.then(ready => {
            if (destroyed || seq !== request) return
            if (!ready) {
              stop()
              return
            }
            show(entry)
            schedule()
          })
      }
      if (!shown || !graph) return
      const snappedWidth = Math.round(width * dpr) / dpr
      const snappedHeight = Math.round(height * dpr) / dpr
      const radius = Math.min(p.radius, snappedWidth / 2, snappedHeight / 2)
      target.style.clipPath = `inset(0 ${width - snappedWidth}px ${height - snappedHeight}px 0 round ${radius}px)`
      for (const element of graph.lensRect)
        setRect(element, snappedWidth / width, snappedHeight / height)
      const { scale, kx, ky } = bendScale(p.refraction, width, height, engine)
      graph.displace.forEach((element, index) =>
        element.setAttribute(
          'scale',
          String(scale * (1 + (p.chroma * index) / 2))
        )
      )
      graph.aspect?.setAttribute(
        'values',
        `${kx} 0 0 0 ${(1 - kx) / 2}  0 ${ky} 0 0 ${(1 - ky) / 2}  0 0 1 0 0  0 0 0 1 0`
      )
      filter.id = `${base}-v${++version}`
      target.style.filter = `url(#${filter.id})`
      target.dataset.rimOptics = ''
    } catch {
      // Canvas/filter failures must never interfere with loading or mode switching.
      stop()
    }
  }
  try {
    observer = new ResizeObserver(schedule)
    observer.observe(target)
    schedule()
  } catch {
    stop()
  }
  return { destroy: stop }
}
